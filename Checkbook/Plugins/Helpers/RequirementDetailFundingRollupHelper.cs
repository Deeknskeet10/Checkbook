using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Rolls book_requirementdetailfunding junction rows up to:
    ///   1. The parent Requirement Detail's ValidatedAmount / FundedAmount
    ///      (sum of all active junctions for that RD across every RF).
    ///   2. The parent Requirement Funding's FundedAmount / ValidatedAmount,
    ///      delegating to <see cref="PrioritizationRollupHelper.RecalculateRFFunded"/>
    ///      which now UNIONs Prio sums + RD direct funding sums.
    ///
    /// Mirrors the pattern of PrioritizationFundingRollupHelper: the rollup
    /// plugin guards on Depth &gt; 1 to avoid re-entry, so depth-1 actors that
    /// need fresh totals after a nested junction edit invoke this helper
    /// directly.
    /// </summary>
    public static class RequirementDetailFundingRollupHelper
    {
        public static void RecalculateRequirementDetail(
            IOrganizationService service,
            Guid requirementDetailId,
            ITracingService tracing)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.RequirementDetailFunding}'>
                        <attribute name='{RequirementDetailFundingAttributes.FundedAmount}' alias='total_funded' aggregate='sum'/>
                        <attribute name='{RequirementDetailFundingAttributes.ValidatedAmount}' alias='total_validated' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{RequirementDetailFundingAttributes.StateCode}' operator='eq' value='0'/>
                            <condition attribute='{RequirementDetailFundingAttributes.RequirementDetail}' operator='eq' value='{requirementDetailId}'/>
                        </filter>
                    </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));

            decimal fundedTotal = 0m;
            decimal validatedTotal = 0m;

            if (result.Entities.Count > 0)
            {
                fundedTotal = AliasedValueHelper.GetDecimal(result.Entities[0], "total_funded");
                validatedTotal = AliasedValueHelper.GetDecimal(result.Entities[0], "total_validated");
            }

            tracing.Trace(
                $"Requirement Detail {requirementDetailId} rollup: " +
                $"Funded={fundedTotal}, Validated={validatedTotal}");

            var update = new Entity(EntityNames.RequirementDetails, requirementDetailId);
            update[RequirementDetailsAttributes.FundedAmount] = fundedTotal;
            update[RequirementDetailsAttributes.ValidatedAmount] = validatedTotal;
            service.Update(update);
        }

        /// <summary>
        /// Sums active junction rows funded against a given Requirement Funding.
        /// Used by <see cref="PrioritizationRollupHelper.RecalculateRFFunded"/>
        /// to UNION RD direct funding into the RF's roll-up totals.
        /// </summary>
        public static (decimal funded, decimal validated) SumForRequirementFunding(
            IOrganizationService service,
            Guid rfId)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.RequirementDetailFunding}'>
                        <attribute name='{RequirementDetailFundingAttributes.FundedAmount}' alias='total_funded' aggregate='sum'/>
                        <attribute name='{RequirementDetailFundingAttributes.ValidatedAmount}' alias='total_validated' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{RequirementDetailFundingAttributes.StateCode}' operator='eq' value='0'/>
                            <condition attribute='{RequirementDetailFundingAttributes.RequirementFunding}' operator='eq' value='{rfId}'/>
                        </filter>
                    </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));

            decimal fundedTotal = 0m;
            decimal validatedTotal = 0m;

            if (result.Entities.Count > 0)
            {
                fundedTotal = AliasedValueHelper.GetDecimal(result.Entities[0], "total_funded");
                validatedTotal = AliasedValueHelper.GetDecimal(result.Entities[0], "total_validated");
            }

            return (fundedTotal, validatedTotal);
        }
    }
}
