using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// Stamps the spend-plan classification onto a Prioritization Funding (PF)
    /// row from its parent Requirement + Requirement Funding, so the PF becomes
    /// the point-in-time snapshot of how this allocation is spend-planned:
    ///   • book_centrallymanaged — mirror of Requirement.book_national
    ///   • book_spendplanmode    — Central (CM) / Breakout / State-Rollup
    ///   • book_lineofaccounting — the RF's LOA (Fund/SAG one link away)
    ///
    /// Mode is derived: centrally managed ⇒ Central; else breakout ⇒ Breakout;
    /// else State-Rollup (the default — never user-selected).
    ///
    /// Downstream consumers read these stamped values; they must not re-derive
    /// the mode from the live Requirement flag (that would corrupt past FYs).
    /// Maintenance after create is handled by RequirementSpendPlanModeCascade
    /// (flag flips) and RequirementFundingLoaCascade (LOA changes).
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, book_prioritizationfunding —
    ///   1. Create (no filter).
    ///   2. Update, filter: book_requirementfunding. Pre-image "PreImage":
    ///      book_requirementfunding (to detect a re-point).
    /// Pre-op so the values land in the same write (no extra Update).
    /// </remarks>
    public class PrioritizationFundingSpendPlanStamp : PluginBase
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
            var preImage = TryGetPreImage(context);

            // On Update we only care when the RF (the source of Requirement +
            // LOA) is being re-pointed; other edits leave the stamp intact.
            if (context.MessageName == "Update" &&
                !HasAttributeChanged(target, PrioritizationFundingAttributes.RequirementFunding))
            {
                tracing.Trace("RF unchanged on PF update; stamp already valid — skipping.");
                return;
            }

            var rfRef = GetEffectiveEntityReference(
                target, preImage, PrioritizationFundingAttributes.RequirementFunding);
            if (rfRef == null)
            {
                tracing.Trace("PF has no Requirement Funding; cannot stamp classification.");
                return;
            }

            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                rfRef.Id,
                new ColumnSet(
                    RequirementFundingAttributes.Requirement,
                    RequirementFundingAttributes.LineOfAccounting));

            var loa = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
            var reqRef = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.Requirement);

            bool national = false;
            bool breakout = false;
            if (reqRef != null)
            {
                var req = service.Retrieve(
                    EntityNames.Requirements,
                    reqRef.Id,
                    new ColumnSet(RequirementsAttributes.National, RequirementsAttributes.Breakout));
                national = req.GetAttributeValue<bool>(RequirementsAttributes.National);
                breakout = req.GetAttributeValue<bool>(RequirementsAttributes.Breakout);
            }
            else
            {
                tracing.Trace($"RF {rfRef.Id} has no Requirement; defaulting to State-Rollup.");
            }

            var mode = ResolveMode(national, breakout);

            target[PrioritizationFundingAttributes.CentrallyManaged] = national;
            target[PrioritizationFundingAttributes.SpendPlanMode] = new OptionSetValue(mode);
            target[PrioritizationFundingAttributes.LineOfAccounting] = loa; // may be null

            tracing.Trace(
                $"Stamped PF: CM={national}, mode={mode}, LOA={(loa == null ? "null" : loa.Id.ToString())}.");
        }

        /// <summary>Centrally managed ⇒ Central; else breakout ⇒ Breakout; else State-Rollup.</summary>
        public static int ResolveMode(bool national, bool breakout)
        {
            if (national) return SpendPlanModeValues.Central;
            if (breakout) return SpendPlanModeValues.Breakout;
            return SpendPlanModeValues.StateRollup;
        }
    }
}
