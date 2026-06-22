using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Recalculates both the parent Requirement Detail's and the parent
    /// Requirement Funding's totals whenever a book_requirementdetailfunding
    /// junction row is created, updated (on amount / parent-RD / parent-RF /
    /// statecode), or deleted.
    ///
    /// Mirrors the PrioritizationFundingRollup pattern.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Create   | Stage: PostOperation | Mode: Sync
    ///         Filtering attributes: (none)
    ///   • Message: Update   | Stage: PostOperation | Mode: Sync
    ///         Filtering attributes: book_fundedamount, book_validatedamount,
    ///                               book_requirementdetail, book_requirementfunding,
    ///                               statecode
    ///         PreImage:  "PreImage" — book_fundedamount, book_validatedamount,
    ///                                 book_requirementdetail, book_requirementfunding
    ///   • Message: Delete   | Stage: PostOperation | Mode: Sync
    ///         PreImage:  "PreImage" — book_requirementdetail, book_requirementfunding
    /// </summary>
    public class RequirementDetailFundingRollup : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.RequirementDetailFunding)
                return;

            if (context.MessageName != "Create" &&
                context.MessageName != "Update" &&
                context.MessageName != "Delete")
                return;

            if (context.Depth > 1)
                return;

            Entity target;
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

            // Collect affected RDs and RFs (recalc both old and new parent on
            // re-parent updates so neither is left stale).
            var rds = new HashSet<Guid>();
            var rfs = new HashSet<Guid>();

            AddIfPresent(rds, target.GetAttributeValue<EntityReference>(
                RequirementDetailFundingAttributes.RequirementDetail));
            AddIfPresent(rds, preImage?.GetAttributeValue<EntityReference>(
                RequirementDetailFundingAttributes.RequirementDetail));

            AddIfPresent(rfs, target.GetAttributeValue<EntityReference>(
                RequirementDetailFundingAttributes.RequirementFunding));
            AddIfPresent(rfs, preImage?.GetAttributeValue<EntityReference>(
                RequirementDetailFundingAttributes.RequirementFunding));

            foreach (var rdId in rds)
            {
                tracing.Trace($"Rolling up junctions for RD {rdId}");
                RequirementDetailFundingRollupHelper.RecalculateRequirementDetail(
                    service, rdId, tracing);
            }

            foreach (var rfId in rfs)
            {
                tracing.Trace($"Rolling up junctions + Prios for RF {rfId}");
                PrioritizationRollupHelper.RecalculateRFFunded(service, rfId, tracing);
            }

            tracing.Trace("Requirement Detail Funding rollup complete.");
        }

        private static void AddIfPresent(HashSet<Guid> set, EntityReference reference)
        {
            if (reference != null)
                set.Add(reference.Id);
        }
    }
}
