using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Shared rollup math for Requirement Funding totals.
    ///
    /// UNIONs two sources for the RF's FundedAmount / ValidatedAmount:
    ///   • child Prioritizations (the Prio path), and
    ///   • child book_requirementdetailfunding junctions (the no-Prio direct
    ///     funding path, where the parent Requirement has no Prioritization).
    /// A given Requirement is XOR-gated to exactly one path by
    /// RequirementDetailFundingGuard, so only one source is non-zero per RF.
    ///
    /// Both the PrioritizationRollupToRequirementFunding plugin (Prio
    /// Create/Update/Delete trigger), RealignmentProcessor, and the new
    /// RequirementDetailFundingRollup call this helper. The rollup plugins
    /// guard on context.Depth &gt; 1 to avoid re-entry, so depth-1 actors that
    /// depend on a fresh RF.FundedAmount / RF.ValidatedAmount after a nested
    /// update — most notably RealignmentProcessor — must invoke this helper
    /// directly. Mirrors the pattern used by TDPCalculationHelper.RecalculateLOATDP.
    /// </summary>
    public static class PrioritizationRollupHelper
    {
        /// <summary>
        /// Recalculates FundedAmount and ValidatedAmount on the given
        /// Requirement Funding by summing approved + active child
        /// Prioritizations and active book_requirementdetailfunding rows.
        /// Writes the totals to the RF synchronously.
        /// </summary>
        public static void RecalculateRFFunded(
            IOrganizationService service,
            Guid rfId,
            ITracingService tracing)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.Prioritization}'>
                        <attribute name='{PrioritizationAttributes.FundedAmountTDP}' alias='total_funded' aggregate='sum'/>
                        <attribute name='{PrioritizationAttributes.ValidatedAmount}' alias='total_validated' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{PrioritizationAttributes.ApprovalStatus}' operator='eq' value='4'/>
                            <condition attribute='{PrioritizationAttributes.StateCode}' operator='eq' value='0'/>
                        </filter>
                        <link-entity name='{EntityNames.RequirementFunding}' from='{RequirementFundingAttributes.Id}'
                                     to='{PrioritizationAttributes.RequirementFunding}' link-type='inner'>
                            <filter>
                                <condition attribute='{RequirementFundingAttributes.Id}' operator='eq' value='{rfId}'/>
                            </filter>
                        </link-entity>
                    </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));

            decimal prioFunded = 0m;
            decimal prioValidated = 0m;

            if (result.Entities.Count > 0)
            {
                var f = result.Entities[0].GetAttributeValue<AliasedValue>("total_funded");
                var v = result.Entities[0].GetAttributeValue<AliasedValue>("total_validated");

                prioFunded = f != null ? Convert.ToDecimal(f.Value) : 0m;
                prioValidated = v != null ? Convert.ToDecimal(v.Value) : 0m;
            }

            // UNION the no-Prio direct funding path.
            var (rdFunded, rdValidated) =
                RequirementDetailFundingRollupHelper.SumForRequirementFunding(service, rfId);

            decimal fundedTotal = prioFunded + rdFunded;
            decimal validatedTotal = prioValidated + rdValidated;

            tracing.Trace(
                $"RF {rfId} rollup: " +
                $"Funded={fundedTotal} (Prio={prioFunded} + RD={rdFunded}), " +
                $"Validated={validatedTotal} (Prio={prioValidated} + RD={rdValidated})");

            var update = new Entity(EntityNames.RequirementFunding, rfId);
            update[RequirementFundingAttributes.FundedAmount] = fundedTotal;
            update[RequirementFundingAttributes.ValidatedAmount] = validatedTotal;
            service.Update(update);
        }
    }
}
