using System;
using System.Collections.Generic;
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
    /// Three phases (mirroring the original flow):
    /// <list type="number">
    ///   <item>Deactivate every active <c>book_distributions</c> whose
    ///         <c>book_newenteredintogfebs = "No"</c>.</item>
    ///   <item>Aggregate active Prioritizations into (dest_fc, state, PG, fund, FY)
    ///         buckets and reconcile each bucket against existing credit Distributions
    ///         — create a debit/credit pair for shortfalls, or a Turn-In for overages.
    ///         The destination FC is the Prio's own FC when the Requirement is
    ///         centrally managed (book_national = 1; the FC is the Requirement's FC
    ///         via the <c>PrioritizationFundCenterBackfill</c> plugin) and the Prio's
    ///         parent FC otherwise.</item>
    ///   <item>Same reconciliation for BE-approved Requirements that have no
    ///         Prioritizations (types TARC + ARNGExternal, or national State-type),
    ///         grouped on (fundcenter, PG, fund, FY); the bucket FC is resolved as
    ///         parent-or-self relative to the holding FC.</item>
    /// </list>
    ///
    /// Input parameters:
    ///   <c>FundingType</c> (int, optional) — 0 = AFP only, 1 = Allotment only,
    ///                                        0 omitted = both.
    ///
    /// Output parameters:
    ///   <c>Deactivated</c>      (int) — Phase 1 distributions set inactive.
    ///   <c>Created</c>          (int) — Distribution rows created in Phases 2 + 3 (pairs counted as 2).
    ///   <c>TurnInsCreated</c>   (int) — Overage Turn-Ins created in Phases 2 + 3.
    ///   <c>Skipped</c>          (int) — Buckets skipped (missing FundingDetails percentage, etc).
    /// </summary>
    public class GenerateDistributionsPlugin : PluginBase
    {
        private const string MessageName = "book_GenerateDistributions";
        private const string HoldingFundCenterEnvVar = "book_DistributionHoldingFundCenter";

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
            if (context.InputParameters.TryGetValue("FundingType", out var raw) && raw is int ft)
                fundingTypeFilter = ft;

            tracing.Trace($"GenerateDistributions starting (FundingType filter = " +
                          $"{(fundingTypeFilter.HasValue ? fundingTypeFilter.Value.ToString() : "both")}).");

            var holdingFundCenterId = EnvironmentVariableHelper.GetGuid(service, HoldingFundCenterEnvVar);
            tracing.Trace($"Holding Fund Center (env var {HoldingFundCenterEnvVar}) = {holdingFundCenterId}.");

            // ---- Phase 1 -----------------------------------------------------
            var deactivated = DeactivateUnactionedDistributions(service, tracing);

            // ---- Resolve which Funding Events to process ---------------------
            var fundingEvents = ResolveActiveFundingEvents(service, tracing, fundingTypeFilter);
            if (fundingEvents.Count == 0)
            {
                tracing.Trace("No active Funding Events match the filter — Phases 2 + 3 skipped.");
                WriteOutputs(context, deactivated, 0, 0, 0);
                return;
            }

            var totalCreated  = 0;
            var totalTurnIns  = 0;
            var totalSkipped  = 0;

            // Per-invocation FundCenter metadata cache. Cannot be an instance field —
            // the platform reuses plugin instances across executions.
            var fcCache = new Dictionary<Guid, FundCenterMeta>();
            // Per-invocation FundingPercentage memo (same reasoning). Many buckets
            // share (Fund, PG, type) tuples; without this each bucket re-resolves.
            var pctCache = new Dictionary<string, FundingPercentageHelper.FundingResolution>();

            foreach (var fundingEvent in fundingEvents)
            {
                var fundingType = fundingEvent.GetAttributeValue<OptionSetValue>(FundingEventAttributes.FundingType)?.Value ?? -1;
                tracing.Trace($"Processing FundingEvent {fundingEvent.Id} (type = {fundingType}).");

                var fundingEventRef = fundingEvent.ToEntityReference();

                // ---- Phase 2 — Prioritizations -------------------------------
                foreach (var bucket in QueryPrioritizationBuckets(service, tracing))
                {
                    var fcMeta = GetFundCenterMeta(service, fcCache, bucket.FundCenterId);
                    var r = DistributionBucketProcessor.Process(
                        service, tracing, bucket, fundingEventRef, fundingType,
                        holdingFundCenterId, fcMeta?.OwningBusinessUnit, pctCache);
                    totalCreated += r.DistributionsCreated;
                    totalTurnIns += r.TurnInsCreated;
                    totalSkipped += r.Skipped;
                }

                // ---- Phase 3 — Requirements ----------------------------------
                foreach (var bucket in QueryRequirementBuckets(service, tracing, holdingFundCenterId, fcCache))
                {
                    var fcMeta = GetFundCenterMeta(service, fcCache, bucket.FundCenterId);
                    var r = DistributionBucketProcessor.Process(
                        service, tracing, bucket, fundingEventRef, fundingType,
                        holdingFundCenterId, fcMeta?.OwningBusinessUnit, pctCache);
                    totalCreated += r.DistributionsCreated;
                    totalTurnIns += r.TurnInsCreated;
                    totalSkipped += r.Skipped;
                }
            }

            WriteOutputs(context, deactivated, totalCreated, totalTurnIns, totalSkipped);
        }

        // -----------------------------------------------------------------
        // Phase 1: deactivate every active Distribution flagged not-entered-into-GFEBS.
        // -----------------------------------------------------------------
        private static int DeactivateUnactionedDistributions(IOrganizationService service, ITracingService tracing)
        {
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
                PageInfo = new PagingInfo { Count = 500, PageNumber = 1, ReturnTotalRecordCount = false },
                NoLock = true,
            };

            var count = 0;
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                foreach (var d in page.Entities)
                {
                    var update = new Entity(EntityNames.Distributions, d.Id);
                    update[DistributionsAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive);
                    service.Update(update);
                    count++;
                }

                if (!page.MoreRecords) break;
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }

            tracing.Trace($"Phase 1: deactivated {count} unactioned Distribution(s).");
            return count;
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

            var events = service.RetrieveMultiple(query).Entities.ToList();
            tracing.Trace($"Resolved {events.Count} active Funding Event(s).");
            return events;
        }

        // -----------------------------------------------------------------
        // Phase 2 aggregation: active Prioritizations with funded TDP > 0,
        // grouped by (prio_fc, parent_fc, req_national, state, PG, fund, FY).
        // Destination FC is the Prioritization's own FC when the Requirement is
        // centrally managed (book_national = 1) — the centrally identified FC
        // is backfilled onto the Prio by PrioritizationFundCenterBackfill. For
        // non-centrally-managed Prios, destination FC is the Prio's parent FC.
        // -----------------------------------------------------------------
        private static IEnumerable<DistributionBucket> QueryPrioritizationBuckets(
            IOrganizationService service, ITracingService tracing)
        {
            const string fetchXml = @"
<fetch aggregate='true' no-lock='true'>
  <entity name='book_prioritization'>
    <attribute name='book_newfundedamounttdp' alias='total_funding' aggregate='sum' />
    <filter type='and'>
      <condition attribute='statecode'                operator='eq' value='0' />
      <condition attribute='book_newfundedamounttdp' operator='gt' value='0' />
    </filter>
    <link-entity name='book_fundcenter' from='book_fundcenterid' to='book_fundcenter' link-type='inner' alias='fundcenter'>
      <attribute name='book_fundcenterid'     alias='prio_fc_id'           groupby='true' />
      <attribute name='book_parentfundcenter' alias='parent_fundcenter_id' groupby='true' />
    </link-entity>
    <link-entity name='book_state' from='book_stateid' to='book_state' link-type='inner' alias='state'>
      <attribute name='book_stateid' alias='state_id' groupby='true' />
    </link-entity>
    <link-entity name='book_requirementfunding' from='book_requirementfundingid' to='book_requirementfunding' link-type='inner' alias='req_funding'>
      <link-entity name='book_requirements' from='book_requirementsid' to='book_requirement' link-type='inner' alias='requirement'>
        <attribute name='book_national' alias='req_national' groupby='true' />
      </link-entity>
      <link-entity name='book_fundingline' from='book_fundinglineid' to='book_lineofaccounting' link-type='inner' alias='loa'>
        <link-entity name='book_pg' from='book_pgid' to='book_pg' link-type='inner' alias='pg'>
          <attribute name='book_pgid' alias='pg_id' groupby='true' />
        </link-entity>
        <link-entity name='book_fund' from='book_fundid' to='book_fund' link-type='inner' alias='fund'>
          <attribute name='book_fundid'     alias='fund_id' groupby='true' />
          <attribute name='book_fiscalyear' alias='fy'      groupby='true' />
        </link-entity>
      </link-entity>
    </link-entity>
  </entity>
</fetch>";

            var rows = service.RetrieveMultiple(new FetchExpression(fetchXml)).Entities;
            tracing.Trace($"Phase 2: {rows.Count} Prioritization bucket(s).");
            foreach (var row in rows)
            {
                var prioFcId   = GetAliasedGuid(row, "prio_fc_id");
                var parentFcId = GetAliasedGuid(row, "parent_fundcenter_id");
                var fundId     = GetAliasedGuid(row, "fund_id");
                var pgId       = GetAliasedGuid(row, "pg_id");
                var isNational = GetAliasedBool(row, "req_national");

                // Centrally managed → use the Prio's own FC (= Req.FC via backfill).
                // Otherwise → use the parent FC. Skip rows that can't resolve a
                // destination (e.g. non-centrally-managed Prio whose FC has no parent,
                // mirroring the legacy "Get_FC returned null → no-op" behavior).
                var destFcId = isNational ? prioFcId : parentFcId;
                if (destFcId == Guid.Empty || fundId == Guid.Empty || pgId == Guid.Empty)
                    continue;

                yield return new DistributionBucket
                {
                    FundId        = fundId,
                    PgId          = pgId,
                    FundCenterId  = destFcId,
                    FiscalYear    = GetAliasedOption(row, "fy"),
                    TotalFunding  = GetAliasedDecimal(row, "total_funding"),
                };
            }
        }

        // -----------------------------------------------------------------
        // Phase 3 aggregation: BE-approved Requirements that have no
        // Prioritizations, grouped by (fundcenter_id, PG, fund, FY). Bucket FC
        // is resolved per-row from the original FC + its parent, applying the
        // "parent ∈ {holding, null} → self" rule that lived in the flow's
        // "Determine_correct_FC" compose. Today the qualifying types are TARC
        // (1) and ARNG External (4) — both centrally managed without Prios.
        // Centrally managed Reqs that DO have Prios (State+national=1, PEC FY26
        // centrally, DOMOPs) flow through Phase 2 instead; the outer-join
        // null-check on book_prioritization guards against stray Prios under a
        // type meant to be Prio-less so we never double-count.
        // -----------------------------------------------------------------
        private static IEnumerable<DistributionBucket> QueryRequirementBuckets(
            IOrganizationService service, ITracingService tracing,
            Guid holdingFundCenterId, Dictionary<Guid, FundCenterMeta> fcCache)
        {
            const string fetchXml = @"
<fetch aggregate='true' no-lock='true'>
  <entity name='book_requirementfunding'>
    <attribute name='book_newfundedamount' alias='total_funding' aggregate='sum' />
    <filter type='and'>
      <condition attribute='book_newfundedamount' operator='gt' value='0' />
      <condition entityname='prio_chk' attribute='book_prioritizationid' operator='null' />
    </filter>
    <link-entity name='book_requirements' from='book_requirementsid' to='book_requirement' link-type='inner' alias='reqs'>
      <filter type='and'>
        <condition attribute='book_approvalstatus' operator='eq' value='7' />
        <condition attribute='statecode'           operator='eq' value='0' />
        <filter type='or'>
          <condition attribute='book_type' operator='eq' value='1' />
          <condition attribute='book_type' operator='eq' value='4' />
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
            tracing.Trace($"Phase 3: {rows.Count} Requirement-Funding bucket(s).");
            foreach (var row in rows)
            {
                var fcId   = GetAliasedGuid(row, "fundcenter_id");
                var fundId = GetAliasedGuid(row, "fund_id");
                var pgId   = GetAliasedGuid(row, "pg_id");
                if (fcId == Guid.Empty || fundId == Guid.Empty || pgId == Guid.Empty)
                    continue;

                // Resolve parent-or-self: use parent FC unless the parent is null or
                // is the holding FC, in which case use self.
                var fcMeta = GetFundCenterMeta(service, fcCache, fcId);
                var destFc = (fcMeta?.ParentFundCenterId == null || fcMeta.ParentFundCenterId == holdingFundCenterId)
                    ? fcId
                    : fcMeta.ParentFundCenterId.Value;

                yield return new DistributionBucket
                {
                    FundId        = fundId,
                    PgId          = pgId,
                    FundCenterId  = destFc,
                    FiscalYear    = GetAliasedOption(row, "fy"),
                    TotalFunding  = GetAliasedDecimal(row, "total_funding"),
                };
            }
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
        // AliasedValue extraction helpers — FetchXML aggregates always wrap
        // grouped/aggregated attributes in AliasedValue.
        // -----------------------------------------------------------------
        private static Guid GetAliasedGuid(Entity e, string alias)
        {
            if (!e.Contains(alias)) return Guid.Empty;
            var raw = (e[alias] as AliasedValue)?.Value;
            if (raw is Guid g) return g;
            if (raw is EntityReference er) return er.Id;
            return Guid.Empty;
        }

        private static int GetAliasedOption(Entity e, string alias)
        {
            if (!e.Contains(alias)) return 0;
            var raw = (e[alias] as AliasedValue)?.Value;
            if (raw is OptionSetValue osv) return osv.Value;
            if (raw is int i) return i;
            return 0;
        }

        private static decimal GetAliasedDecimal(Entity e, string alias)
        {
            if (!e.Contains(alias)) return 0m;
            var raw = (e[alias] as AliasedValue)?.Value;
            return NumericHelper.ToDecimal(raw, 0m);
        }

        private static bool GetAliasedBool(Entity e, string alias)
        {
            if (!e.Contains(alias)) return false;
            var raw = (e[alias] as AliasedValue)?.Value;
            if (raw is bool b) return b;
            return false;
        }

        private static void WriteOutputs(IPluginExecutionContext context,
            int deactivated, int created, int turnIns, int skipped)
        {
            context.OutputParameters["Deactivated"]    = deactivated;
            context.OutputParameters["Created"]        = created;
            context.OutputParameters["TurnInsCreated"] = turnIns;
            context.OutputParameters["Skipped"]        = skipped;
        }
    }
}
