using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard for book_prioritizationfunding junction rows.
    ///
    /// Enforces, in order:
    ///   1. Both Prioritization and Requirement Funding lookups are present.
    ///   2. The two parents share the same Requirement and Fiscal Year.
    ///   3. The (Prioritization, RF) pair is unique among active junctions.
    ///   4. Sum of active junction FundedAmount on the RF (with this change
    ///      applied) does not exceed RF.TDP. The LOA-level check happens when
    ///      TDP is transferred to the RF (RequirementFundingTDPValidator), so
    ///      we don't repeat it here.
    ///
    /// Also autopopulates book_name on Create when the caller hasn't set one,
    /// using "<Prio> ↔ <RF>" so junction rows are readable in views/error text.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Create   | Stage: PreOperation | Mode: Sync
    ///   • Message: Update   | Stage: PreOperation | Mode: Sync
    ///         Filtering attributes: book_prioritization, book_requirementfunding,
    ///                               book_fundedamount, book_validatedamount
    ///         PreImage:  "PreImage" — all four filtered attrs
    /// </summary>
    public class PrioritizationFundingGuard : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.PrioritizationFunding)
                return;

            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = context.MessageName == "Update" ? TryGetPreImage(context) : null;

            var prioRef = GetEffectiveEntityReference(
                target, preImage, PrioritizationFundingAttributes.Prioritization);
            var rfRef = GetEffectiveEntityReference(
                target, preImage, PrioritizationFundingAttributes.RequirementFunding);

            if (prioRef == null || rfRef == null)
            {
                throw new InvalidPluginExecutionException(
                    "Prioritization Funding requires both a Prioritization and a Requirement Funding.");
            }

            // ---- Retrieve both parents (one round trip each) ----
            var prio = service.Retrieve(
                EntityNames.Prioritization,
                prioRef.Id,
                new ColumnSet(
                    PrioritizationAttributes.Requirement,
                    PrioritizationAttributes.FiscalYear,
                    PrioritizationAttributes.Name
                )
            );

            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                rfRef.Id,
                new ColumnSet(
                    RequirementFundingAttributes.Requirement,
                    RequirementFundingAttributes.FiscalYear,
                    RequirementFundingAttributes.TDP,
                    RequirementFundingAttributes.Name
                )
            );

            // ---- 1. Same Requirement ----
            var prioReq = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.Requirement);
            var rfReq = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.Requirement);

            if (prioReq == null || rfReq == null || prioReq.Id != rfReq.Id)
            {
                throw new InvalidPluginExecutionException(
                    "Prioritization and Requirement Funding must belong to the same Requirement.");
            }

            // ---- 2. Same Fiscal Year ----
            // book_newfiscalyear is a picklist on both entities (goal_fiscalyear
            // global option set), so read OptionSetValue and compare .Value.
            var prioFY = prio
                .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FiscalYear)?.Value;
            var rfFY = rf
                .GetAttributeValue<OptionSetValue>(RequirementFundingAttributes.FiscalYear)?.Value;

            if (prioFY == null || rfFY == null || prioFY != rfFY)
            {
                throw new InvalidPluginExecutionException(
                    $"Prioritization (FY {prioFY?.ToString() ?? "?"}) and " +
                    $"Requirement Funding (FY {rfFY?.ToString() ?? "?"}) must share the same Fiscal Year.");
            }

            // ---- 3. Uniqueness of (Prio, RF) ----
            JunctionGuard.EnsureUniquePair(
                service, tracing,
                EntityNames.PrioritizationFunding,
                PrioritizationFundingAttributes.Id,
                PrioritizationFundingAttributes.StateCode,
                PrioritizationFundingAttributes.Prioritization, prioRef.Id,
                PrioritizationFundingAttributes.RequirementFunding, rfRef.Id,
                context,
                "An active Prioritization Funding already exists for this Prioritization / Requirement Funding pair.");

            // ---- 4. RF.TDP cap + LOA remaining ----
            var rfTDP = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;
            var newFunded = GetEffectiveDecimal(
                target, preImage, PrioritizationFundingAttributes.FundedAmount);
            var oldFunded = preImage?.GetAttributeValue<decimal?>(
                PrioritizationFundingAttributes.FundedAmount) ?? 0m;
            JunctionGuard.EnforceTDPCap(
                service, tracing,
                EntityNames.PrioritizationFunding,
                PrioritizationFundingAttributes.StateCode,
                PrioritizationFundingAttributes.RequirementFunding,
                PrioritizationFundingAttributes.FundedAmount,
                rfRef.Id, rfTDP,
                newFunded, oldFunded,
                context);

            // ---- Name autopop (Create only, when caller didn't set one) ----
            if (context.MessageName == "Create" &&
                string.IsNullOrWhiteSpace(target.GetAttributeValue<string>(PrioritizationFundingAttributes.Name)))
            {
                var prioName = prio.GetAttributeValue<string>(PrioritizationAttributes.Name) ?? "Prio";
                var rfName = rf.GetAttributeValue<string>(RequirementFundingAttributes.Name) ?? "RF";
                target[PrioritizationFundingAttributes.Name] = $"{prioName} ↔ {rfName}";
            }

            tracing.Trace("Prioritization Funding guard passed.");
        }
    }
}
