using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Distributions.Helpers
{
    /// <summary>
    /// One Generate-Distributions bucket: a unique (Fund, PG, FundCenter, FiscalYear)
    /// tuple plus the funded total it represents. Built from either a Prioritization
    /// aggregation (Phase 2) or a Requirement-Funding aggregation (Phase 3).
    /// FundCenterId here is the *destination* FC (after parent/self resolution).
    /// OwningBusinessUnit is the dest FC's owning BU, resolved by the plugin during
    /// bucket construction so the processor doesn't have to look it up.
    /// </summary>
    public sealed class DistributionBucket
    {
        public Guid FundId { get; set; }
        public Guid PgId { get; set; }
        public Guid FundCenterId { get; set; }
        public int FiscalYear { get; set; }
        public decimal TotalFunding { get; set; }
        public EntityReference OwningBusinessUnit { get; set; }
    }

    public sealed class BucketResult
    {
        public int DistributionsCreated;      // rows created (each debit / credit counts 1)
        public int DistributionsUpdated;      // pending sweep rows amended in place
        public int DistributionsDeactivated;  // pending sweep rows no longer needed
        public int TurnInsCreated;
        public int TurnInsUpdated;
        public int TurnInsDeleted;    // spent trackers removed (both type amounts hit 0)
        public int Skipped;

        // Mid-group continuation: false when the time budget forced a bail before
        // every bucket in the group was processed. NextBucketOffset is the index
        // of the first UNPROCESSED bucket — the caller re-invokes with it so a
        // single oversized (Fund, PG) group is split across passes rather than
        // being an uninterruptible unit that blows the 120s sandbox ceiling.
        public bool GroupComplete = true;
        public int NextBucketOffset;
    }

    /// <summary>
    /// Processes a group of buckets that all share the same (Fund, PG). Each bucket in
    /// the group represents one destination FC's slice of the group's funding.
    ///
    /// Amend-in-place model: rows are split into
    ///   • IMMUTABLE — already entered into GFEBS (book_entrydocumentnumber set),
    ///     manual entries, Turn-In / State Swap / Realignment–linked rows, credits whose paired
    ///     debit is already entered (preserves entered pairings), and any stray
    ///     amendable-looking debit not at the holding FC. These count toward each
    ///     FC's committed net and are never touched.
    ///   • SWEEP-OWNED AMENDABLE — pending reconcile rows (no entry document
    ///     number, not manual, not linked). The sweep updates their amounts in
    ///     place, creates them when missing, and deactivates them when no longer
    ///     needed — keeping row GUIDs stable for GFEBS clerks working the queue.
    ///
    /// For each destination: <c>delta = target − immutableNet</c> where
    /// target = TotalFunding × pct / 100:
    ///   • delta &gt; 0 → the destination's pending credit is amended/created to
    ///                  carry exactly delta. Any lingering per-type overage on its
    ///                  open Sweep Turn-In is cleared.
    ///   • delta &lt; 0 → pending credit(s) deactivated; the overage flows through
    ///                  the per-destination Sweep Turn-In (one record per
    ///                  (Fund, FC, PG), AFP and Allotment tracked independently).
    ///   • delta == 0 → pending credit(s) deactivated; a non-zero Sweep Turn-In
    ///                  per-type amount is zeroed (deleted when both types hit 0 —
    ///                  a spent, never-approved tracker is clutter, not history).
    ///
    /// The single pending debit at the holding FC is then synced to the sum of ALL
    /// live pending credits in the (Fund, PG) group — including credits owned by the
    /// other phase's buckets — so Phase 2 and Phase 3 passes over the same (Fund, PG)
    /// share one consolidated debit. Credits point at it via book_debiteddistribution.
    /// </summary>
    public static class DistributionBucketProcessor
    {
        public static BucketResult ProcessGroup(
            IOrganizationService service,
            ITracingService tracing,
            IList<DistributionBucket> groupBuckets,
            EntityReference fundingEvent,
            int fundingType,
            Guid holdingFundCenterId,
            EntityReference holdingOwningBu,
            int startBucketOffset,
            Stopwatch stopwatch,
            TimeSpan budget,
            IDictionary<string, FundingPercentageHelper.FundingResolution> pctCache = null)
        {
            var result = new BucketResult();
            if (groupBuckets == null || groupBuckets.Count == 0) return result;

            var fundId = groupBuckets[0].FundId;
            var pgId   = groupBuckets[0].PgId;

            var resolution = FundingPercentageHelper.Resolve(
                service, tracing, fundId, pgId, fundingType, DateTime.UtcNow.Date, pctCache);
            if (resolution == null || resolution.FundingEvent.Id != fundingEvent.Id)
            {
                tracing.Trace(
                    $"  No matching FundingDetails for (FE={fundingEvent.Id}, type={fundingType}, " +
                    $"Fund={fundId}, PG={pgId}) — skipping group ({groupBuckets.Count} destination(s)).");
                result.Skipped += groupBuckets.Count;
                return result;
            }

            var state = LoadGroupState(service, fundId, pgId, fundingType, holdingFundCenterId);
            var openTurnInByFc = FindOpenSweepTurnInsByFc(service, fundId, pgId);

            // All row writes for this group go through the batch — it auto-flushes
            // as it fills, so the between-bucket budget check above still reflects
            // real elapsed time, and the final Flush() below drains ≤ one chunk.
            var batch = new BatchWriter(service, tracing);

            var toCreate = new List<(DistributionBucket bucket, decimal amount)>();

            for (var bi = startBucketOffset; bi < groupBuckets.Count; bi++)
            {
                // Bail between buckets when the pass is out of time — but always
                // process at least one bucket per entry so the run makes forward
                // progress and can't livelock on this group. SyncHoldingDebit
                // still runs below (it re-derives from live state, so a partial
                // pass leaves a consistent, self-correcting debit).
                if (bi > startBucketOffset && stopwatch != null && stopwatch.Elapsed > budget)
                {
                    tracing.Trace(
                        $"  Time budget reached mid-group after bucket {bi} of {groupBuckets.Count} " +
                        $"— resuming here next pass.");
                    result.GroupComplete = false;
                    result.NextBucketOffset = bi;
                    break;
                }

                var bucket = groupBuckets[bi];
                var target = Math.Round(bucket.TotalFunding * resolution.Percentage / 100m, 2);
                state.ImmutableNetByFc.TryGetValue(bucket.FundCenterId, out var immutableNet);
                var delta = target - immutableNet;

                state.AmendableCreditsByFc.TryGetValue(bucket.FundCenterId, out var credits);

                tracing.Trace(
                    $"  Dest FC={bucket.FundCenterId} (FY={bucket.FiscalYear}, type={fundingType}): " +
                    $"funded={bucket.TotalFunding:C}, pct={resolution.Percentage}, target={target:C}, " +
                    $"immutableNet={immutableNet:C}, delta={delta:C}, pending={(credits?.Count ?? 0)}.");

                openTurnInByFc.TryGetValue(bucket.FundCenterId, out var openTurnIn);

                if (delta > 0m)
                {
                    var keeper = credits?.FirstOrDefault(c => !c.Deactivated);
                    if (keeper == null)
                    {
                        toCreate.Add((bucket, delta));
                    }
                    else
                    {
                        AmendRowIfNeeded(batch, tracing, keeper, delta, resolution.FundingEvent, result);
                        foreach (var extra in credits.Where(c => c != keeper && !c.Deactivated))
                            DeactivateRow(batch, tracing, extra, result, "duplicate pending credit");
                    }

                    if (openTurnIn != null && GetTypeAmount(openTurnIn, fundingType) > 0m)
                    {
                        if (ZeroTypeAmount(batch, tracing, openTurnIn, fundingType))
                            result.TurnInsDeleted++;
                        else
                            result.TurnInsUpdated++;
                    }
                }
                else
                {
                    if (credits != null)
                        foreach (var c in credits.Where(c => !c.Deactivated))
                            DeactivateRow(batch, tracing, c, result, "target met by committed rows");

                    if (delta < 0m)
                    {
                        var overage = -delta;
                        if (openTurnIn == null)
                        {
                            CreateOverageTurnIn(batch, tracing, bucket, overage, fundingType, bucket.OwningBusinessUnit);
                            result.TurnInsCreated++;
                        }
                        else
                        {
                            var currentAmount = GetTypeAmount(openTurnIn, fundingType);
                            if (currentAmount != overage)
                            {
                                UpdateTypeAmount(batch, tracing, openTurnIn, fundingType, overage);
                                result.TurnInsUpdated++;
                            }
                        }
                    }
                    else // even
                    {
                        if (openTurnIn != null && GetTypeAmount(openTurnIn, fundingType) > 0m)
                        {
                            if (ZeroTypeAmount(batch, tracing, openTurnIn, fundingType))
                                result.TurnInsDeleted++;
                            else
                                result.TurnInsUpdated++;
                        }
                    }
                }
            }

            SyncHoldingDebit(service, batch, tracing, state, toCreate, resolution.FundingEvent,
                fundId, pgId, holdingFundCenterId, holdingOwningBu, result);

            // Drain whatever the auto-flush left (≤ one chunk). Runs on both the
            // completed and mid-group-bail paths so processed buckets persist.
            batch.Flush();

            return result;
        }

        // -----------------------------------------------------------------
        // Holding-FC debit sync: the ONE pending debit for this (Fund, PG, type)
        // must carry Σ of all live pending credits (kept + newly created + any
        // owned by the other phase's pass over the same Fund/PG). Extra pending
        // debits are deactivated; kept credits are re-pointed at the keeper when
        // their book_debiteddistribution drifted (legacy multi-debit rows).
        // -----------------------------------------------------------------
        private static void SyncHoldingDebit(
            IOrganizationService service,
            BatchWriter batch,
            ITracingService tracing,
            GroupState state,
            IList<(DistributionBucket bucket, decimal amount)> toCreate,
            EntityReference fundingEventRef,
            Guid fundId,
            Guid pgId,
            Guid holdingFundCenterId,
            EntityReference holdingOwningBu,
            BucketResult result)
        {
            var liveCredits = state.AmendableCreditsByFc.Values
                .SelectMany(l => l)
                .Where(c => !c.Deactivated)
                .ToList();
            var totalDebit = liveCredits.Sum(c => c.Amount) + toCreate.Sum(t => t.amount);

            var keeper = state.AmendableHoldingDebits.FirstOrDefault(d => !d.Deactivated);
            foreach (var extra in state.AmendableHoldingDebits.Where(d => d != keeper && !d.Deactivated))
                DeactivateRow(batch, tracing, extra, result, "duplicate pending holding-FC debit");

            if (totalDebit <= 0m)
            {
                if (keeper != null)
                    DeactivateRow(batch, tracing, keeper, result, "no pending credits remain");
                return;
            }

            Guid debitId;
            if (keeper == null)
            {
                var debit = new Entity(EntityNames.Distributions);
                debit[DistributionsAttributes.Amount]                = totalDebit;
                debit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, fundId);
                debit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, holdingFundCenterId);
                debit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, pgId);
                debit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Debit);
                debit[DistributionsAttributes.FundingEvent]          = fundingEventRef;
                debit[DistributionsAttributes.ManualEntry]           = false;
                if (holdingOwningBu != null) debit["owningbusinessunit"] = holdingOwningBu;
                // Synchronous: the credits below reference this debit's id, so it
                // must exist before they are queued. Flush anything the bucket loop
                // buffered first, so this create can't be reordered after a credit.
                batch.Flush();
                debitId = service.Create(debit);
                result.DistributionsCreated++;
                tracing.Trace($"  → Created consolidated Debit {debitId} at holding FC for {totalDebit:C}.");
            }
            else
            {
                debitId = keeper.Id;
                AmendRowIfNeeded(batch, tracing, keeper, totalDebit, fundingEventRef, result);
            }
            var debitRef = new EntityReference(EntityNames.Distributions, debitId);

            foreach (var s in toCreate)
            {
                var credit = new Entity(EntityNames.Distributions);
                credit[DistributionsAttributes.Amount]                = s.amount;
                credit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, fundId);
                credit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, s.bucket.FundCenterId);
                credit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, pgId);
                credit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Credit);
                credit[DistributionsAttributes.FundingEvent]          = fundingEventRef;
                credit[DistributionsAttributes.DebitedDistribution]   = debitRef;
                credit[DistributionsAttributes.ManualEntry]           = false;
                if (s.bucket.OwningBusinessUnit != null) credit["owningbusinessunit"] = s.bucket.OwningBusinessUnit;
                batch.Create(credit);
                result.DistributionsCreated++;
                tracing.Trace($"    → Credit queued to FC {s.bucket.FundCenterId} for {s.amount:C}.");
            }

            foreach (var c in liveCredits.Where(c => c.DebitedDistributionId != debitId))
            {
                batch.Update(new Entity(EntityNames.Distributions, c.Id)
                {
                    [DistributionsAttributes.DebitedDistribution] = debitRef,
                });
                c.DebitedDistributionId = debitId;
                result.DistributionsUpdated++;
                tracing.Trace($"    → Re-pointed pending credit {c.Id} at debit {debitId}.");
            }
        }

        // -----------------------------------------------------------------
        // Row-level load + classification of the group's active Distributions,
        // FE-type filtered via the FundingEvent inner join (rows without a
        // FundingEvent, or of the other type, are invisible to this pass —
        // same scoping the old aggregate query used). Ordered by createdon so
        // "keep the oldest" is deterministic.
        // -----------------------------------------------------------------
        private sealed class AmendableRow
        {
            public Guid Id;
            public Guid FundCenterId;
            public decimal Amount;
            public Guid? DebitedDistributionId;
            public Guid FundingEventId;
            public bool Deactivated;
        }

        private sealed class GroupState
        {
            public readonly Dictionary<Guid, decimal> ImmutableNetByFc = new Dictionary<Guid, decimal>();
            public readonly Dictionary<Guid, List<AmendableRow>> AmendableCreditsByFc = new Dictionary<Guid, List<AmendableRow>>();
            public readonly List<AmendableRow> AmendableHoldingDebits = new List<AmendableRow>();
        }

        private static GroupState LoadGroupState(
            IOrganizationService service, Guid fundId, Guid pgId, int fundingType, Guid holdingFundCenterId)
        {
            var query = new QueryExpression(EntityNames.Distributions)
            {
                ColumnSet = new ColumnSet(
                    DistributionsAttributes.Id,
                    DistributionsAttributes.FundCenter,
                    DistributionsAttributes.DisbursementDirection,
                    DistributionsAttributes.Amount,
                    DistributionsAttributes.EntryDocumentNumber,
                    DistributionsAttributes.ManualEntry,
                    DistributionsAttributes.TurnIn,
                    DistributionsAttributes.StateSwap,
                    DistributionsAttributes.Realignment,
                    DistributionsAttributes.DebitedDistribution,
                    DistributionsAttributes.FundingEvent),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(DistributionsAttributes.Fund,      ConditionOperator.Equal, fundId),
                        new ConditionExpression(DistributionsAttributes.PGSAG,     ConditionOperator.Equal, pgId),
                        new ConditionExpression(DistributionsAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                PageInfo = new PagingInfo { Count = 5000, PageNumber = 1, ReturnTotalRecordCount = false },
                NoLock = true,
            };
            var feLink = query.AddLink(EntityNames.FundingEvent, DistributionsAttributes.FundingEvent, FundingEventAttributes.Id);
            feLink.LinkCriteria.AddCondition(FundingEventAttributes.FundingType, ConditionOperator.Equal, fundingType);
            query.AddOrder("createdon", OrderType.Ascending);

            var rows = new List<Entity>();
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                rows.AddRange(page.Entities);
                if (!page.MoreRecords) break;
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }

            // First pass: which debits are already entered into GFEBS — a credit
            // paired to one is treated immutable even if itself still pending.
            var enteredDebitIds = new HashSet<Guid>(rows
                .Where(r => GetDirection(r) == DisbursementDirectionValues.Debit && IsEntered(r))
                .Select(r => r.Id));

            var state = new GroupState();
            foreach (var row in rows)
            {
                var fcRef = row.GetAttributeValue<EntityReference>(DistributionsAttributes.FundCenter);
                if (fcRef == null) continue;
                var direction = GetDirection(row);
                // Direction-less rows were invisible to the old aggregate math;
                // keep ignoring them rather than guessing a side.
                if (direction != DisbursementDirectionValues.Credit &&
                    direction != DisbursementDirectionValues.Debit) continue;
                var amount = NumericHelper.ToDecimal(row, DistributionsAttributes.Amount) ?? 0m;
                var debitedRef = row.GetAttributeValue<EntityReference>(DistributionsAttributes.DebitedDistribution);

                var amendable =
                    !IsEntered(row)
                    && !(row.GetAttributeValue<bool?>(DistributionsAttributes.ManualEntry) ?? false)
                    && row.GetAttributeValue<EntityReference>(DistributionsAttributes.TurnIn) == null
                    && row.GetAttributeValue<EntityReference>(DistributionsAttributes.StateSwap) == null
                    && row.GetAttributeValue<EntityReference>(DistributionsAttributes.Realignment) == null
                    && !(direction == DisbursementDirectionValues.Credit
                         && debitedRef != null && enteredDebitIds.Contains(debitedRef.Id))
                    // A pending sweep debit only ever lives at the holding FC;
                    // anything else is not ours to amend.
                    && !(direction == DisbursementDirectionValues.Debit && fcRef.Id != holdingFundCenterId);

                if (!amendable)
                {
                    state.ImmutableNetByFc.TryGetValue(fcRef.Id, out var running);
                    if (direction == DisbursementDirectionValues.Credit)
                        state.ImmutableNetByFc[fcRef.Id] = running + amount;
                    else if (direction == DisbursementDirectionValues.Debit)
                        state.ImmutableNetByFc[fcRef.Id] = running - amount;
                    continue;
                }

                var amendableRow = new AmendableRow
                {
                    Id = row.Id,
                    FundCenterId = fcRef.Id,
                    Amount = amount,
                    DebitedDistributionId = debitedRef?.Id,
                    FundingEventId = row.GetAttributeValue<EntityReference>(DistributionsAttributes.FundingEvent)?.Id ?? Guid.Empty,
                };

                if (direction == DisbursementDirectionValues.Debit)
                {
                    state.AmendableHoldingDebits.Add(amendableRow);
                }
                else
                {
                    if (!state.AmendableCreditsByFc.TryGetValue(fcRef.Id, out var list))
                        state.AmendableCreditsByFc[fcRef.Id] = list = new List<AmendableRow>();
                    list.Add(amendableRow);
                }
            }
            return state;
        }

        private static bool IsEntered(Entity row) =>
            !string.IsNullOrWhiteSpace(row.GetAttributeValue<string>(DistributionsAttributes.EntryDocumentNumber));

        private static int GetDirection(Entity row) =>
            row.GetAttributeValue<OptionSetValue>(DistributionsAttributes.DisbursementDirection)?.Value ?? -1;

        private static void AmendRowIfNeeded(
            BatchWriter batch, ITracingService tracing,
            AmendableRow row, decimal newAmount, EntityReference fundingEventRef, BucketResult result)
        {
            var amountChanged = row.Amount != newAmount;
            var feChanged = row.FundingEventId != fundingEventRef.Id;
            if (!amountChanged && !feChanged) return;

            var update = new Entity(EntityNames.Distributions, row.Id);
            if (amountChanged) update[DistributionsAttributes.Amount] = newAmount;
            if (feChanged)     update[DistributionsAttributes.FundingEvent] = fundingEventRef;
            batch.Update(update);

            tracing.Trace($"  → Amended pending row {row.Id}: amount {row.Amount:C} → {newAmount:C}" +
                          (feChanged ? " (+ FundingEvent retag)." : "."));
            row.Amount = newAmount;
            row.FundingEventId = fundingEventRef.Id;
            result.DistributionsUpdated++;
        }

        private static void DeactivateRow(
            BatchWriter batch, ITracingService tracing,
            AmendableRow row, BucketResult result, string reason)
        {
            batch.Update(new Entity(EntityNames.Distributions, row.Id)
            {
                [DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive),
            });
            row.Deactivated = true;
            result.DistributionsDeactivated++;
            tracing.Trace($"  → Deactivated pending row {row.Id} ({reason}).");
        }

        // -----------------------------------------------------------------
        // Open Kind B (Sweep) Turn-Ins, batched: one RetrieveMultiple per group
        // keyed by (Fund, PG), returned as an FC → Entity map. Callers treat a
        // missing key as "no open Turn-In" (same as the old single-row lookup
        // returning null). One row per FC is expected; if duplicates ever slip
        // in, first-write-wins preserves prior single-lookup semantics.
        // -----------------------------------------------------------------
        private static Dictionary<Guid, Entity> FindOpenSweepTurnInsByFc(
            IOrganizationService service, Guid fundId, Guid pgId)
        {
            var query = new QueryExpression(EntityNames.Turnin)
            {
                ColumnSet = new ColumnSet(
                    TurninAttributes.Id,
                    TurninAttributes.FundCenter,
                    TurninAttributes.AFPAmount,
                    TurninAttributes.AllotmentAmount),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(TurninAttributes.Fund,        ConditionOperator.Equal, fundId),
                        new ConditionExpression(TurninAttributes.PG,          ConditionOperator.Equal, pgId),
                        new ConditionExpression(TurninAttributes.StateCode,   ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(TurninAttributes.Origin,      ConditionOperator.Equal, TurnInOriginValues.Sweep),
                        new ConditionExpression(TurninAttributes.BEApproved,  ConditionOperator.Equal, false),
                    },
                },
                PageInfo = new PagingInfo { Count = 5000, PageNumber = 1, ReturnTotalRecordCount = false },
                NoLock = true,
            };

            var byFc = new Dictionary<Guid, Entity>();
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                foreach (var t in page.Entities)
                {
                    var fcRef = t.GetAttributeValue<EntityReference>(TurninAttributes.FundCenter);
                    if (fcRef == null || byFc.ContainsKey(fcRef.Id)) continue;
                    byFc[fcRef.Id] = t;
                }
                if (!page.MoreRecords) break;
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
            return byFc;
        }

        private static decimal GetTypeAmount(Entity turnIn, int fundingType)
        {
            var attr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AFPAmount
                : TurninAttributes.AllotmentAmount;
            return NumericHelper.ToDecimal(turnIn, attr) ?? 0m;
        }

        private static void UpdateTypeAmount(
            BatchWriter batch, ITracingService tracing,
            Entity turnIn, int fundingType, decimal newAmount)
        {
            var attr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AFPAmount
                : TurninAttributes.AllotmentAmount;
            batch.Update(new Entity(EntityNames.Turnin, turnIn.Id) { [attr] = newAmount });
            // Update local copy so subsequent reads in this Process call see the new value.
            turnIn[attr] = newAmount;
            tracing.Trace($"  → Updated Sweep Turn-In {turnIn.Id} {attr} = {newAmount:C}.");
        }

        /// <summary>
        /// Zero the named-type column. If both type amounts are then 0, the
        /// tracker is spent — DELETE it and return true; else return false.
        /// Deletion is safe: the sweep only touches active, BEApproved = false,
        /// Origin = Sweep records, which have no items, ledgers, or distributions
        /// hanging off them. Spent trackers used to be deactivated instead, and
        /// the zero-amount rows accumulated as clutter (one per resolved overage).
        /// NOTE: no security role grants Delete on book_turnin — this relies on
        /// the plugins' execution identity being the sysadmin super user.
        /// </summary>
        private static bool ZeroTypeAmount(
            BatchWriter batch, ITracingService tracing,
            Entity turnIn, int fundingType)
        {
            var attr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AFPAmount
                : TurninAttributes.AllotmentAmount;

            var otherAttr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AllotmentAmount
                : TurninAttributes.AFPAmount;
            var otherAmount = NumericHelper.ToDecimal(turnIn, otherAttr) ?? 0m;

            if (otherAmount <= 0m)
            {
                // Both sides done — the tracker is spent; remove it entirely.
                batch.Delete(EntityNames.Turnin, turnIn.Id);
                tracing.Trace($"  → Deleted Sweep Turn-In {turnIn.Id} (both type amounts cleared).");
                return true;
            }

            batch.Update(new Entity(EntityNames.Turnin, turnIn.Id) { [attr] = 0m });
            turnIn[attr] = 0m;
            tracing.Trace($"  → Zeroed Sweep Turn-In {turnIn.Id} {attr} (other type still > 0).");
            return false;
        }

        // -----------------------------------------------------------------
        // New Sweep Turn-In for an overage: Origin = Sweep, header Amount
        // (semantically TDP-amount) = 0, the type-specific column carries
        // the detected overage. The complementary column starts at 0.
        // -----------------------------------------------------------------
        private static void CreateOverageTurnIn(
            BatchWriter batch,
            ITracingService tracing,
            DistributionBucket bucket,
            decimal amount,
            int fundingType,
            EntityReference owningBu)
        {
            var turnIn = new Entity(EntityNames.Turnin);
            turnIn[TurninAttributes.Amount]     = 0m; // no TDP change
            // book_fiscalyear is a picklist (goal_fiscalyear option set) — write as OptionSetValue, not raw int.
            turnIn[TurninAttributes.FiscalYear] = new OptionSetValue(bucket.FiscalYear);
            turnIn[TurninAttributes.Fund]       = new EntityReference(EntityNames.Fund, bucket.FundId);
            turnIn[TurninAttributes.FundCenter] = new EntityReference(EntityNames.FundCenter, bucket.FundCenterId);
            turnIn[TurninAttributes.PG]         = new EntityReference(EntityNames.PG, bucket.PgId);
            turnIn[TurninAttributes.Origin]     = new OptionSetValue(TurnInOriginValues.Sweep);
            turnIn[TurninAttributes.AFPAmount]       = fundingType == FundingTypeValues.AFP       ? amount : 0m;
            turnIn[TurninAttributes.AllotmentAmount] = fundingType == FundingTypeValues.Allotment ? amount : 0m;
            if (owningBu != null) turnIn["owningbusinessunit"] = owningBu;

            batch.Create(turnIn);
            var typeName = fundingType == FundingTypeValues.AFP ? "AFP" : "Allotment";
            tracing.Trace($"  → Queued Sweep Turn-In ({typeName} overage {amount:C}) at FC {bucket.FundCenterId}.");
        }
    }
}
