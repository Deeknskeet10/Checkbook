using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Single home for the funded / validated roll-ups. Every total is one
    /// server-side aggregate over active child rows (<see cref="SumActive"/>):
    ///
    ///   • Requirement Funding  ← UNION of three mutually exclusive sources
    ///       – legacy Prioritizations via Prio.book_requirementfunding (FY26),
    ///       – book_prioritizationfunding junctions (FY27+, one Prio split across RFs),
    ///       – book_requirementdetailfunding junctions (no-Prio direct funding).
    ///     Prio-sourced rows count only when the Prio is FinalApproved + Active.
    ///   • Prioritization       ← its active book_prioritizationfunding junctions
    ///     (skipped in Itemized mode — PrioritizationItemizedRollup owns that total).
    ///   • Requirement Detail   ← its active book_requirementdetailfunding junctions.
    ///
    /// The roll-up plugins early-return at Depth &gt; 1, so orchestrators
    /// (RealignmentProcessor, Turn-In / Swap executors) that need a fresh total
    /// after their own nested writes call these methods directly.
    /// </summary>
    public static class FundingRollupHelper
    {
        // ------------------------------------------------------------------
        // Requirement Funding
        // ------------------------------------------------------------------

        /// <summary>Recomputes and writes RF FundedAmount / ValidatedAmount.</summary>
        public static void RecalculateRFFunded(IOrganizationService service, Guid rfId, ITracingService tracing)
        {
            service.Update(BuildRFFundedUpdate(service, rfId, tracing));
        }

        /// <summary>
        /// Computes the RF totals and returns the unsaved Update entity so a caller
        /// can merge more attributes (e.g. a TDP change) into the SAME Update. The
        /// "Req Funding - Funded vs TDP" real-time business rule is entity-scoped
        /// and cannot be bypassed by ancestor-context checks, so Funded and TDP must
        /// move together whenever an intermediate write would leave Funded &gt; TDP.
        /// </summary>
        public static Entity BuildRFFundedUpdate(IOrganizationService service, Guid rfId, ITracingService tracing)
        {
            var (prioFunded, prioValidated) = SumActive(service,
                EntityNames.Prioritization,
                PrioritizationAttributes.FundedAmountTDP, PrioritizationAttributes.ValidatedAmount,
                PrioritizationAttributes.RequirementFunding, rfId,
                extraConditions:
                    $"<condition attribute='{PrioritizationAttributes.ApprovalStatus}' operator='eq' value='{ApprovalStatusValues.FinalApproved}'/>");

            var (pfFunded, pfValidated) = SumPrioritizationFundingForRF(service, rfId);
            var (rdFunded, rdValidated) = SumRequirementDetailFundingForRF(service, rfId);

            decimal fundedTotal = prioFunded + rdFunded + pfFunded;
            decimal validatedTotal = prioValidated + rdValidated + pfValidated;

            tracing.Trace(
                $"RF {rfId} rollup: " +
                $"Funded={fundedTotal} (Prio={prioFunded} + RD={rdFunded} + PF={pfFunded}), " +
                $"Validated={validatedTotal} (Prio={prioValidated} + RD={rdValidated} + PF={pfValidated})");

            var update = new Entity(EntityNames.RequirementFunding, rfId);
            update[RequirementFundingAttributes.FundedAmount] = fundedTotal;
            update[RequirementFundingAttributes.ValidatedAmount] = validatedTotal;
            return update;
        }

        /// <summary>
        /// Σ active book_prioritizationfunding on an RF whose parent Prio is
        /// FinalApproved + Active (the FY27+ RF source).
        /// </summary>
        public static (decimal funded, decimal validated) SumPrioritizationFundingForRF(
            IOrganizationService service, Guid rfId)
        {
            return SumActive(service,
                EntityNames.PrioritizationFunding,
                PrioritizationFundingAttributes.FundedAmount, PrioritizationFundingAttributes.ValidatedAmount,
                PrioritizationFundingAttributes.RequirementFunding, rfId,
                linkEntity: $@"
                    <link-entity name='{EntityNames.Prioritization}' from='{PrioritizationAttributes.Id}' to='{PrioritizationFundingAttributes.Prioritization}' link-type='inner'>
                        <filter type='and'>
                            <condition attribute='{PrioritizationAttributes.ApprovalStatus}' operator='eq' value='{ApprovalStatusValues.FinalApproved}'/>
                            <condition attribute='{PrioritizationAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                        </filter>
                    </link-entity>");
        }

        /// <summary>Σ active book_requirementdetailfunding on an RF (the no-Prio RF source).</summary>
        public static (decimal funded, decimal validated) SumRequirementDetailFundingForRF(
            IOrganizationService service, Guid rfId)
        {
            return SumActive(service,
                EntityNames.RequirementDetailFunding,
                RequirementDetailFundingAttributes.FundedAmount, RequirementDetailFundingAttributes.ValidatedAmount,
                RequirementDetailFundingAttributes.RequirementFunding, rfId);
        }

        // ------------------------------------------------------------------
        // Prioritization
        // ------------------------------------------------------------------

        /// <summary>
        /// Writes Prio FundedAmountTDP / ValidatedAmount = Σ its active junctions.
        /// No-op in Itemized mode (PrioritizationItemizedRollup owns the total and
        /// the junctions only distribute it).
        /// </summary>
        public static void RecalculatePrioritizationFunded(
            IOrganizationService service, Guid prioritizationId, ITracingService tracing)
        {
            var prio = service.Retrieve(
                EntityNames.Prioritization, prioritizationId,
                new ColumnSet(PrioritizationAttributes.FundingMode));

            var mode = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode);
            if (mode != null && mode.Value == FundingModeValues.Itemized)
            {
                tracing.Trace(
                    $"Prioritization {prioritizationId} is in Itemized mode — " +
                    "junction → Prioritization rollup skipped (PrioritizationItemizedRollup owns the total).");
                return;
            }

            var (funded, validated) = SumActive(service,
                EntityNames.PrioritizationFunding,
                PrioritizationFundingAttributes.FundedAmount, PrioritizationFundingAttributes.ValidatedAmount,
                PrioritizationFundingAttributes.Prioritization, prioritizationId);

            tracing.Trace($"Prioritization {prioritizationId} rollup: Funded={funded}, Validated={validated}");

            var update = new Entity(EntityNames.Prioritization, prioritizationId);
            update[PrioritizationAttributes.FundedAmountTDP] = funded;
            update[PrioritizationAttributes.ValidatedAmount] = validated;
            service.Update(update);
        }

        // ------------------------------------------------------------------
        // Requirement Detail
        // ------------------------------------------------------------------

        /// <summary>Writes RD FundedAmount / ValidatedAmount = Σ its active junctions (across all RFs).</summary>
        public static void RecalculateRequirementDetail(
            IOrganizationService service, Guid requirementDetailId, ITracingService tracing)
        {
            var (funded, validated) = SumActive(service,
                EntityNames.RequirementDetailFunding,
                RequirementDetailFundingAttributes.FundedAmount, RequirementDetailFundingAttributes.ValidatedAmount,
                RequirementDetailFundingAttributes.RequirementDetail, requirementDetailId);

            tracing.Trace($"Requirement Detail {requirementDetailId} rollup: Funded={funded}, Validated={validated}");

            var update = new Entity(EntityNames.RequirementDetails, requirementDetailId);
            update[RequirementDetailsAttributes.FundedAmount] = funded;
            update[RequirementDetailsAttributes.ValidatedAmount] = validated;
            service.Update(update);
        }

        // ------------------------------------------------------------------
        // Core aggregate
        // ------------------------------------------------------------------

        /// <summary>
        /// One aggregate fetch: Σ funded / Σ validated over ACTIVE rows of
        /// <paramref name="entity"/> where <paramref name="parentAttribute"/> = <paramref name="parentId"/>.
        /// <paramref name="extraConditions"/> are raw &lt;condition&gt; elements ANDed in;
        /// <paramref name="linkEntity"/> is a raw &lt;link-entity&gt; element.
        /// </summary>
        private static (decimal funded, decimal validated) SumActive(
            IOrganizationService service,
            string entity,
            string fundedAttribute,
            string validatedAttribute,
            string parentAttribute,
            Guid parentId,
            string extraConditions = "",
            string linkEntity = "")
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{entity}'>
                        <attribute name='{fundedAttribute}' alias='total_funded' aggregate='sum'/>
                        <attribute name='{validatedAttribute}' alias='total_validated' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{CommonAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                            <condition attribute='{parentAttribute}' operator='eq' value='{parentId}'/>
                            {extraConditions}
                        </filter>
                        {linkEntity}
                    </entity>
                </fetch>";

            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            if (rows.Count == 0) return (0m, 0m);
            return (AliasedValueHelper.GetDecimal(rows[0], "total_funded"),
                    AliasedValueHelper.GetDecimal(rows[0], "total_validated"));
        }
    }
}
