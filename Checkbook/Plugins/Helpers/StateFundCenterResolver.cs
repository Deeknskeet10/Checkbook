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
