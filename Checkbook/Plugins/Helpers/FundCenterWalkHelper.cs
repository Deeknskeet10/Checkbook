using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Cached FundCenter metadata (parent + owning BU) needed to walk the
    /// FundCenter hierarchy. Callers supply the cache dictionary so its scope
    /// is bounded by one plugin invocation.
    /// </summary>
    public sealed class FundCenterMeta
    {
        public Guid? ParentFundCenterId;
        public EntityReference OwningBusinessUnit;
    }

    /// <summary>
    /// FundCenter parent-chain resolution shared by GenerateDistributionsPlugin
    /// (bucket destination FCs) and SwapDistributionCreator (state-level FCs for
    /// swap distributions). The canonical rule: a Distribution destination is
    /// the state-level FC — the one whose parent is the holding FC (A18).
    /// </summary>
    public static class FundCenterWalkHelper
    {
        // Hard hop cap defends against a cyclic parent-of graph.
        public const int MaxFundCenterWalkHops = 16;

        public static FundCenterMeta GetFundCenterMeta(
            IOrganizationService service,
            Dictionary<Guid, FundCenterMeta> cache,
            Guid fundCenterId)
        {
            if (cache.TryGetValue(fundCenterId, out var cached))
                return cached;

            // No try/catch: a swallowed fault would silently resolve the FC to
            // itself and route Distributions to a sub-state FC — and a failed
            // call inside a sync plugin has already doomed the transaction anyway.
            var fc = service.Retrieve(EntityNames.FundCenter, fundCenterId,
                new ColumnSet(FundCenterAttributes.ParentFundCenter, CommonAttributes.OwningBusinessUnit));

            var meta = new FundCenterMeta
            {
                ParentFundCenterId = fc.GetAttributeValue<EntityReference>(FundCenterAttributes.ParentFundCenter)?.Id,
                OwningBusinessUnit = fc.GetAttributeValue<EntityReference>(CommonAttributes.OwningBusinessUnit),
            };
            cache[fundCenterId] = meta;
            return meta;
        }

        /// <summary>
        /// The Fund Center stamped on an anchor record (e.g. a Prioritization's
        /// book_fundcenter). Null when <paramref name="anchorRef"/> is null.
        /// </summary>
        public static EntityReference GetAnchorFundCenter(
            IOrganizationService service, string entityName, EntityReference anchorRef, string fundCenterAttribute)
        {
            if (anchorRef == null) return null;
            var anchor = service.Retrieve(entityName, anchorRef.Id, new ColumnSet(fundCenterAttribute));
            return anchor.GetAttributeValue<EntityReference>(fundCenterAttribute);
        }

        /// <summary>
        /// A Requirement Funding's Fund Center. book_requirementfunding has no
        /// book_fundcenter of its own (unlike Prioritization, which carries a
        /// backfilled copy), so hop RF → Requirement → FundCenter.
        /// </summary>
        public static EntityReference GetRequirementFundingFundCenter(
            IOrganizationService service, EntityReference rfRef)
        {
            if (rfRef == null) return null;

            var rf = service.Retrieve(EntityNames.RequirementFunding, rfRef.Id,
                new ColumnSet(RequirementFundingAttributes.Requirement));
            var reqRef = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.Requirement);
            if (reqRef == null) return null;

            var req = service.Retrieve(EntityNames.Requirements, reqRef.Id,
                new ColumnSet(RequirementsAttributes.FundCenter));
            return req.GetAttributeValue<EntityReference>(RequirementsAttributes.FundCenter);
        }

        /// <summary>
        /// Walk the FundCenter parent chain until we reach the FC whose parent
        /// is the holding FC (state level). Fallbacks match the legacy one-hop
        /// rule: an FC that is itself the holding FC or has no parent
        /// resolves to itself; an FC already at state (parent = holding)
        /// resolves to itself in the first loop turn.
        /// </summary>
        public static Guid ResolveStateFundCenter(
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

            tracing?.Trace(
                $"  ResolveStateFundCenter: hop cap ({MaxFundCenterWalkHops}) reached starting at " +
                $"FC {fcId}; returning {current}. Check for a cyclic parent-of chain.");
            return current;
        }
    }
}
