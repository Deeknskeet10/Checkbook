using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Takes an amount out of a Requirement Funding at the RF level (no Prioritization):
    /// Withholding (TDP − Funded) first, then Funded and TDP together. Shared by the
    /// RF→RF realignment leg and FY27 RF-level Turn-Ins so both honor the same order.
    ///
    /// On a direct-funded RF (Funded = Σ Requirement Detail Funding) the Funded part must
    /// also come out of its RDF junctions — callers apply those reductions afterwards and
    /// re-sum the RF; their validators require Σ RDF reductions == max(0, amount − Withholding).
    /// </summary>
    public static class RequirementFundingDebitHelper
    {
        /// <param name="allowChildFunded">
        /// True only for the legacy Prio→Prio realignment, which moves the child
        /// Prioritization's funding itself. Otherwise an RF with child Prioritizations
        /// may give up Withholding only (see rf-with-children-withholding-only).
        /// </param>
        /// <param name="operationLabel">"Realignment" / "Turn-In", for messages.</param>
        public static void ApplyDebit(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitRFRef,
            decimal amount,
            bool allowChildFunded,
            string operationLabel)
        {
            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                debitRFRef.Id,
                new ColumnSet(RequirementFundingAttributes.FundedAmount,
                              RequirementFundingAttributes.TDP,
                              RequirementFundingAttributes.Withholding));

            decimal funded = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.FundedAmount) ?? 0m;
            decimal tdp = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;
            decimal withhold = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.Withholding) ?? 0m;

            bool hasChildren = RequirementFundingHelpers.HasActiveChildren(service, debitRFRef.Id);

            decimal remaining = amount;

            if (withhold > 0)
            {
                decimal used = Math.Min(withhold, remaining);
                withhold -= used;
                tdp -= used;
                remaining -= used;
                tracing.Trace($"RF Debit: Reduced withholding by {used}. Remaining debit: {remaining}");
            }

            if (remaining > 0)
            {
                if (hasChildren && !allowChildFunded)
                {
                    throw new InvalidPluginExecutionException(
                        $"Debited RF has no remaining withholding and has child Prioritizations. {operationLabel} would affect child-funded amounts.");
                }

                // Never clamp a short RF debit to zero — the other side of the move
                // would still receive the full amount, fabricating funds. Abort instead.
                if (remaining > funded || remaining > tdp)
                    throw new InvalidPluginExecutionException(
                        $"{operationLabel} cannot be executed: the debited Requirement Funding holds only " +
                        $"{Math.Min(funded, tdp):N2} available (Funded {funded:N2}, TDP {tdp:N2}) but this " +
                        $"{operationLabel.ToLowerInvariant()} moves {remaining:N2}. The source funding was likely reduced " +
                        $"after this {operationLabel.ToLowerInvariant()} was submitted. Re-source it or lower the amount.");

                tdp -= remaining;
                funded -= remaining;

                remaining = 0;
                tracing.Trace("RF Debit: Reduced leaf-RF TDP and Funded.");
            }

            var upd = new Entity(EntityNames.RequirementFunding, debitRFRef.Id);
            upd[RequirementFundingAttributes.TDP] = tdp;
            upd[RequirementFundingAttributes.FundedAmount] = funded;
            service.Update(upd);
        }
    }
}
