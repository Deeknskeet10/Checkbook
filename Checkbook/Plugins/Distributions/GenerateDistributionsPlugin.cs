using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
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
    /// Three phases (mirroring the original flow):
    /// <list type="number">
    ///   <item>Deactivate every active <c>book_distributions</c> whose
    ///         <c>book_newenteredintogfebs = "No"</c>.</item>
    ///   <item>Aggregate active Prioritizations into (dest_fc, PG, fund, FY) buckets,
    ///         then group buckets by (Fund, PG). Per group: compute per-destination
    ///         target vs existing credits, then emit ONE consolidated debit at the
    ///         holding FC (sum of shortfalls) plus one credit per shortfall destination
    ///         pointing at that debit; per-destination overages/evens roll through the
    ///         Sweep Turn-In machinery unchanged. Destination FC is the Prio's own FC
    ///         when the Requirement is centrally managed (book_national = 1; FC is
    ///         backfilled from Req by <c>PrioritizationFundCenterBackfill</c>) and the
    ///         Prio's parent FC otherwise.</item>
    ///   <item>Same reconciliation for BE-approved Requirements that have no
    ///         Prioritizations (types TARC + ARNGExternal, or national State-type),
    ///         grouped on (fundcenter, PG, fund, FY); the bucket FC is resolved as
    ///         parent-or-self relative to the holding FC.</item>
    /// </list>
    ///
    /// Input parameters:
    ///   <c>FundingType</c>        (int, optional)    — 0 = AFP only, 1 = Allotment only, omitted = both.
    ///   <c>FiscalYear</c>         (int, optional)    — option-set value on book_fund.book_fiscalyear;
    ///                                                  filters Phase 2 + 3 buckets. Omitted = all FYs.
    ///   <c>NextToken</c>          (string, optional) — opaque resume marker returned by a prior call.
    ///                                                  Empty/missing = fresh start. (The wire-level
    ///                                                  name is <c>NextToken</c>; internally the
    ///                                                  concept is a continuation cursor. Renamed
    ///                                                  from <c>ContinuationToken</c> to sidestep an
    ///                                                  orphaned Boolean-typed sdkmessageresponsefield
    ///                                                  row in the target org.)
    ///
    /// Output parameters:
    ///   <c>Deactivated</c>        (int) — Phase 1 distributions set inactive in THIS invocation.
    ///   <c>Created</c>            (int) — Distribution rows created in Phases 2 + 3 (each
    ///                                     consolidated debit counts 1, plus 1 per credit).
    ///   <c>TurnInsCreated</c>     (int) — Overage Turn-Ins created in Phases 2 + 3.
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
            // buckets, since bucket construction now resolves owning BU).
            var fcCache  = new Dictionary<Guid, FundCenterMeta>();
            var pctCache = new Dictionary<string, FundingPercentageHelper.FundingResolution>();

            // Debit rows live at the holding FC — own them by the holding FC's BU.
            var holdingOwningBu = GetFundCenterMeta(service, fcCache, holdingFundCenterId)?.OwningBusinessUnit;

            var stopwatch = Stopwatch.StartNew();

            var deactivated = 0;
            var totalCreated = 0;
            var totalTurnIns = 0;
            var totalSkipped = 0;
            Cursor outCursor = null;

            // ---- Phase 1 (skip if resuming past it) --------------------------
            if (cursor == null || cursor.Phase <= 1)
            {
                deactivated = DeactivateUnactionedDistributions(
                    service, tracing, stopwatch, TimeBudget, out var phase1Complete);
                if (!phase1Complete)
                {
                    tracing.Trace("Phase 1 incomplete — returning continuation (phase=1).");
                    WriteOutputs(context, deactivated, 0, 0, 0, new Cursor { Phase = 1 });
                    return;
                }
            }

            // ---- Resolve Funding Events (re-resolved each invocation) --------
            var fundingEvents = ResolveActiveFundingEvents(service, tracing, fundingTypeFilter);
            if (fundingEvents.Count == 0)
            {
                tracing.Trace("No active Funding Events match the filter — Phases 2 + 3 skipped.");
                WriteOutputs(context, deactivated, 0, 0, 0, null);
                return;
            }

            // Determine starting (fe-index, phase, bucket-idx) from the cursor.
            var startFeIdx   = 0;
            var startPhase   = 2;
            var startBucket  = 0;
            if (cursor != null && cursor.Phase >= 2)
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
                if (startPhase <= 2)
                {
                    var phase2Buckets = QueryPrioritizationBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter);
                    var phase2Groups  = GroupByFundAndPg(phase2Buckets);
                    tracing.Trace($"Phase 2: {phase2Groups.Count} (Fund, PG) group(s) to process.");
                    var groupStart = (feIdx == startFeIdx && startPhase == 2) ? startBucket : 0;
                    for (var i = groupStart; i < phase2Groups.Count; i++)
                    {
                        if (stopwatch.Elapsed > TimeBudget)
                        {
                            outCursor = new Cursor { Phase = 2, FundingEventId = fundingEvent.Id, BucketIdx = i };
                            tracing.Trace($"Time budget reached at FE {fundingEvent.Id} Phase 2 group {i} — returning continuation.");
                            WriteOutputs(context, deactivated, totalCreated, totalTurnIns, totalSkipped, outCursor);
                            return;
                        }
                        var r = DistributionBucketProcessor.ProcessGroup(
                            service, tracing, phase2Groups[i], fundingEventRef, fundingType,
                            holdingFundCenterId, holdingOwningBu, pctCache);
                        totalCreated += r.DistributionsCreated;
                        totalTurnIns += r.TurnInsCreated;
                        totalSkipped += r.Skipped;
                    }
                }

                // ---- Phase 3 — Requirements ----------------------------------
                {
                    var phase3Buckets = QueryRequirementBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter);
                    var phase3Groups  = GroupByFundAndPg(phase3Buckets);
                    tracing.Trace($"Phase 3: {phase3Groups.Count} (Fund, PG) group(s) to process.");
                    var groupStart = (feIdx == startFeIdx && startPhase == 3) ? startBucket : 0;
                    for (var i = groupStart; i < phase3Groups.Count; i++)
                    {
                        if (stopwatch.Elapsed > TimeBudget)
                        {
                            outCursor = new Cursor { Phase = 3, FundingEventId = fundingEvent.Id, BucketIdx = i };
                            tracing.Trace($"Time budget reached at FE {fundingEvent.Id} Phase 3 group {i} — returning continuation.");
                            WriteOutputs(context, deactivated, totalCreated, totalTurnIns, totalSkipped, outCursor);
                            return;
                        }
                        var r = DistributionBucketProcessor.ProcessGroup(
                            service, tracing, phase3Groups[i], fundingEventRef, fundingType,
                            holdingFundCenterId, holdingOwningBu, pctCache);
                        totalCreated += r.DistributionsCreated;
                        totalTurnIns += r.TurnInsCreated;
                        totalSkipped += r.Skipped;
                    }
                }

                // Once we've finished an FE, subsequent ones start from Phase 2 / group 0.
                startPhase = 2;
                startBucket = 0;
            }

            WriteOutputs(context, deactivated, totalCreated, totalTurnIns, totalSkipped, null);
        }

        // -----------------------------------------------------------------
        // Phase 1: deactivate every active Distribution flagged not-entered-into-GFEBS.
        // Batches each 100-row page into a single ExecuteMultipleRequest. Cascading
        // plugins/workflows on book_distributions can make each deactivation slow,
        // so we check the time budget between pages and bail with a Phase 1 cursor
        // if needed — on resume the query re-runs (its filter excludes already-
        // inactive rows, so the work is idempotent and just picks up where we left off).
        // -----------------------------------------------------------------
        private static int DeactivateUnactionedDistributions(
            IOrganizationService service, ITracingService tracing,
            Stopwatch stopwatch, TimeSpan budget, out bool complete)
        {
            tracing.Trace("Phase 1: starting deactivation sweep.");

            var query = new QueryExpression(EntityNames.Distributions)
            {
                ColumnSet = new ColumnSet(DistributionsAttributes.Id),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(DistributionsAttributes.EnteredIntoGFEBS, ConditionOperator.Equal, "No"),
                        new ConditionExpression(DistributionsAttributes.StateCode,        ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                // Smaller pages = more chances to check the time budget. Each
                // statecode update can fan out to cascading plugins, so 100 is a
                // reasonable bound for a 2-min sandbox.
                PageInfo = new PagingInfo { Count = 100, PageNumber = 1, ReturnTotalRecordCount = false },
                NoLock = true,
            };

            var count = 0;
            var pageNum = 0;
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                pageNum++;
                if (page.Entities.Count > 0)
                {
                    var req = new ExecuteMultipleRequest
                    {
                        Settings = new ExecuteMultipleSettings { ContinueOnError = false, ReturnResponses = false },
                        Requests = new OrganizationRequestCollection(),
                    };
                    foreach (var d in page.Entities)
                    {
                        var update = new Entity(EntityNames.Distributions, d.Id);
                        update[DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive);
                        req.Requests.Add(new UpdateRequest { Target = update });
                    }
                    service.Execute(req);
                    count += page.Entities.Count;
                    tracing.Trace(
                        $"Phase 1: page {pageNum} deactivated {page.Entities.Count} rows " +
                        $"(running total {count}; elapsed {(int)stopwatch.Elapsed.TotalSeconds}s).");
                }

                if (!page.MoreRecords)
                {
                    tracing.Trace($"Phase 1: complete — deactivated {count} unactioned Distribution(s).");
                    complete = true;
                    return count;
                }

                if (stopwatch.Elapsed > budget)
                {
                    tracing.Trace(
                        $"Phase 1: time budget reached after page {pageNum} " +
                        $"({count} deactivated so far) — will resume on next invocation.");
                    complete = false;
                    return count;
                }

                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
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
                var destFcId = ResolveStateFundCenter(service, fcCache, tracing, prioFcId, holdingFundCenterId);
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
                        OwningBusinessUnit = GetFundCenterMeta(service, fcCache, destFcId)?.OwningBusinessUnit,
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
                var destFc = ResolveStateFundCenter(service, fcCache, tracing, fcId, holdingFundCenterId);

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
                        OwningBusinessUnit = GetFundCenterMeta(service, fcCache, destFc)?.OwningBusinessUnit,
                    };
                }
            }

            tracing.Trace($"Phase 3: collapsed to {collapsed.Count} destination bucket(s).");
            return collapsed.Values.ToList();
        }

        // -----------------------------------------------------------------
        // Group collapsed buckets by (FundId, PgId) — one group becomes one
        // consolidated debit at the holding FC plus N credits to destinations.
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
        // FundCenter metadata. Both phases need a FC's parent + owning BU.
        // Caller supplies the cache so its scope is bounded by one invocation.
        // -----------------------------------------------------------------
        private sealed class FundCenterMeta
        {
            public Guid? ParentFundCenterId;
            public EntityReference OwningBusinessUnit;
        }

        private static FundCenterMeta GetFundCenterMeta(
            IOrganizationService service,
            Dictionary<Guid, FundCenterMeta> cache,
            Guid fundCenterId)
        {
            if (cache.TryGetValue(fundCenterId, out var cached))
                return cached;

            try
            {
                var fc = service.Retrieve(EntityNames.FundCenter, fundCenterId,
                    new ColumnSet(FundCenterAttributes.ParentFundCenter, "owningbusinessunit"));

                var meta = new FundCenterMeta
                {
                    ParentFundCenterId = fc.GetAttributeValue<EntityReference>(FundCenterAttributes.ParentFundCenter)?.Id,
                    OwningBusinessUnit = fc.GetAttributeValue<EntityReference>("owningbusinessunit"),
                };
                cache[fundCenterId] = meta;
                return meta;
            }
            catch
            {
                cache[fundCenterId] = null;
                return null;
            }
        }

        // -----------------------------------------------------------------
        // Walk the FundCenter parent chain until we reach the FC whose parent
        // is the holding FC (state level). Fallbacks match the legacy one-hop
        // rule: an FC that is itself the holding FC, has no parent, or lacks
        // metadata resolves to itself; an FC already at state (parent = holding)
        // resolves to itself in the first loop turn. MaxHops caps the walk at
        // a sane depth to defend against a cyclic parent-of graph.
        // -----------------------------------------------------------------
        private const int MaxFundCenterWalkHops = 16;

        private static Guid ResolveStateFundCenter(
            IOrganizationService service,
            Dictionary<Guid, FundCenterMeta> cache,
            ITracingService tracing,
            Guid fcId,
            Guid holdingFundCenterId)
        {
            if (fcId == Guid.Empty || fcId == holdingFundCenterId) return fcId;

            var current = fcId;
            for (var hop = 0; hop < MaxFundCenterWalkHops; hop++)
            {
                var meta = GetFundCenterMeta(service, cache, current);
                var parent = meta?.ParentFundCenterId;

                // No parent, or metadata missing → stop here.
                if (parent == null) return current;
                // Parent is the holding FC → current is state-level; done.
                if (parent.Value == holdingFundCenterId) return current;

                current = parent.Value;
            }

            tracing.Trace(
                $"  ResolveStateFundCenter: hop cap ({MaxFundCenterWalkHops}) reached starting at " +
                $"FC {fcId}; returning {current}. Check for a cyclic parent-of chain.");
            return current;
        }

        // -----------------------------------------------------------------
        // Continuation cursor — tiny key=value text, no escaping needed since
        // values are int / Guid only. Three states:
        //   phase=1                        → Phase 1 incomplete, resume the sweep
        //   phase=2;fe=<guid>;idx=<n>      → mid-Phase-2 of FE <guid>, (Fund,PG) group <n>
        //   phase=3;fe=<guid>;idx=<n>      → mid-Phase-3 of FE <guid>, (Fund,PG) group <n>
        // idx is a group index (see GroupByFundAndPg) — never within a group, so
        // a group's consolidated debit+credits are always emitted atomically.
        // -----------------------------------------------------------------
        private sealed class Cursor
        {
            public int Phase;
            public Guid FundingEventId;
            public int BucketIdx;

            public string Serialize() =>
                Phase == 1 ? "phase=1" : $"phase={Phase};fe={FundingEventId};idx={BucketIdx}";

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
                if (c.Phase == 1) return c;
                if (c.Phase >= 2 && c.FundingEventId != Guid.Empty) return c;
                return null;
            }
        }

        private static void WriteOutputs(IPluginExecutionContext context,
            int deactivated, int created, int turnIns, int skipped, Cursor cursor)
        {
            context.OutputParameters["Deactivated"]       = deactivated;
            context.OutputParameters["Created"]           = created;
            context.OutputParameters["TurnInsCreated"]    = turnIns;
            context.OutputParameters["Skipped"]           = skipped;
            context.OutputParameters["NextToken"] = cursor != null ? cursor.Serialize() : string.Empty;
        }
    }
}
