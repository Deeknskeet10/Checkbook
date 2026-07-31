using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Sums active book_prioritizationfunding junction rows for a parent
    /// Prioritization and writes the totals back to the Prioritization's
    /// FundedAmountTDP / ValidatedAmount.
    ///
    /// Mode-aware: skips the write when the parent Prioritization is in
    /// Itemized funding mode — in that case PrioritizationItemizedRollup
    /// owns the Prioritization's funded total, and the junctions are
    /// distributive metadata only.
    ///
    /// Mirrors the pattern of PrioritizationRollupHelper.RecalculateRFFunded:
    /// the rollup plugin guards on Depth &gt; 1 to avoid re-entry, so depth-1
    /// actors that need a fresh Prioritization total after a nested junction
    /// edit must invoke this helper directly.
    /// </summary>
    public static class PrioritizationFundingRollupHelper
    {
        // book_fundingmode option values
        private const int FundingMode_Itemized = 1;

        public static void RecalculatePrioritizationFunded(
            IOrganizationService service,
            Guid prioritizationId,
            ITracingService tracing)
        {
            var prio = service.Retrieve(
                EntityNames.Prioritization,
                prioritizationId,
                new ColumnSet(PrioritizationAttributes.FundingMode)
            );

            var mode = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode);
            if (mode != null && mode.Value == FundingMode_Itemized)
            {
                tracing.Trace(
                    $"Prioritization {prioritizationId} is in Itemized mode — " +
                    "junction → Prioritization rollup skipped (PrioritizationItemizedRollup owns the total).");
                return;
            }

            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.PrioritizationFunding}'>
                        <attribute name='{PrioritizationFundingAttributes.FundedAmount}' alias='total_funded' aggregate='sum'/>
                        <attribute name='{PrioritizationFundingAttributes.ValidatedAmount}' alias='total_validated' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{PrioritizationFundingAttributes.StateCode}' operator='eq' value='0'/>
                            <condition attribute='{PrioritizationFundingAttributes.Prioritization}' operator='eq' value='{prioritizationId}'/>
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
                $"Prioritization {prioritizationId} rollup: " +
                $"Funded={fundedTotal}, Validated={validatedTotal}");

            var update = new Entity(EntityNames.Prioritization, prioritizationId);
            update[PrioritizationAttributes.FundedAmountTDP] = fundedTotal;
            update[PrioritizationAttributes.ValidatedAmount] = validatedTotal;
            service.Update(update);
        }

        /// <summary>
        /// Sums active book_prioritizationfunding junction rows allocated to a
        /// given Requirement Funding, restricted to junctions whose parent
        /// Prioritization is FinalApproved + Active (mirrors the approval gating
        /// of the direct-lookup Prio path in
        /// <see cref="PrioritizationRollupHelper.RecalculateRFFunded"/>).
        ///
        /// This is the FY27+ path: a single Prioritization (per Requirement/FY)
        /// splits its funded total across RFs via the junction, so the RF total
        /// is driven by these rows — not by the legacy Prio.book_requirementfunding
        /// direct lookup, which FY27 Prios leave empty. Safe to UNION with the
        /// direct-lookup path: FY26 Prios have no junctions and FY27 Prios have
        /// no direct-lookup RF, so exactly one source is non-zero per RF.
        /// </summary>
        public static (decimal funded, decimal validated) SumForRequirementFunding(
            IOrganizationService service,
            Guid rfId)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.PrioritizationFunding}'>
                        <attribute name='{PrioritizationFundingAttributes.FundedAmount}' alias='total_funded' aggregate='sum'/>
                        <attribute name='{PrioritizationFundingAttributes.ValidatedAmount}' alias='total_validated' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{PrioritizationFundingAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                            <condition attribute='{PrioritizationFundingAttributes.RequirementFunding}' operator='eq' value='{rfId}'/>
                        </filter>
                        <link-entity name='{EntityNames.Prioritization}' from='{PrioritizationAttributes.Id}' to='{PrioritizationFundingAttributes.Prioritization}' link-type='inner'>
                            <filter type='and'>
                                <condition attribute='{PrioritizationAttributes.ApprovalStatus}' operator='eq' value='{ApprovalStatusValues.FinalApproved}'/>
                                <condition attribute='{PrioritizationAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                            </filter>
                        </link-entity>
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
