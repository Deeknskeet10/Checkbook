using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard enforcing that a funding source exists before an NPM can
    /// fund a Prioritization's details (FY27 — see docs/Prioritization-Funding-Reconciliation.md,
    /// decision #7). Populating Validated/Funded — on a book_itemizeddetails row (Itemized
    /// mode) or directly on the book_prioritization (Direct mode) — requires at least one
    /// active book_requirementfunding for the Prioritization's (Requirement, Fiscal Year).
    ///
    /// This guarantees a destination RF is present (and, when it is the only one,
    /// PrioritizationSingleRfAutoAllocate materializes the junction automatically so the
    /// allocation is always balanced). It does NOT force the NPM to list every source RF —
    /// only that one exists; the UI gives a soft notice to identify all sources up front.
    ///
    /// Only the originating user write is checked (Depth == 1) so nested plugin writes
    /// (rollups, auto-allocate, realignment/turn-in orchestrators) are never blocked.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update | Entity: book_itemizeddetails | Pre-Operation | Sync
    ///         Filtering attributes: book_fundedamount, book_validatedamount
    ///   • Message: Update | Entity: book_prioritization  | Pre-Operation | Sync
    ///         Filtering attributes: book_newfundedamounttdp, book_validatedamount
    /// (Create steps optional — details/Prios are created unfunded then funded via Update.)
    /// </summary>
    public class FundingRequiresRequirementFundingGuard : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            // Only gate the originating user/API write; nested plugin writes (rollups,
            // auto-allocate, realignment credits) legitimately set funding at depth > 1.
            if (context.Depth > 1)
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            EntityReference requirementRef;
            int? fiscalYear;

            if (context.PrimaryEntityName == EntityNames.ItemizedDetails)
            {
                // Only when this write actually sets a positive funded/validated.
                if (!target.Contains(ItemizedDetailsAttributes.FundedAmount) &&
                    !target.Contains(ItemizedDetailsAttributes.ValidatedAmount))
                    return;
                if (GetEffectiveDecimal(target, preImage, ItemizedDetailsAttributes.FundedAmount) <= 0m &&
                    GetEffectiveDecimal(target, preImage, ItemizedDetailsAttributes.ValidatedAmount) <= 0m)
                    return;

                var prioRef = GetEffectiveEntityReference(
                    target, preImage, ItemizedDetailsAttributes.Prioritization);
                if (prioRef == null && context.PrimaryEntityId != Guid.Empty)
                {
                    // Funded-only Update carries no parent lookup + no PreImage registered —
                    // read it from the committed row.
                    var self = service.Retrieve(EntityNames.ItemizedDetails, context.PrimaryEntityId,
                        new ColumnSet(ItemizedDetailsAttributes.Prioritization));
                    prioRef = self.GetAttributeValue<EntityReference>(ItemizedDetailsAttributes.Prioritization);
                }
                if (prioRef == null) return;

                var prio = service.Retrieve(EntityNames.Prioritization, prioRef.Id,
                    new ColumnSet(PrioritizationAttributes.Requirement, PrioritizationAttributes.FiscalYear));
                requirementRef = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.Requirement);
                fiscalYear = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FiscalYear)?.Value;
            }
            else if (context.PrimaryEntityName == EntityNames.Prioritization)
            {
                if (!target.Contains(PrioritizationAttributes.FundedAmountTDP) &&
                    !target.Contains(PrioritizationAttributes.ValidatedAmount))
                    return;
                if (GetEffectiveDecimal(target, preImage, PrioritizationAttributes.FundedAmountTDP) <= 0m &&
                    GetEffectiveDecimal(target, preImage, PrioritizationAttributes.ValidatedAmount) <= 0m)
                    return;

                requirementRef = GetEffectiveEntityReference(
                    target, preImage, PrioritizationAttributes.Requirement);
                fiscalYear = GetEffectiveOptionSetValue(
                    target, preImage, PrioritizationAttributes.FiscalYear)?.Value;
                if ((requirementRef == null || fiscalYear == null) && context.PrimaryEntityId != Guid.Empty)
                {
                    // Funded-only Update carries neither lookup + no PreImage registered —
                    // read them from the committed Prioritization row.
                    var self = service.Retrieve(EntityNames.Prioritization, context.PrimaryEntityId,
                        new ColumnSet(PrioritizationAttributes.Requirement, PrioritizationAttributes.FiscalYear));
                    requirementRef = requirementRef
                        ?? self.GetAttributeValue<EntityReference>(PrioritizationAttributes.Requirement);
                    fiscalYear = fiscalYear
                        ?? self.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FiscalYear)?.Value;
                }
            }
            else
            {
                return;
            }

            if (requirementRef == null || fiscalYear == null)
            {
                tracing.Trace("No Requirement / Fiscal Year resolved — precondition skipped.");
                return;
            }

            if (!HasActiveRfForFy(service, requirementRef.Id, fiscalYear.Value))
            {
                throw new InvalidPluginExecutionException(
                    $"Add at least one Requirement Funding for FY {fiscalYear} before funding details. " +
                    "Identify all source RFs for this Prioritization up front where possible.");
            }

            tracing.Trace("Funding precondition passed: at least one Requirement Funding present.");
        }

        private static bool HasActiveRfForFy(IOrganizationService service, Guid requirementId, int fiscalYear)
        {
            var query = new QueryExpression(EntityNames.RequirementFunding)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RequirementFundingAttributes.Requirement, ConditionOperator.Equal, requirementId),
                        new ConditionExpression(RequirementFundingAttributes.FiscalYear, ConditionOperator.Equal, fiscalYear),
                        new ConditionExpression(RequirementFundingAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return service.RetrieveMultiple(query).Entities.Count > 0;
        }
    }
}
