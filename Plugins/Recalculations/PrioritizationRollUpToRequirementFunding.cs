using Microsoft.Xrm.Sdk;
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
                target = preImage;
            }
            else
            {
                target = GetTarget(context);

                if (context.MessageName == "Update")
                    preImage = TryGetPreImage(context);
            }

            var parentRF = target.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding
            ) ?? preImage?.GetAttributeValue<EntityReference>(PrioritizationAttributes.RequirementFunding);

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
