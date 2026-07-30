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

        /// <summary>
        /// Walk the FundCenter parent chain until we reach the FC whose parent
        /// is the holding FC (state level). Fallbacks match the legacy one-hop
        /// rule: an FC that is itself the holding FC, has no parent, or lacks
        /// metadata resolves to itself; an FC already at state (parent = holding)
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

            tracing.Trace(
                $"  ResolveStateFundCenter: hop cap ({MaxFundCenterWalkHops}) reached starting at " +
                $"FC {fcId}; returning {current}. Check for a cyclic parent-of chain.");
            return current;
        }
    }
}
