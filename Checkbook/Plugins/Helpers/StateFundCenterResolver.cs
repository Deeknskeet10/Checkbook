using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Resolves the state-level Fund Center a Prioritization is locked to while
    /// it has Itemized Details, and answers whether that lock is engaged.
    /// State-level means the FC whose parent is the distribution holding FC
    /// (A18) — the same definition GenerateDistributionsPlugin resolves bucket
    /// destinations to, which is what keeps the lock distribution-neutral.
    /// </summary>
    public static class StateFundCenterResolver
    {
        /// <summary>
        /// Preferred route: the active FC of the Prioritization state whose
        /// parent is the holding FC. Falls back to walking the current FC up
        /// the parent chain when the Prio has no state (matches distribution
        /// semantics). Returns null when neither route resolves.
        /// </summary>
        public static Guid? ResolveForPrio(
            IOrganizationService service,
            Dictionary<Guid, FundCenterMeta> fcCache,
            ITracingService tracing,
            EntityReference prioState,
            EntityReference prioFundCenter,
            Guid holdingFundCenterId)
        {
            if (prioState != null)
            {
                var query = new QueryExpression(EntityNames.FundCenter)
                {
                    TopCount = 1,
                    ColumnSet = new ColumnSet(false),
                    NoLock = true,
                    Criteria = new FilterExpression(LogicalOperator.And)
                    {
                        Conditions =
                        {
                            new ConditionExpression(
                                FundCenterAttributes.State,
                                ConditionOperator.Equal, prioState.Id),
                            new ConditionExpression(
                                FundCenterAttributes.ParentFundCenter,
                                ConditionOperator.Equal, holdingFundCenterId),
                            new ConditionExpression(
                                FundCenterAttributes.StateCode,
                                ConditionOperator.Equal, StateCodeValues.Active),
                        },
                    },
                    Orders = { new OrderExpression(FundCenterAttributes.Name, OrderType.Ascending) },
                };

                var result = service.RetrieveMultiple(query);
                if (result.Entities.Count > 0)
                    return result.Entities[0].Id;

                tracing.Trace(
                    $"No active FC with parent = holding FC found for state {prioState.Id}; " +
                    "falling back to the parent-chain walk.");
            }

            if (prioFundCenter != null)
            {
                var walked = FundCenterWalkHelper.ResolveStateFundCenter(
                    service, fcCache, tracing, prioFundCenter.Id, holdingFundCenterId);
                if (walked != Guid.Empty && walked != holdingFundCenterId)
                    return walked;
            }

            return null;
        }

        /// <summary>
        /// True when the Prioritization's parent Requirement is centrally
        /// managed (book_national = 1). Centrally managed Prios are exempt
        /// from the Itemized Details FC lock — their FC is owned by the
        /// Requirement (PrioritizationFundCenterBackfill /
        /// RequirementFundCenterCascade), not forced to state level.
        /// The prio entity must have been retrieved with the
        /// book_requirement and book_requirementfunding columns; the
        /// Requirement is resolved from the direct lookup first (FY27+
        /// shape), then via RF → Requirement (legacy shape).
        /// </summary>
        public static bool HasCentrallyManagedRequirement(
            IOrganizationService service,
            ITracingService tracing,
            Entity prio)
        {
            var reqRef = prio.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.Requirement);

            if (reqRef == null)
            {
                var rfRef = prio.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.RequirementFunding);
                if (rfRef != null)
                {
                    var rf = service.Retrieve(
                        EntityNames.RequirementFunding,
                        rfRef.Id,
                        new ColumnSet(RequirementFundingAttributes.Requirement));
                    reqRef = rf.GetAttributeValue<EntityReference>(
                        RequirementFundingAttributes.Requirement);
                }
            }

            if (reqRef == null)
            {
                tracing.Trace($"Prio {prio.Id} has no resolvable Requirement; treating as not centrally managed.");
                return false;
            }

            var req = service.Retrieve(
                EntityNames.Requirements,
                reqRef.Id,
                new ColumnSet(RequirementsAttributes.National));
            return req.GetAttributeValue<bool>(RequirementsAttributes.National);
        }

        /// <summary>True when the Prioritization has at least one active Itemized Detail.</summary>
        public static bool HasActiveItemizedDetails(IOrganizationService service, Guid prioritizationId)
        {
            var query = new QueryExpression(EntityNames.ItemizedDetails)
            {
                TopCount = 1,
                ColumnSet = new ColumnSet(false),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            ItemizedDetailsAttributes.Prioritization,
                            ConditionOperator.Equal, prioritizationId),
                        new ConditionExpression(
                            ItemizedDetailsAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            return service.RetrieveMultiple(query).Entities.Count > 0;
        }
    }
}
