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
    /// Phase 4 of book_GenerateDistributions — orphan cleanup of pending sweep rows.
    /// </summary>
    internal static class DistributionOrphanCleanup
    {
        // -----------------------------------------------------------------
        // Phase 4: deactivate pending sweep rows whose (Fund, FC, PG) matches no
        // current bucket (funded dropped to zero, FC re-parented, FY closed out),
        // then re-sync each pending holding-FC debit to the sum of its group's
        // surviving pending credits. Idempotent — a resumed invocation restarts
        // the phase from scratch and the queries exclude already-deactivated rows.
        //
        // Pending sweep rows = active + no entry document number + not manual +
        // no pipeline link (DistributionsAttributes.PipelineParentLinks) + carrying a FundingEvent of a processed
        // type; a pending credit paired (book_debiteddistribution) to an already
        // GFEBS-entered debit is left alone to preserve the entered pairing.
        // -----------------------------------------------------------------
        internal sealed class CleanupResult
        {
            public int Deactivated;
            public int Updated;
            public bool Complete = true;
        }

        internal static CleanupResult Run(
            IOrganizationService service, ITracingService tracing,
            Guid holdingFundCenterId, Dictionary<Guid, FundCenterMeta> fcCache,
            int? fundingTypeFilter, int? fiscalYearFilter,
            Stopwatch stopwatch, TimeSpan budget)
        {
            var result = new CleanupResult();
            // Tolerant flush: Phase 4 updates rows off a snapshot taken up front, so
            // a row a concurrent transaction deletes before the flush must be skipped,
            // not allowed to abort the whole (idempotent) cleanup chunk.
            var batch = new BatchWriter(service, tracing, continueOnError: true);
            tracing.Trace("Phase 4: orphan cleanup starting.");

            // Live bucket keys, re-derived from the same aggregations Phases 2+3 use.
            var bucketKeys = new HashSet<string>(
                DistributionBucketQueries.QueryPrioritizationBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter)
                    .Concat(DistributionBucketQueries.QueryRequirementBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter))
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
            var pendingIds = new HashSet<Guid>(pending.Select(p => p.Id));
            var pairedDebitIds = orphanCandidates
                .Where(c => c.DebitedDistributionId.HasValue)
                .Select(c => c.DebitedDistributionId.Value)
                .Distinct()
                .Where(id => !pendingIds.Contains(id))
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
                    batch.Flush();
                    result.Complete = false;
                    return result;
                }
                batch.Update(new Entity(EntityNames.Distributions, orphan.Id)
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
                    batch.Flush();
                    result.Complete = false;
                    return result;
                }

                // Retrieval is createdon-ordered — keep the oldest, drop duplicates.
                var keeper = debitGroup.First();
                foreach (var extra in debitGroup.Skip(1))
                {
                    batch.Update(new Entity(EntityNames.Distributions, extra.Id)
                    {
                        [DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive),
                    });
                    result.Deactivated++;
                    tracing.Trace($"  → Deactivated duplicate pending debit {extra.Id}.");
                }

                creditSums.TryGetValue(debitGroup.Key, out var creditSum);
                if (creditSum <= 0m)
                {
                    batch.Update(new Entity(EntityNames.Distributions, keeper.Id)
                    {
                        [DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive),
                    });
                    result.Deactivated++;
                    tracing.Trace($"  → Deactivated pending debit {keeper.Id} (no surviving pending credits).");
                }
                else if (keeper.Amount != creditSum)
                {
                    batch.Update(new Entity(EntityNames.Distributions, keeper.Id)
                    {
                        [DistributionsAttributes.Amount] = creditSum,
                    });
                    result.Updated++;
                    tracing.Trace($"  → Re-synced pending debit {keeper.Id}: {keeper.Amount:C} → {creditSum:C}.");
                }
            }

            batch.Flush();
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
                    },
                },
                PageInfo = new PagingInfo { Count = 5000, PageNumber = 1, ReturnTotalRecordCount = false },
                // Read-committed (no NoLock): every row here becomes a blind Update
                // target at flush time, so a dirty read of an uncommitted/rolled-back
                // row would queue an update against a GUID that never commits
                // ("... With Id=... Does Not Exist"). Correctness over the marginal
                // lock cost — Phase 4 touches far fewer rows than the group passes.
            };

            // Pipeline-owned rows (Turn-In / Swap / Realignment) are never sweep rows.
            foreach (var parentLink in DistributionsAttributes.PipelineParentLinks)
                query.Criteria.AddCondition(parentLink, ConditionOperator.Null);

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
                    // Read-committed: this gates whether a paired debit is treated as
                    // immutable (entered), so it must not hinge on a dirty read.
                };
                foreach (var row in service.RetrieveMultiple(query).Entities)
                    entered.Add(row.Id);
            }
            return entered;
        }

    }
}
