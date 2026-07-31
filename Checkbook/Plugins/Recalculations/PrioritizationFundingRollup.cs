using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Recalculates the parent Prioritization's FundedAmountTDP /
    /// ValidatedAmount AND the parent Requirement Funding's FundedAmount /
    /// ValidatedAmount whenever a book_prioritizationfunding junction row is
    /// created, updated (on amount/parent-Prio/parent-RF/statecode), or deleted.
    ///
    /// The RF leg is done here (not left to PrioritizationRollupToRequirementFunding)
    /// because the Prio update this plugin issues runs at depth+1, where that
    /// depth-guarded plugin early-returns. RecalculateRFFunded sums the junction
    /// split per RF, so we recalc each affected RF (new + old on re-parent) directly.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Create   | Stage: PostOperation | Mode: Sync
    ///         Filtering attributes: (none)
    ///   • Message: Update   | Stage: PostOperation | Mode: Sync
    ///         Filtering attributes: book_fundedamount, book_validatedamount,
    ///                               book_prioritization, book_requirementfunding,
    ///                               statecode
    ///         PreImage:  "PreImage" — book_fundedamount, book_validatedamount,
    ///                                 book_prioritization, book_requirementfunding
    ///   • Message: Delete   | Stage: PostOperation | Mode: Sync
    ///         PreImage:  "PreImage" — book_prioritization, book_requirementfunding
    ///
    /// The aggregate fetch + Prio update lives in
    /// PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded; the RF
    /// math lives in PrioritizationRollupHelper.RecalculateRFFunded.
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

            // ---- Roll the junction split up onto the parent RF(s) ----
            // The Prio update above runs at depth+1, so the depth-guarded
            // PrioritizationRollupToRequirementFunding will NOT fire to refresh
            // the RF. The FY27 RF total is driven by the junction split (summed
            // per RF in RecalculateRFFunded), so recalc each affected RF here.
            var newRfRef = target.GetAttributeValue<EntityReference>(
                PrioritizationFundingAttributes.RequirementFunding);
            var oldRfRef = preImage?.GetAttributeValue<EntityReference>(
                PrioritizationFundingAttributes.RequirementFunding);

            var rfIds = new HashSet<Guid>();
            if (newRfRef != null) rfIds.Add(newRfRef.Id);
            if (oldRfRef != null) rfIds.Add(oldRfRef.Id);

            // Defensive fallback: RF absent from Target + PreImage on a non-Delete
            // (e.g. the RF wasn't in the filtered PreImage) — read it from the row.
            // Delete can't fall back; the row is already gone.
            if (rfIds.Count == 0 && context.MessageName != "Delete" && target.Id != Guid.Empty)
            {
                tracing.Trace("Parent RF missing from Target/PreImage; retrieving from junction row.");
                var fetched = service.Retrieve(
                    EntityNames.PrioritizationFunding,
                    target.Id,
                    new ColumnSet(PrioritizationFundingAttributes.RequirementFunding));
                var rf = fetched?.GetAttributeValue<EntityReference>(
                    PrioritizationFundingAttributes.RequirementFunding);
                if (rf != null) rfIds.Add(rf.Id);
            }

            foreach (var rfId in rfIds)
            {
                tracing.Trace($"Recalculating RF {rfId} from junction split.");
                PrioritizationRollupHelper.RecalculateRFFunded(service, rfId, tracing);
            }

            tracing.Trace("Requirement Funding roll-up complete.");
        }
    }
}
