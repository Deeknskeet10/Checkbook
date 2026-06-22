using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Shared queries against Requirement Funding that multiple plugins need.
    /// </summary>
    public static class RequirementFundingHelpers
    {
        /// <summary>
        /// Returns true if the Requirement Funding has at least one active
        /// child Prioritization. Used by RealignmentProcessor,
        /// SetSameFundSagFlagPlugin and RequirementFundingTDPValidator to
        /// decide whether an RF is a "leaf" (touch funded directly) or a
        /// "parent" (children drive funded via roll-up).
        /// </summary>
        public static bool HasActiveChildren(IOrganizationService service, Guid rfId)
        {
            var query = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationAttributes.RequirementFunding,
                            ConditionOperator.Equal, rfId),
                        new ConditionExpression(
                            PrioritizationAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            return service.RetrieveMultiple(query).Entities.Count > 0;
        }
    }
}
