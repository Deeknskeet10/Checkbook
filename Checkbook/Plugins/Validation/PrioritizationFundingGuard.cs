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
                    PrioritizationAttributes.ApprovalStatus,
                    PrioritizationAttributes.FundingMode,
                    PrioritizationAttributes.FundedAmountTDP,
                    PrioritizationAttributes.ValidatedAmount,
                    PrioritizationAttributes.Name,
                    "ownerid"
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

            // ---- 4b. Aggregate cap: Σ active PF ≤ the Prioritization total (Itemized) ----
            // Per-RF allocations may not exceed the Prioritization's funded total. For Itemized
            // Prios that total is the authoritative Σ(ItemizedDetails); the junctions distribute
            // it across RFs and must reconcile to it. Direct-mode Prios have no independent item
            // total (PrioritizationFundingRollup makes Prio.funded = Σ PF) so the cap is a no-op
            // there. Under-allocation stays allowed (incomplete) — the grid blocks leaving it
            // unbalanced. See docs/Prioritization-Funding-Reconciliation.md.
            var prioMode = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode)?.Value;
            if (prioMode == FundingModeValues.Itemized)
            {
                var newValidated = GetEffectiveDecimal(
                    target, preImage, PrioritizationFundingAttributes.ValidatedAmount);
                var prioFunded = prio.GetAttributeValue<decimal?>(PrioritizationAttributes.FundedAmountTDP) ?? 0m;
                var prioValidated = prio.GetAttributeValue<decimal?>(PrioritizationAttributes.ValidatedAmount) ?? 0m;
                var (otherFunded, otherValidated) = SumOtherActivePF(service, prioRef.Id, context);

                if (otherFunded + newFunded > prioFunded)
                    throw new InvalidPluginExecutionException(
                        $"Allocations to RFs ({otherFunded + newFunded:N2}) would exceed the Prioritization's " +
                        $"funded total ({prioFunded:N2}). Lower this allocation or raise the detail funding.");
                if (otherValidated + newValidated > prioValidated)
                    throw new InvalidPluginExecutionException(
                        $"Allocations to RFs ({otherValidated + newValidated:N2}) would exceed the Prioritization's " +
                        $"validated total ({prioValidated:N2}).");
            }

            // ---- 5. Funding only on an NPM-Review Prioritization ----
            // FY27 funding lives on these junction rows, so mirror the
            // Prio-level PrioritizationFundingApprovalGuard here: a Prio that
            // hasn't reached NPM Review must not receive funding through the
            // junction either (or it would be invisible to the FinalApproved-only
            // RF roll-up and surface as a phantom TDP gap). Increases only —
            // reductions and the pull-back deactivation stay allowed.
            if (newFunded > oldFunded)
            {
                var prioStatus = prio
                    .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.ApprovalStatus)?.Value;
                if (prioStatus != ApprovalStatusValues.FinalApproved)
                {
                    tracing.Trace(
                        $"Blocking junction funding increase {oldFunded:C} -> {newFunded:C} — " +
                        $"parent Prio {prioRef.Id} at ApprovalStatus " +
                        $"{(prioStatus?.ToString() ?? "null")} (NPM Review required).");
                    throw new InvalidPluginExecutionException(ValidationMessages.FundingRequiresNPMReview);
                }
            }

            // ---- Name autopop (Create only, when caller didn't set one) ----
            if (context.MessageName == "Create" &&
                string.IsNullOrWhiteSpace(target.GetAttributeValue<string>(PrioritizationFundingAttributes.Name)))
            {
                var prioName = prio.GetAttributeValue<string>(PrioritizationAttributes.Name) ?? "Prio";
                var rfName = rf.GetAttributeValue<string>(RequirementFundingAttributes.Name) ?? "RF";
                target[PrioritizationFundingAttributes.Name] = $"{prioName} ↔ {rfName}";
            }

            // ---- Owner alignment (Create only, when caller didn't set one) ----
            // NPM creates these junction rows, so by default they'd be owned by
            // the NPM user in the national BU — above the State BUs. Dataverse
            // BU-hierarchy read only reaches *down*, so State users could never
            // read NPM-owned rows. Reassign each row to its parent
            // Prioritization's owner (a State user) so it lands in the State's
            // BU and resolves under each State role's existing read depth.
            // The plugin runs with system privileges, so no prvAssign elevation
            // is needed. Only applied when the caller didn't set an explicit
            // owner, so callers can still override.
            if (context.MessageName == "Create" &&
                target.GetAttributeValue<EntityReference>("ownerid") == null)
            {
                var prioOwner = prio.GetAttributeValue<EntityReference>("ownerid");
                if (prioOwner != null)
                {
                    target["ownerid"] = prioOwner;
                }
            }

            tracing.Trace("Prioritization Funding guard passed.");
        }

        /// <summary>
        /// Σ funded/validated of the OTHER active junctions on this Prioritization
        /// (excludes the row being written on Update) — used for the aggregate
        /// "Σ PF ≤ Prio total" cap.
        /// </summary>
        private static (decimal funded, decimal validated) SumOtherActivePF(
            IOrganizationService service, Guid prioId, IPluginExecutionContext context)
        {
            var extra = (context.MessageName == "Update" && context.PrimaryEntityId != Guid.Empty)
                ? $"<condition attribute='{PrioritizationFundingAttributes.Id}' operator='ne' value='{context.PrimaryEntityId}'/>"
                : string.Empty;
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.PrioritizationFunding}'>
                        <attribute name='{PrioritizationFundingAttributes.FundedAmount}' alias='f' aggregate='sum'/>
                        <attribute name='{PrioritizationFundingAttributes.ValidatedAmount}' alias='v' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{PrioritizationFundingAttributes.Prioritization}' operator='eq' value='{prioId}'/>
                            <condition attribute='{PrioritizationFundingAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                            {extra}
                        </filter>
                    </entity>
                </fetch>";
            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            if (rows.Count == 0) return (0m, 0m);
            return (AliasedValueHelper.GetDecimal(rows[0], "f"), AliasedValueHelper.GetDecimal(rows[0], "v"));
        }
    }
}
