using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Distributions.Helpers;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Distributions
{
    /// <summary>
    /// Custom API handler for <c>book_GenerateDistributions</c>. Replaces the
    /// <c>Distribution-GenerateAFPDistributions</c> Power Automate flow.
    ///
    /// Amend-in-place model (the original design deactivated every pending row
    /// up front and recreated from scratch; this destroyed pending Turn-In /
    /// State Swap / manual rows and churned row GUIDs for GFEBS clerks):
    /// <list type="number">
    ///   <item>Aggregate active Prioritizations into (dest_fc, PG, fund, FY) buckets,
    ///         then group buckets by (Fund, PG). Per destination the processor
    ///         compares target (funded × pct) against the committed IMMUTABLE net
    ///         (GFEBS-entered, manual, Turn-In/Swap-linked rows) and amends the
    ///         destination's PENDING sweep credit in place — update its amount,
    ///         create it when missing, deactivate it when no longer needed. One
    ///         consolidated pending debit at the holding FC carries the sum of the
    ///         group's pending credits; overages/evens roll through the Sweep
    ///         Turn-In machinery unchanged. Destination FC is resolved by walking
    ///         the FC parent chain up to state level (parent = holding FC).</item>
    ///   <item>Same reconciliation for BE-approved Requirements that have no
    ///         Prioritizations (types TARC + ARNGExternal), grouped on
    ///         (fundcenter, PG, fund, FY).</item>
    ///   <item>Orphan cleanup (Phase 4): pending sweep rows whose (Fund, FC, PG)
    ///         no longer matches any bucket are deactivated, and each pending
    ///         holding-FC debit is re-synced to the sum of its surviving credits.</item>
    /// </list>
    ///
    /// Input parameters:
    ///   <c>FundingType</c>        (int, optional)    — 0 = AFP only, 1 = Allotment only, omitted = both.
    ///   <c>FiscalYear</c>         (int, optional)    — option-set value on book_fund.book_fiscalyear;
    ///                                                  filters buckets + Phase 4. Omitted = all FYs.
    ///   <c>NextToken</c>          (string, optional) — opaque resume marker returned by a prior call.
    ///                                                  Empty/missing = fresh start. (The wire-level
    ///                                                  name is <c>NextToken</c>; internally the
    ///                                                  concept is a continuation cursor. Renamed
    ///                                                  from <c>ContinuationToken</c> to sidestep an
    ///                                                  orphaned Boolean-typed sdkmessageresponsefield
    ///                                                  row in the target org.)
    ///
    /// Output parameters:
    ///   <c>Deactivated</c>        (int) — pending sweep rows deactivated in THIS invocation
    ///                                     (no longer needed, duplicate, or orphaned).
    ///   <c>Created</c>            (int) — Distribution rows created (each debit / credit counts 1).
    ///   <c>Updated</c>            (int) — pending sweep rows amended in place (amount / FE / pairing).
    ///   <c>TurnInsCreated</c>     (int) — Overage Turn-Ins created.
    ///   <c>Skipped</c>            (int) — Destinations skipped (missing FundingDetails percentage, etc).
    ///   <c>NextToken</c>          (string) — empty = done; non-empty = caller should re-invoke
    ///                                        passing this back as input <c>NextToken</c>.
    ///
    /// Time budget: the plugin tracks a wall-clock budget below the 2-minute sandbox
    /// ceiling. When the budget is exceeded between buckets, processing halts and a
    /// continuation token is returned. Per-invocation output counters are NOT cumulative
    /// across calls — the caller sums them.
    /// </summary>
    public class GenerateDistributionsPlugin : PluginBase
    {
        private const string MessageName = "book_GenerateDistributions";
        private const string HoldingFundCenterEnvVar = "book_DistributionHoldingFundCenter";

        // Plugin sandbox hard kill is 120s. Bail at ~105s so we have time to
        // serialize the continuation token and write outputs.
        private static readonly TimeSpan TimeBudget = TimeSpan.FromSeconds(105);

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != MessageName)
            {
                tracing.Trace($"Skipping — message {context.MessageName} is not {MessageName}.");
                return;
            }

            int? fundingTypeFilter = null;
            if (context.InputParameters.TryGetValue("FundingType", out var rawType) && rawType is int ft)
                fundingTypeFilter = ft;

            int? fiscalYearFilter = null;
            if (context.InputParameters.TryGetValue("FiscalYear", out var rawFy) && rawFy is int fy && fy > 0)
                fiscalYearFilter = fy;

            string tokenIn = null;
            if (context.InputParameters.TryGetValue("NextToken", out var rawTok) && rawTok is string s)
                tokenIn = s;
            var cursor = Cursor.Parse(tokenIn);

            tracing.Trace(
                $"GenerateDistributions starting (FundingType={(fundingTypeFilter.HasValue ? fundingTypeFilter.Value.ToString() : "both")}, " +
                $"FiscalYear={(fiscalYearFilter.HasValue ? fiscalYearFilter.Value.ToString() : "all")}, " +
                $"resume={(cursor != null ? cursor.Serialize() : "(fresh)")}).");

            var holdingFundCenterId = EnvironmentVariableHelper.GetGuid(service, HoldingFundCenterEnvVar);
            tracing.Trace($"Holding Fund Center (env var {HoldingFundCenterEnvVar}) = {holdingFundCenterId}.");

            // Per-invocation caches (both need to be alive by the time we build
            // buckets, since bucket construction resolves owning BU).
            var fcCache  = new Dictionary<Guid, FundCenterMeta>();
            var pctCache = new Dictionary<string, FundingPercentageHelper.FundingResolution>();

            // Debit rows live at the holding FC — own them by the holding FC's BU.
            var holdingOwningBu = FundCenterWalkHelper.GetFundCenterMeta(service, fcCache, holdingFundCenterId)?.OwningBusinessUnit;

            var stopwatch = Stopwatch.StartNew();

            var totalDeactivated = 0;
            var totalCreated = 0;
            var totalUpdated = 0;
            var totalTurnIns = 0;
            var totalSkipped = 0;

            // ---- Phases 2 + 3 — per-FE bucket reconciliation ------------------
            // Skipped entirely when resuming into Phase 4.
            if (cursor == null || cursor.Phase < 4)
            {
                var fundingEvents = ResolveActiveFundingEvents(service, tracing, fundingTypeFilter);
                if (fundingEvents.Count == 0)
                {
                    tracing.Trace("No active Funding Events match the filter — Phases 2 + 3 skipped.");
                }

                // Determine starting (fe-index, phase, bucket-idx) from the cursor.
                var startFeIdx   = 0;
                var startPhase   = 2;
                var startBucket  = 0;
                if (cursor != null && cursor.Phase >= 2 && cursor.Phase <= 3)
                {
                    var idx = fundingEvents.FindIndex(e => e.Id == cursor.FundingEventId);
                    if (idx >= 0)
                    {
                        startFeIdx  = idx;
                        startPhase  = cursor.Phase;
                        startBucket = cursor.BucketIdx;
                    }
                    else
                    {
                        tracing.Trace($"Cursor FE {cursor.FundingEventId} no longer active — restarting at FE 0 / Phase 2.");
                    }
                }

                for (var feIdx = startFeIdx; feIdx < fundingEvents.Count; feIdx++)
                {
                    var fundingEvent = fundingEvents[feIdx];
                    var fundingType = fundingEvent.GetAttributeValue<OptionSetValue>(FundingEventAttributes.FundingType)?.Value ?? -1;
                    var fundingEventRef = fundingEvent.ToEntityReference();
                    tracing.Trace($"Processing FundingEvent {fundingEvent.Id} (type = {fundingType}, idx = {feIdx}).");

                    // ---- Phase 2 — Prioritizations -------------------------------
                    HashSet<string> phase2Keys = null;
                    if (startPhase <= 2)
                    {
                        var phase2Buckets = QueryPrioritizationBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter);
                        phase2Keys = new HashSet<string>(phase2Buckets.Select(b => $"{b.FundId}|{b.FundCenterId}|{b.PgId}"));
                        var phase2Groups  = GroupByFundAndPg(phase2Buckets);
                        tracing.Trace($"Phase 2: {phase2Groups.Count} (Fund, PG) group(s) to process.");
                        var groupStart = (feIdx == startFeIdx && startPhase == 2) ? startBucket : 0;
                        for (var i = groupStart; i < phase2Groups.Count; i++)
                        {
                            if (stopwatch.Elapsed > TimeBudget)
                            {
                                var outCursor = new Cursor { Phase = 2, FundingEventId = fundingEvent.Id, BucketIdx = i };
                                tracing.Trace($"Time budget reached at FE {fundingEvent.Id} Phase 2 group {i} — returning continuation.");
                                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, outCursor);
                                return;
                            }
                            var r = DistributionBucketProcessor.ProcessGroup(
                                service, tracing, phase2Groups[i], fundingEventRef, fundingType,
                                holdingFundCenterId, holdingOwningBu, pctCache);
                            totalCreated     += r.DistributionsCreated;
                            totalUpdated     += r.DistributionsUpdated;
                            totalDeactivated += r.DistributionsDeactivated;
                            totalTurnIns     += r.TurnInsCreated;
                            totalSkipped     += r.Skipped;
                        }
                    }

                    // ---- Phase 3 — Requirements ----------------------------------
                    {
                        var phase3Buckets = QueryRequirementBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter);

                        // Tripwire: Phase 2 (state-level FCs) and Phase 3 (TARC-level
                        // FCs) destinations are expected to be disjoint. Each phase
                        // reconciles only ITS OWN target against the FULL committed
                        // net at the FC, so a shared destination would make the two
                        // passes fight — spurious Sweep Turn-Ins and pending-credit
                        // clobbering. Warn-only; if this ever fires, the phases need
                        // to be merged into one combined bucket set.
                        if (phase2Keys != null)
                            foreach (var b in phase3Buckets.Where(b => phase2Keys.Contains($"{b.FundId}|{b.FundCenterId}|{b.PgId}")))
                                tracing.Trace(
                                    $"WARNING: destination (Fund={b.FundId}, FC={b.FundCenterId}, PG={b.PgId}) appears in BOTH " +
                                    "Phase 2 and Phase 3 buckets — the phases will fight over its pending credit / Sweep Turn-In.");

                        var phase3Groups  = GroupByFundAndPg(phase3Buckets);
                        tracing.Trace($"Phase 3: {phase3Groups.Count} (Fund, PG) group(s) to process.");
                        var groupStart = (feIdx == startFeIdx && startPhase == 3) ? startBucket : 0;
                        for (var i = groupStart; i < phase3Groups.Count; i++)
                        {
                            if (stopwatch.Elapsed > TimeBudget)
                            {
                                var outCursor = new Cursor { Phase = 3, FundingEventId = fundingEvent.Id, BucketIdx = i };
                                tracing.Trace($"Time budget reached at FE {fundingEvent.Id} Phase 3 group {i} — returning continuation.");
                                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, outCursor);
                                return;
                            }
                            var r = DistributionBucketProcessor.ProcessGroup(
                                service, tracing, phase3Groups[i], fundingEventRef, fundingType,
                                holdingFundCenterId, holdingOwningBu, pctCache);
                            totalCreated     += r.DistributionsCreated;
                            totalUpdated     += r.DistributionsUpdated;
                            totalDeactivated += r.DistributionsDeactivated;
                            totalTurnIns     += r.TurnInsCreated;
                            totalSkipped     += r.Skipped;
                        }
                    }

                    // Once we've finished an FE, subsequent ones start from Phase 2 / group 0.
                    startPhase = 2;
                    startBucket = 0;
                }
            }

            // ---- Phase 4 — orphan cleanup --------------------------------------
            if (stopwatch.Elapsed > TimeBudget)
            {
                tracing.Trace("Time budget reached before Phase 4 — returning continuation (phase=4).");
                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, new Cursor { Phase = 4 });
                return;
            }

            var cleanup = OrphanCleanup(
                service, tracing, holdingFundCenterId, fcCache,
                fundingTypeFilter, fiscalYearFilter, stopwatch, TimeBudget);
            totalDeactivated += cleanup.Deactivated;
            totalUpdated     += cleanup.Updated;
            if (!cleanup.Complete)
            {
                tracing.Trace("Phase 4 incomplete — returning continuation (phase=4).");
                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, new Cursor { Phase = 4 });
                return;
            }

            WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, null);
        }

        // -----------------------------------------------------------------
        // Phase 4: deactivate pending sweep rows whose (Fund, FC, PG) matches no
        // current bucket (funded dropped to zero, FC re-parented, FY closed out),
        // then re-sync each pending holding-FC debit to the sum of its group's
        // surviving pending credits. Idempotent — a resumed invocation restarts
        // the phase from scratch and the queries exclude already-deactivated rows.
        //
        // Pending sweep rows = active + no entry document number + not manual +
        // no Turn-In / State Swap link + carrying a FundingEvent of a processed
        // type; a pending credit paired (book_debiteddistribution) to an already
        // GFEBS-entered debit is left alone to preserve the entered pairing.
        // -----------------------------------------------------------------
        private sealed class CleanupResult
        {
            public int Deactivated;
            public int Updated;
            public bool Complete = true;
        }

        private static CleanupResult OrphanCleanup(
            IOrganizationService service, ITracingService tracing,
            Guid holdingFundCenterId, Dictionary<Guid, FundCenterMeta> fcCache,
            int? fundingTypeFilter, int? fiscalYearFilter,
            Stopwatch stopwatch, TimeSpan budget)
        {
            var result = new CleanupResult();
            tracing.Trace("Phase 4: orphan cleanup starting.");

            // Live bucket keys, re-derived from the same aggregations Phases 2+3 use.
            var bucketKeys = new HashSet<string>(
                QueryPrioritizationBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter)
                    .Concat(QueryRequirementBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter))
                    .Select(b => $"{b.FundId}|{b.FundCenterId}|{b.PgId}"));
            tracing.Trace($"Phase 4: {bucketKeys.Count} live bucket key(s).");

            var pending = RetrievePendingSweepRows(service, fundingTypeFilter, fiscalYearFilter);
            tracing.Trace($"Phase 4: {pending.Count} pending sweep row(s) in scope.");

            var credits = pending.Where(p => p.Direction == DisbursementDirectionValues.Credit).ToList();
            var holdingDebits = pending
                .Where(p => p.Direction == DisbursementDirectionValues.Debit && p.FundCenterId == holdingFundCenterId)
                .ToList();

            // Orphan credits: no live bucket for their (Fund, FC, PG).
            var orphanCandidates = credits
                .Where(c => !bucketKeys.Contains($"{c.FundId}|{c.FundCenterId}|{c.PgId}"))
                .ToList();

            // Preserve entered pairings: a candidate whose paired debit already has
            // an entry document number is immutable. Those debits are outside the
            // pending set (they're entered), so look them up in one batch.
            var pairedDebitIds = orphanCandidates
                .Where(c => c.DebitedDistributionId.HasValue)
                .Select(c => c.DebitedDistributionId.Value)
                .Distinct()
                .Where(id => pending.All(p => p.Id != id))
                .ToList();
            var enteredDebitIds = RetrieveEnteredDistributionIds(service, pairedDebitIds);

            foreach (var orphan in orphanCandidates)
            {
                if (orphan.DebitedDistributionId.HasValue && enteredDebitIds.Contains(orphan.DebitedDistributionId.Value))
                {
                    tracing.Trace($"  Orphan credit {orphan.Id} paired to entered debit {orphan.DebitedDistributionId} — leaving alone.");
                    continue;
                }
                if (stopwatch.Elapsed > budget)
                {
                    tracing.Trace("Phase 4: time budget reached during orphan deactivation.");
                    result.Complete = false;
                    return result;
                }
                service.Update(new Entity(EntityNames.Distributions, orphan.Id)
                {
                    [DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive),
                });
                orphan.Deactivated = true;
                result.Deactivated++;
                tracing.Trace($"  → Deactivated orphan pending credit {orphan.Id} (Fund={orphan.FundId}, FC={orphan.FundCenterId}, PG={orphan.PgId}).");
            }

            // Debit re-sync: each pending holding-FC debit must equal the sum of the
            // surviving pending credits sharing its (Fund, PG, FundingEvent).
            var creditSums = credits
                .Where(c => !c.Deactivated)
                .GroupBy(c => $"{c.FundId}|{c.PgId}|{c.FundingEventId}")
                .ToDictionary(g => g.Key, g => g.Sum(c => c.Amount));

            foreach (var debitGroup in holdingDebits.GroupBy(d => $"{d.FundId}|{d.PgId}|{d.FundingEventId}"))
            {
                if (stopwatch.Elapsed > budget)
                {
                    tracing.Trace("Phase 4: time budget reached during debit re-sync.");
                    result.Complete = false;
                    return result;
                }

                // Retrieval is createdon-ordered — keep the oldest, drop duplicates.
                var keeper = debitGroup.First();
                foreach (var extra in debitGroup.Skip(1))
                {
                    service.Update(new Entity(EntityNames.Distributions, extra.Id)
                    {
                        [DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive),
                    });
                    result.Deactivated++;
                    tracing.Trace($"  → Deactivated duplicate pending debit {extra.Id}.");
                }

                creditSums.TryGetValue(debitGroup.Key, out var creditSum);
                if (creditSum <= 0m)
                {
                    service.Update(new Entity(EntityNames.Distributions, keeper.Id)
                    {
                        [DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive),
                    });
                    result.Deactivated++;
                    tracing.Trace($"  → Deactivated pending debit {keeper.Id} (no surviving pending credits).");
                }
                else if (keeper.Amount != creditSum)
                {
                    service.Update(new Entity(EntityNames.Distributions, keeper.Id)
                    {
                        [DistributionsAttributes.Amount] = creditSum,
                    });
                    result.Updated++;
                    tracing.Trace($"  → Re-synced pending debit {keeper.Id}: {keeper.Amount:C} → {creditSum:C}.");
                }
            }

            tracing.Trace($"Phase 4: complete — {result.Deactivated} deactivated, {result.Updated} re-synced.");
            return result;
        }

        private sealed class PendingSweepRow
        {
            public Guid Id;
            public Guid FundCenterId;
            public Guid FundId;
            public Guid PgId;
            public Guid FundingEventId;
            public int Direction;
            public decimal Amount;
            public Guid? DebitedDistributionId;
            public bool Deactivated;
        }

        private static List<PendingSweepRow> RetrievePendingSweepRows(
            IOrganizationService service, int? fundingTypeFilter, int? fiscalYearFilter)
        {
            var query = new QueryExpression(EntityNames.Distributions)
            {
                ColumnSet = new ColumnSet(
                    DistributionsAttributes.Id,
                    DistributionsAttributes.FundCenter,
                    DistributionsAttributes.Fund,
                    DistributionsAttributes.PGSAG,
                    DistributionsAttributes.FundingEvent,
                    DistributionsAttributes.DisbursementDirection,
                    DistributionsAttributes.Amount,
                    DistributionsAttributes.DebitedDistribution),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(DistributionsAttributes.StateCode,           ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(DistributionsAttributes.EntryDocumentNumber, ConditionOperator.Null),
                        new ConditionExpression(DistributionsAttributes.TurnIn,              ConditionOperator.Null),
                        new ConditionExpression(DistributionsAttributes.StateSwap,           ConditionOperator.Null),
                    },
                },
                PageInfo = new PagingInfo { Count = 5000, PageNumber = 1, ReturnTotalRecordCount = false },
                NoLock = true,
            };

            var manualFilter = new FilterExpression(LogicalOperator.Or);
            manualFilter.AddCondition(DistributionsAttributes.ManualEntry, ConditionOperator.Equal, false);
            manualFilter.AddCondition(DistributionsAttributes.ManualEntry, ConditionOperator.Null);
            query.Criteria.AddFilter(manualFilter);

            // The FE inner join both scopes to the requested type and excludes
            // FE-less rows — matching the group-pass scoping.
            var feLink = query.AddLink(EntityNames.FundingEvent, DistributionsAttributes.FundingEvent, FundingEventAttributes.Id);
            if (fundingTypeFilter.HasValue)
                feLink.LinkCriteria.AddCondition(FundingEventAttributes.FundingType, ConditionOperator.Equal, fundingTypeFilter.Value);

            if (fiscalYearFilter.HasValue)
            {
                var fundLink = query.AddLink(EntityNames.Fund, DistributionsAttributes.Fund, FundAttributes.Id);
                fundLink.LinkCriteria.AddCondition(FundAttributes.FiscalYear, ConditionOperator.Equal, fiscalYearFilter.Value);
            }

            query.AddOrder("createdon", OrderType.Ascending);

            var rows = new List<PendingSweepRow>();
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                foreach (var r in page.Entities)
                {
                    var fcRef = r.GetAttributeValue<EntityReference>(DistributionsAttributes.FundCenter);
                    var fundRef = r.GetAttributeValue<EntityReference>(DistributionsAttributes.Fund);
                    var pgRef = r.GetAttributeValue<EntityReference>(DistributionsAttributes.PGSAG);
                    if (fcRef == null || fundRef == null || pgRef == null) continue;
                    rows.Add(new PendingSweepRow
                    {
                        Id = r.Id,
                        FundCenterId = fcRef.Id,
                        FundId = fundRef.Id,
                        PgId = pgRef.Id,
                        FundingEventId = r.GetAttributeValue<EntityReference>(DistributionsAttributes.FundingEvent)?.Id ?? Guid.Empty,
                        Direction = r.GetAttributeValue<OptionSetValue>(DistributionsAttributes.DisbursementDirection)?.Value ?? -1,
                        Amount = NumericHelper.ToDecimal(r, DistributionsAttributes.Amount) ?? 0m,
                        DebitedDistributionId = r.GetAttributeValue<EntityReference>(DistributionsAttributes.DebitedDistribution)?.Id,
                    });
                }
                if (!page.MoreRecords) break;
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
            return rows;
        }

        // -----------------------------------------------------------------
        // Which of the given Distribution ids carry an entry document number.
        // Retrieved regardless of statecode — an entered debit anchors its
        // credits whether or not it is still active.
        // -----------------------------------------------------------------
        private static HashSet<Guid> RetrieveEnteredDistributionIds(
            IOrganizationService service, IList<Guid> ids)
        {
            var entered = new HashSet<Guid>();
            if (ids == null || ids.Count == 0) return entered;

            const int chunkSize = 500;
            for (var offset = 0; offset < ids.Count; offset += chunkSize)
            {
                var chunk = ids.Skip(offset).Take(chunkSize).Cast<object>().ToArray();
                var query = new QueryExpression(EntityNames.Distributions)
                {
                    ColumnSet = new ColumnSet(DistributionsAttributes.Id),
                    Criteria = new FilterExpression(LogicalOperator.And)
                    {
                        Conditions =
                        {
                            new ConditionExpression(DistributionsAttributes.Id, ConditionOperator.In, chunk),
                            new ConditionExpression(DistributionsAttributes.EntryDocumentNumber, ConditionOperator.NotNull),
                        },
                    },
                    NoLock = true,
                };
                foreach (var row in service.RetrieveMultiple(query).Entities)
                    entered.Add(row.Id);
            }
            return entered;
        }

        // -----------------------------------------------------------------
        // Resolve every Funding Event whose [start, end] spans today and whose
        // type matches the optional FundingType filter (null = both).
        // -----------------------------------------------------------------
        private static List<Entity> ResolveActiveFundingEvents(
            IOrganizationService service, ITracingService tracing, int? fundingTypeFilter)
        {
            var today = DateTime.UtcNow.Date;

            var criteria = new FilterExpression(LogicalOperator.And)
            {
                Conditions =
                {
                    new ConditionExpression(FundingEventAttributes.StartDate, ConditionOperator.OnOrBefore, today),
                    new ConditionExpression(FundingEventAttributes.EndDate,   ConditionOperator.OnOrAfter,  today),
                    new ConditionExpression(FundingEventAttributes.StateCode, ConditionOperator.Equal,     StateCodeValues.Active),
                },
            };
            if (fundingTypeFilter.HasValue)
                criteria.AddCondition(FundingEventAttributes.FundingType, ConditionOperator.Equal, fundingTypeFilter.Value);

            var query = new QueryExpression(EntityNames.FundingEvent)
            {
                ColumnSet = new ColumnSet(FundingEventAttributes.Id, FundingEventAttributes.FundingType),
                Criteria = criteria,
                NoLock = true,
            };
            // Deterministic order so cursor index has a chance of staying stable,
            // though we resume by FE Guid anyway.
            query.AddOrder(FundingEventAttributes.Id, OrderType.Ascending);

            var events = service.RetrieveMultiple(query).Entities.ToList();
            tracing.Trace($"Resolved {events.Count} active Funding Event(s).");
            return events;
        }

        // -----------------------------------------------------------------
        // Phase 2 aggregation: active Prioritizations with funded TDP > 0,
        // grouped by (prio_fc, state, PG, fund, FY). Destination FC is resolved
        // per-row by walking up the FundCenter parent chain to state (the FC
        // whose parent is the holding FC) — same rule as Phase 3. Applies to
        // both centrally-managed Prios (Prio.FC = Req.FC via
        // PrioritizationFundCenterBackfill, can sit several hops below state,
        // e.g. A1834 → A18NG → A18) and non-centrally-managed Prios (Prio.FC is
        // typically a state child, one hop from state). A one-hop rule was
        // wrong for the former and coincidentally right for the common case of
        // the latter; the walk handles both.
        // FY filter (optional) constrains to a single book_fund.book_fiscalyear.
        //
        // Post-aggregation the raw fetch rows are COLLAPSED by destination
        // (FundId, destFcId, PgId, FiscalYear) — multiple child FCs walking up
        // to the same state resolve to the same destination, and treating them
        // as separate buckets caused the second bucket to see the first's
        // credits and mistakenly ping-pong between under-provisioning and
        // spurious Sweep Turn-Ins.
        // -----------------------------------------------------------------
        private static List<DistributionBucket> QueryPrioritizationBuckets(
            IOrganizationService service, ITracingService tracing,
            Guid holdingFundCenterId, Dictionary<Guid, FundCenterMeta> fcCache,
            int? fiscalYearFilter)
        {
            var fyCondition = fiscalYearFilter.HasValue
                ? $"<condition attribute='book_fiscalyear' operator='eq' value='{fiscalYearFilter.Value}' />"
                : string.Empty;

            var fetchXml = $@"
<fetch aggregate='true' no-lock='true'>
  <entity name='book_prioritization'>
    <attribute name='book_newfundedamounttdp' alias='total_funding' aggregate='sum' />
    <filter type='and'>
      <condition attribute='statecode'                operator='eq' value='0' />
      <condition attribute='book_newfundedamounttdp' operator='gt' value='0' />
    </filter>
    <link-entity name='book_fundcenter' from='book_fundcenterid' to='book_fundcenter' link-type='inner' alias='fundcenter'>
      <attribute name='book_fundcenterid' alias='prio_fc_id' groupby='true' />
    </link-entity>
    <link-entity name='book_state' from='book_stateid' to='book_state' link-type='inner' alias='state'>
      <attribute name='book_stateid' alias='state_id' groupby='true' />
    </link-entity>
    <link-entity name='book_requirementfunding' from='book_requirementfundingid' to='book_requirementfunding' link-type='inner' alias='req_funding'>
      <link-entity name='book_fundingline' from='book_fundinglineid' to='book_lineofaccounting' link-type='inner' alias='loa'>
        <link-entity name='book_pg' from='book_pgid' to='book_pg' link-type='inner' alias='pg'>
          <attribute name='book_pgid' alias='pg_id' groupby='true' />
        </link-entity>
        <link-entity name='book_fund' from='book_fundid' to='book_fund' link-type='inner' alias='fund'>
          <filter type='and'>{fyCondition}</filter>
          <attribute name='book_fundid'     alias='fund_id' groupby='true' />
          <attribute name='book_fiscalyear' alias='fy'      groupby='true' />
        </link-entity>
      </link-entity>
    </link-entity>
  </entity>
</fetch>";

            var rows = service.RetrieveMultiple(new FetchExpression(fetchXml)).Entities;
            tracing.Trace($"Phase 2: {rows.Count} raw Prioritization aggregation row(s)" +
                          (fiscalYearFilter.HasValue ? $" (FY={fiscalYearFilter.Value})." : "."));

            var collapsed = new Dictionary<string, DistributionBucket>(rows.Count);
            foreach (var row in rows)
            {
                var prioFcId = AliasedValueHelper.GetGuid(row, "prio_fc_id");
                var fundId   = AliasedValueHelper.GetGuid(row, "fund_id");
                var pgId     = AliasedValueHelper.GetGuid(row, "pg_id");
                if (prioFcId == Guid.Empty || fundId == Guid.Empty || pgId == Guid.Empty)
                    continue;

                // Walk up to the state-level FC (parent == holding). Same rule
                // as Phase 3; handles centrally-managed Prios that sit several
                // hops below state (Prio.FC = Req.FC, e.g. A1834 → A18NG → A18).
                var destFcId = FundCenterWalkHelper.ResolveStateFundCenter(service, fcCache, tracing, prioFcId, holdingFundCenterId);
                if (destFcId == Guid.Empty)
                    continue;

                var fy      = AliasedValueHelper.GetInt(row, "fy");
                var funded  = AliasedValueHelper.GetDecimal(row, "total_funding");
                var key     = $"{fundId}|{destFcId}|{pgId}|{fy}";

                if (collapsed.TryGetValue(key, out var existing))
                {
                    existing.TotalFunding += funded;
                }
                else
                {
                    collapsed[key] = new DistributionBucket
                    {
                        FundId             = fundId,
                        PgId               = pgId,
                        FundCenterId       = destFcId,
                        FiscalYear         = fy,
                        TotalFunding       = funded,
                        OwningBusinessUnit = FundCenterWalkHelper.GetFundCenterMeta(service, fcCache, destFcId)?.OwningBusinessUnit,
                    };
                }
            }

            tracing.Trace($"Phase 2: collapsed to {collapsed.Count} destination bucket(s).");
            return collapsed.Values.ToList();
        }

        // -----------------------------------------------------------------
        // Phase 3 aggregation: BE-approved Requirements that have no
        // Prioritizations, grouped by (fundcenter_id, PG, fund, FY). Bucket FC
        // is resolved per-row by walking up the FundCenter parent chain until
        // we reach an FC whose parent is the holding FC (state-level). Reqs
        // may sit multiple levels below the state, so a one-hop lookup is not
        // enough — we keep hopping until FC.parent == holding, or the chain
        // ends (null / missing metadata), or the parent equals the holding FC
        // itself (already at state). Today the qualifying types are TARC (1)
        // and ARNG External (4) — both centrally managed without Prios.
        // Centrally managed Reqs that DO have Prios (State+national=1, PEC FY26
        // centrally, DOMOPs) flow through Phase 2 instead; the outer-join
        // null-check on book_prioritization guards against stray Prios under a
        // type meant to be Prio-less so we never double-count.
        // FY filter (optional) constrains to a single book_fund.book_fiscalyear.
        // -----------------------------------------------------------------
        private static List<DistributionBucket> QueryRequirementBuckets(
            IOrganizationService service, ITracingService tracing,
            Guid holdingFundCenterId, Dictionary<Guid, FundCenterMeta> fcCache,
            int? fiscalYearFilter)
        {
            var fyCondition = fiscalYearFilter.HasValue
                ? $"<condition attribute='book_fiscalyear' operator='eq' value='{fiscalYearFilter.Value}' />"
                : string.Empty;

            var fetchXml = $@"
<fetch aggregate='true' no-lock='true'>
  <entity name='book_requirementfunding'>
    <attribute name='book_newfundedamount' alias='total_funding' aggregate='sum' />
    <filter type='and'>
      <condition attribute='book_newfundedamount' operator='gt' value='0' />
      <condition entityname='prio_chk' attribute='book_prioritizationid' operator='null' />
    </filter>
    <link-entity name='book_requirements' from='book_requirementsid' to='book_requirement' link-type='inner' alias='reqs'>
      <filter type='and'>
        <condition attribute='book_approvalstatus' operator='eq' value='{RequirementApprovalStatusValues.BEApproved}' />
        <condition attribute='statecode'           operator='eq' value='{StateCodeValues.Active}' />
        <filter type='or'>
          <condition attribute='book_type' operator='eq' value='{RequirementTypeValues.TARC}' />
          <condition attribute='book_type' operator='eq' value='{RequirementTypeValues.ARNGExternal}' />
        </filter>
      </filter>
      <link-entity name='book_fundcenter' from='book_fundcenterid' to='book_fundcenter' link-type='inner' alias='fundcenter'>
        <attribute name='book_fundcenterid' alias='fundcenter_id' groupby='true' />
      </link-entity>
    </link-entity>
    <link-entity name='book_fundingline' from='book_fundinglineid' to='book_lineofaccounting' link-type='inner' alias='loa'>
      <link-entity name='book_pg' from='book_pgid' to='book_pg' link-type='inner' alias='pg'>
        <attribute name='book_pgid' alias='pg_id' groupby='true' />
      </link-entity>
      <link-entity name='book_fund' from='book_fundid' to='book_fund' link-type='inner' alias='fund'>
        <filter type='and'>{fyCondition}</filter>
        <attribute name='book_fundid'      alias='fund_id' groupby='true' />
        <attribute name='book_fiscalyear'  alias='fy'      groupby='true' />
      </link-entity>
    </link-entity>
    <link-entity name='book_prioritization' from='book_requirementfunding' to='book_requirementfundingid' link-type='outer' alias='prio_chk'>
      <filter type='and'>
        <condition attribute='statecode' operator='eq' value='0' />
      </filter>
    </link-entity>
  </entity>
</fetch>";

            var rows = service.RetrieveMultiple(new FetchExpression(fetchXml)).Entities;
            tracing.Trace($"Phase 3: {rows.Count} raw Requirement-Funding aggregation row(s)" +
                          (fiscalYearFilter.HasValue ? $" (FY={fiscalYearFilter.Value})." : "."));

            var collapsed = new Dictionary<string, DistributionBucket>(rows.Count);
            foreach (var row in rows)
            {
                var fcId   = AliasedValueHelper.GetGuid(row, "fundcenter_id");
                var fundId = AliasedValueHelper.GetGuid(row, "fund_id");
                var pgId   = AliasedValueHelper.GetGuid(row, "pg_id");
                if (fcId == Guid.Empty || fundId == Guid.Empty || pgId == Guid.Empty)
                    continue;

                // Walk up to the state-level FC (the one whose parent is the
                // holding FC). Stops early if the chain runs out or metadata
                // is missing, and has a hard hop cap to guard against a cyclic
                // parent-of graph.
                var destFc = FundCenterWalkHelper.ResolveStateFundCenter(service, fcCache, tracing, fcId, holdingFundCenterId);

                var fy     = AliasedValueHelper.GetInt(row, "fy");
                var funded = AliasedValueHelper.GetDecimal(row, "total_funding");
                var key    = $"{fundId}|{destFc}|{pgId}|{fy}";

                if (collapsed.TryGetValue(key, out var existing))
                {
                    existing.TotalFunding += funded;
                }
                else
                {
                    collapsed[key] = new DistributionBucket
                    {
                        FundId             = fundId,
                        PgId               = pgId,
                        FundCenterId       = destFc,
                        FiscalYear         = fy,
                        TotalFunding       = funded,
                        OwningBusinessUnit = FundCenterWalkHelper.GetFundCenterMeta(service, fcCache, destFc)?.OwningBusinessUnit,
                    };
                }
            }

            tracing.Trace($"Phase 3: collapsed to {collapsed.Count} destination bucket(s).");
            return collapsed.Values.ToList();
        }

        // -----------------------------------------------------------------
        // Group collapsed buckets by (FundId, PgId) — one group amends one
        // consolidated pending debit at the holding FC plus N pending credits.
        // Deterministic ordering (by FundId then PgId as GUID strings) so the
        // continuation cursor's group index is stable across invocations of
        // the same run. Within a group, destinations are ordered by FC GUID
        // for readable tracing.
        // -----------------------------------------------------------------
        private static List<List<DistributionBucket>> GroupByFundAndPg(List<DistributionBucket> buckets)
        {
            return buckets
                .GroupBy(b => new { b.FundId, b.PgId })
                .OrderBy(g => g.Key.FundId).ThenBy(g => g.Key.PgId)
                .Select(g => g.OrderBy(b => b.FundCenterId).ToList())
                .ToList();
        }

        // -----------------------------------------------------------------
        // Continuation cursor — tiny key=value text, no escaping needed since
        // values are int / Guid only. Three states:
        //   phase=2;fe=<guid>;idx=<n>      → mid-Phase-2 of FE <guid>, (Fund,PG) group <n>
        //   phase=3;fe=<guid>;idx=<n>      → mid-Phase-3 of FE <guid>, (Fund,PG) group <n>
        //   phase=4                        → Phase 4 (orphan cleanup) incomplete
        // idx is a group index (see GroupByFundAndPg) — never within a group, so
        // a group's pending debit+credits are always reconciled atomically.
        // Legacy phase=1 tokens (from the retired deactivation sweep) parse as
        // a fresh start.
        // -----------------------------------------------------------------
        private sealed class Cursor
        {
            public int Phase;
            public Guid FundingEventId;
            public int BucketIdx;

            public string Serialize() =>
                Phase == 4 ? "phase=4" : $"phase={Phase};fe={FundingEventId};idx={BucketIdx}";

            public static Cursor Parse(string s)
            {
                if (string.IsNullOrWhiteSpace(s)) return null;
                var c = new Cursor();
                foreach (var part in s.Split(';'))
                {
                    var kv = part.Split(new[] { '=' }, 2);
                    if (kv.Length != 2) continue;
                    switch (kv[0].Trim())
                    {
                        case "phase":
                            if (int.TryParse(kv[1], out var p)) c.Phase = p;
                            break;
                        case "fe":
                            if (Guid.TryParse(kv[1], out var g)) c.FundingEventId = g;
                            break;
                        case "idx":
                            if (int.TryParse(kv[1], out var i)) c.BucketIdx = i;
                            break;
                    }
                }
                if (c.Phase == 4) return c;
                if ((c.Phase == 2 || c.Phase == 3) && c.FundingEventId != Guid.Empty) return c;
                return null;
            }
        }

        private static void WriteOutputs(IPluginExecutionContext context,
            int deactivated, int created, int updated, int turnIns, int skipped, Cursor cursor)
        {
            context.OutputParameters["Deactivated"]    = deactivated;
            context.OutputParameters["Created"]        = created;
            context.OutputParameters["Updated"]        = updated;
            context.OutputParameters["TurnInsCreated"] = turnIns;
            context.OutputParameters["Skipped"]        = skipped;
            context.OutputParameters["NextToken"]      = cursor != null ? cursor.Serialize() : string.Empty;
        }
    }
}
