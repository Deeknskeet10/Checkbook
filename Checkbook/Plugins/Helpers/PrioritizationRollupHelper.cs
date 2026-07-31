using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Shared rollup math for Requirement Funding totals.
    ///
    /// UNIONs three sources for the RF's FundedAmount / ValidatedAmount:
    ///   • child Prioritizations via the legacy FY26 Prio.book_requirementfunding
    ///     direct lookup (the Prio path),
    ///   • child book_prioritizationfunding junctions (the FY27+ path, where one
    ///     Prioritization per Requirement/FY splits its funded total across RFs
    ///     and leaves the direct lookup empty), and
    ///   • child book_requirementdetailfunding junctions (the no-Prio direct
    ///     funding path, where the parent Requirement has no Prioritization).
    /// The three are mutually exclusive per RF (FY26 vs FY27, Prio vs no-Prio),
    /// so at most one source is non-zero for any given RF.
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
        /// Prioritizations (direct-lookup path), active book_prioritizationfunding
        /// junctions under approved + active Prios (FY27 split path), and active
        /// book_requirementdetailfunding rows. Writes the totals to the RF
        /// synchronously.
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
                            <condition attribute='{PrioritizationAttributes.ApprovalStatus}' operator='eq' value='{ApprovalStatusValues.FinalApproved}'/>
                            <condition attribute='{PrioritizationAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
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
                prioFunded = AliasedValueHelper.GetDecimal(result.Entities[0], "total_funded");
                prioValidated = AliasedValueHelper.GetDecimal(result.Entities[0], "total_validated");
            }

            // UNION the no-Prio direct funding path.
            var (rdFunded, rdValidated) =
                RequirementDetailFundingRollupHelper.SumForRequirementFunding(service, rfId);

            // UNION the FY27 junction split (book_prioritizationfunding): a single
            // Prioritization spreads its funded total across RFs via the junction,
            // leaving Prio.book_requirementfunding empty, so the direct-lookup path
            // above contributes nothing for FY27 RFs and this term supplies it.
            var (pfFunded, pfValidated) =
                PrioritizationFundingRollupHelper.SumForRequirementFunding(service, rfId);

            decimal fundedTotal = prioFunded + rdFunded + pfFunded;
            decimal validatedTotal = prioValidated + rdValidated + pfValidated;

            tracing.Trace(
                $"RF {rfId} rollup: " +
                $"Funded={fundedTotal} (Prio={prioFunded} + RD={rdFunded} + PF={pfFunded}), " +
                $"Validated={validatedTotal} (Prio={prioValidated} + RD={rdValidated} + PF={pfValidated})");

            var update = new Entity(EntityNames.RequirementFunding, rfId);
            update[RequirementFundingAttributes.FundedAmount] = fundedTotal;
            update[RequirementFundingAttributes.ValidatedAmount] = validatedTotal;
            service.Update(update);
        }
    }
}
