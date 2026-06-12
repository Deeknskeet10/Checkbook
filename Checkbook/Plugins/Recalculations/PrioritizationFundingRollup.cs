using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Recalculates the parent Prioritization's FundedAmountTDP /
    /// ValidatedAmount whenever a book_prioritizationfunding junction row is
    /// created, updated (on amount/parent-Prio/statecode), or deleted.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Create   | Stage: PostOperation | Mode: Sync
    ///         Filtering attributes: (none)
    ///   • Message: Update   | Stage: PostOperation | Mode: Sync
    ///         Filtering attributes: book_fundedamount, book_validatedamount,
    ///                               book_prioritization, statecode
    ///         PreImage:  "PreImage" — book_fundedamount, book_validatedamount,
    ///                                 book_prioritization
    ///   • Message: Delete   | Stage: PostOperation | Mode: Sync
    ///         PreImage:  "PreImage" — book_prioritization
    ///
    /// The actual aggregate fetch + Prio update lives in
    /// PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded.
    /// </summary>
    public class PrioritizationFundingRollup : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.PrioritizationFunding)
                return;

            if (context.MessageName != "Create" &&
                context.MessageName != "Update" &&
                context.MessageName != "Delete")
                return;

            if (context.Depth > 1)
                return;

            Entity target = null;
            Entity preImage = null;

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

            if (target == null)
            {
                tracing.Trace("No target or pre-image — nothing to roll up.");
                return;
            }

            var newPrioRef = target.GetAttributeValue<EntityReference>(
                PrioritizationFundingAttributes.Prioritization
            );
            var oldPrioRef = preImage?.GetAttributeValue<EntityReference>(
                PrioritizationFundingAttributes.Prioritization
            );

            // If the parent Prio was reassigned on Update, recalc the old parent too.
            if (oldPrioRef != null && newPrioRef != null && oldPrioRef.Id != newPrioRef.Id)
            {
                tracing.Trace($"Parent Prioritization changed: {oldPrioRef.Id} → {newPrioRef.Id}");
                PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded(
                    service, oldPrioRef.Id, tracing);
            }

            var prioRef = newPrioRef ?? oldPrioRef;
            if (prioRef == null)
            {
                tracing.Trace("No parent Prioritization on target or pre-image — nothing to roll up.");
                return;
            }

            PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded(
                service, prioRef.Id, tracing);

            tracing.Trace("Prioritization rollup complete.");
        }
    }
}
