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
    /// Read side of book_GenerateDistributions: the Funding Events to process and
    /// the Phase 2 (Prioritization) / Phase 3 (Requirement) destination buckets.
    /// Used by the plugin and by Phase 4 cleanup (live bucket keys).
    /// </summary>
    internal static class DistributionBucketQueries
    {
        // -----------------------------------------------------------------
        // Resolve every Funding Event whose [start, end] spans today and whose
        // type matches the optional FundingType filter (null = both).
        // -----------------------------------------------------------------
        internal static List<Entity> ResolveActiveFundingEvents(
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
        internal static List<DistributionBucket> QueryPrioritizationBuckets(
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
        internal static List<DistributionBucket> QueryRequirementBuckets(
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
        internal static List<List<DistributionBucket>> GroupByFundAndPg(List<DistributionBucket> buckets)
        {
            return buckets
                .GroupBy(b => new { b.FundId, b.PgId })
                .OrderBy(g => g.Key.FundId).ThenBy(g => g.Key.PgId)
                .Select(g => g.OrderBy(b => b.FundCenterId).ToList())
                .ToList();
        }

    }
}
