using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Recalculates the parent Requirement Funding's FundedAmount /
    /// ValidatedAmount from its child Prioritizations whenever a Prioritization
    /// is created, updated (on funded/validated/parent-RF), or deleted.
    ///
    /// The actual aggregate fetch + update lives in
    /// PrioritizationRollupHelper.RecalculateRFFunded. This plugin is
    /// intentionally a thin shell that determines which parent RF needs the
    /// recalc and delegates. Depth-1 actors (e.g. RealignmentProcessor) that
    /// need the rollup result after their own nested Prioritization updates
    /// must call the helper directly — this plugin still early-returns on
    /// Depth &gt; 1 to avoid re-entry.
    /// </summary>
    public class PrioritizationRollupToRequirementFunding : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization)
                return;

            if (context.MessageName != "Create" &&
                context.MessageName != "Update" &&
                context.MessageName != "Delete")
                return;

            if (context.Depth > 1)
                return;

            Entity preImage = null;
            Entity target = null;

            if (context.MessageName == "Delete")
            {
                preImage = TryGetPreImage(context);
                if (preImage == null)
                {
                    tracing.Trace("Delete without a pre-image — cannot resolve the parent RF.");
                    return;
                }
                target = preImage;
            }
            else
            {
                target = GetTarget(context);

                if (context.MessageName == "Update")
                    preImage = TryGetPreImage(context);
            }

            var parentRF = GetEffectiveEntityReference(
                target, preImage, PrioritizationAttributes.RequirementFunding);

            // Re-parented Prio: the old RF loses this Prio's funded amount and
            // must be recalculated too, or it stays overstated.
            var previousRF = preImage?.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding);
            if (previousRF != null && (parentRF == null || previousRF.Id != parentRF.Id))
            {
                tracing.Trace($"Prio moved off RF {previousRF.Id}; recalculating it.");
                PrioritizationRollupHelper.RecalculateRFFunded(service, previousRF.Id, tracing);
            }

            // Defensive fallback: if neither Target nor PreImage carried the RF
            // (e.g. PreImage registration dropped), retrieve it from the row.
            // The Delete branch can't fall back — the row is already gone.
            if (parentRF == null && context.MessageName != "Delete" && target.Id != System.Guid.Empty)
            {
                tracing.Trace("Parent RF missing from Target/PreImage; retrieving from Prio row.");
                var fetched = service.Retrieve(
                    EntityNames.Prioritization,
                    target.Id,
                    new ColumnSet(PrioritizationAttributes.RequirementFunding));
                parentRF = fetched?.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.RequirementFunding);
            }

            if (parentRF == null)
            {
                tracing.Trace("No parent RF — nothing to roll up.");
                return;
            }

            tracing.Trace($"Rolling up Prioritizations for RF {parentRF.Id}");

            PrioritizationRollupHelper.RecalculateRFFunded(service, parentRF.Id, tracing);

            tracing.Trace("Requirement Funding roll-up updated successfully.");
        }
    }
}
