using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Custom API handler for <c>book_RecalculateLOATDP</c>. Bulk-reconciles
    /// <c>book_newtdp</c> / <c>book_newtdpremaining</c> on active LOAs by
    /// recomputing each from scratch (<c>Σ active-FT book_newresourceamount +
    /// Ledger net − allocated</c>) via
    /// <see cref="TDPCalculationHelper.BatchRecalculateLOATDP"/>.
    ///
    /// Why this exists: the PostOp <see cref="FundingTrackTDPRecalculator"/>
    /// (via <see cref="LOATouchPropagator"/>) skips at <c>Depth &gt; 1</c>.
    /// Funding Tracks are bulk-loaded through Edit-in-Excel / the Import
    /// Wizard, which write each row *nested under a data-import job* — i.e. at
    /// Depth 2 — so the recalc is suppressed and LOA TDP never rolls up from
    /// the imported Beginning Balances. Day-to-day Decision edits recompute TDP
    /// fine (they run at Depth 1 through the <c>book_decision</c> step); this
    /// API is the deliberate, restartable reconcile for the annual bulk load
    /// (and any other bulk change that lands deep in the pipeline).
    ///
    /// Invoked directly, this runs at Depth 1, so the guard is a non-issue: the
    /// LOA updates it issues land at Depth 2, where
    /// <see cref="FundingLineTDPRemainingUpdater"/> already allows them through.
    /// The recompute is idempotent, so partial runs are safe to re-run.
    ///
    /// Input parameters:
    ///   <c>FiscalYear</c> (int, optional) — LOA <c>book_fiscalyear</c> option-set
    ///                                       value to limit the scope. 0 / omit = all FYs.
    ///   <c>BatchSize</c>  (int, optional) — Max LOAs to reconcile this invocation.
    ///                                       0 / omit = every LOA in scope in one shot
    ///                                       (run the API *async* for large sets to dodge
    ///                                       the 2-minute sync-sandbox limit). When &gt; 0,
    ///                                       the caller pages with <c>PageNumber</c> until
    ///                                       <c>HasMore</c> is false.
    ///   <c>PageNumber</c> (int, optional) — 1-based page for sliced runs; default 1.
    ///                                       Only meaningful with <c>BatchSize &gt; 0</c>;
    ///                                       keep <c>BatchSize</c> constant across the loop.
    ///
    /// Output parameters:
    ///   <c>TotalInScope</c> (int)  — Active LOAs matching the scope.
    ///   <c>Processed</c>    (int)  — LOAs reconciled this invocation.
    ///   <c>HasMore</c>      (bool) — More LOAs remain beyond this page (BatchSize runs only).
    ///
    /// Per-LOA failures never abort the pass — <c>BatchRecalculateLOATDP</c>
    /// catches, traces, and continues. Because the recompute is idempotent,
    /// just re-run to pick up any that failed.
    /// </summary>
    public class LOATDPReconciler : PluginBase
    {
        private const string MessageName = "book_RecalculateLOATDP";

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

            int fiscalYearFilter = 0;
            if (context.InputParameters.TryGetValue("FiscalYear", out var fyRaw) && fyRaw is int fy && fy > 0)
                fiscalYearFilter = fy;

            int batchSize = 0;
            if (context.InputParameters.TryGetValue("BatchSize", out var bsRaw) && bsRaw is int bs && bs > 0)
                batchSize = bs;

            int pageNumber = 1;
            if (context.InputParameters.TryGetValue("PageNumber", out var pnRaw) && pnRaw is int pn && pn > 0)
                pageNumber = pn;

            tracing.Trace($"Reconciling LOA TDP (FiscalYear filter = " +
                          $"{(fiscalYearFilter == 0 ? "none" : fiscalYearFilter.ToString())}, " +
                          $"BatchSize = {(batchSize == 0 ? "unlimited" : batchSize.ToString())}, " +
                          $"PageNumber = {pageNumber}).");

            var loaIds = new List<Guid>();
            int totalInScope;
            bool hasMore;

            if (batchSize > 0)
            {
                CollectLoaPage(service, fiscalYearFilter, batchSize, pageNumber, loaIds,
                               out totalInScope, out hasMore);
            }
            else
            {
                CollectAllLoas(service, fiscalYearFilter, loaIds);
                totalInScope = loaIds.Count;
                hasMore = false;
            }

            tracing.Trace($"Scope: {totalInScope} active LOA(s); reconciling {loaIds.Count} this invocation.");

            if (loaIds.Count > 0)
                TDPCalculationHelper.BatchRecalculateLOATDP(service, loaIds, tracing);

            tracing.Trace($"Reconcile done: {loaIds.Count} processed, HasMore={hasMore}.");

            context.OutputParameters["TotalInScope"] = totalInScope;
            context.OutputParameters["Processed"]    = loaIds.Count;
            context.OutputParameters["HasMore"]      = hasMore;
        }

        /// <summary>
        /// Fetches exactly one page of active LOA ids in a stable order, and
        /// reports the total in scope plus whether more pages remain.
        /// </summary>
        private static void CollectLoaPage(
            IOrganizationService service,
            int fiscalYearFilter,
            int batchSize,
            int pageNumber,
            ICollection<Guid> loaIds,
            out int totalInScope,
            out bool hasMore)
        {
            var query = BuildActiveLoaQuery(fiscalYearFilter);
            query.PageInfo = new PagingInfo
            {
                Count = batchSize,
                PageNumber = pageNumber,
                ReturnTotalRecordCount = true,
            };

            var page = service.RetrieveMultiple(query);
            foreach (var loa in page.Entities)
                loaIds.Add(loa.Id);

            totalInScope = page.TotalRecordCount >= 0 ? page.TotalRecordCount : loaIds.Count;
            hasMore = page.MoreRecords;
        }

        /// <summary>
        /// Pages through and collects every active LOA id in scope. Used for the
        /// single-shot (unlimited) path — run the API async for large datasets.
        /// </summary>
        private static void CollectAllLoas(
            IOrganizationService service,
            int fiscalYearFilter,
            ICollection<Guid> loaIds)
        {
            var query = BuildActiveLoaQuery(fiscalYearFilter);
            query.PageInfo = new PagingInfo { Count = 500, PageNumber = 1, ReturnTotalRecordCount = false };

            while (true)
            {
                var page = service.RetrieveMultiple(query);
                foreach (var loa in page.Entities)
                    loaIds.Add(loa.Id);

                if (!page.MoreRecords)
                    return;

                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
        }

        /// <summary>
        /// Active LOAs, optionally restricted to a fiscal year, id-only, in a
        /// stable order (createdon, then id) so page-number paging is repeatable.
        /// </summary>
        private static QueryExpression BuildActiveLoaQuery(int fiscalYearFilter)
        {
            var query = new QueryExpression(EntityNames.FundingLine)
            {
                ColumnSet = new ColumnSet(FundingLineAttributes.Id),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingLineAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                Orders =
                {
                    new OrderExpression("createdon", OrderType.Ascending),
                    new OrderExpression(FundingLineAttributes.Id, OrderType.Ascending),
                },
                NoLock = true,
            };

            if (fiscalYearFilter > 0)
                query.Criteria.AddCondition(FundingLineAttributes.FiscalYear, ConditionOperator.Equal, fiscalYearFilter);

            return query;
        }
    }
}
