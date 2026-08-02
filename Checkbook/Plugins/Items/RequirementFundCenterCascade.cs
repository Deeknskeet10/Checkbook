using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// When a Requirement's Fund Center or centrally-managed (book_national) flag
    /// changes, cascade the new FC to every active Prioritization linked under
    /// the Requirement — directly via book_requirement (FY27+ shape) or via
    /// its Requirement Fundings (legacy shape). The Requirement is the
    /// source of truth for the FC of centrally managed work; Prios stay in
    /// sync.
    /// </summary>
    /// <remarks>
    /// Register: PostOperation, Sync, book_requirements, Update.
    /// Filter attrs: book_fundcenter, book_national.
    /// Pre-image (name "PreImage"): book_fundcenter, book_national.
    ///
    /// Cascade rule: if the post-update Requirement is centrally managed
    /// (book_national = 1) and has a non-null FC, all linked Prios receive
    /// that FC. Flips from 1 → 0 leave existing Prio FCs in place; the user
    /// is free to edit them once the form lock releases.
    /// </remarks>
    public class RequirementFundCenterCascade : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Requirements)
                return;
            if (context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            var fcChanged = HasAttributeChanged(target, RequirementsAttributes.FundCenter);
            var nationalChanged = HasAttributeChanged(target, RequirementsAttributes.National);
            if (!fcChanged && !nationalChanged)
            {
                tracing.Trace("Neither FC nor national changed; skipping cascade.");
                return;
            }

            var isNational = GetEffectiveBool(target, preImage, RequirementsAttributes.National);
            if (!isNational)
            {
                tracing.Trace("Requirement is not centrally managed post-update; no cascade.");
                return;
            }

            var newFc = GetEffectiveEntityReference(target, preImage, RequirementsAttributes.FundCenter);
            if (newFc == null)
            {
                tracing.Trace("Requirement is centrally managed but FC is null; nothing to cascade.");
                return;
            }

            var prios = QueryLinkedActivePrios(service, target.Id);
            tracing.Trace($"Cascading FC = {newFc.Id} to {prios.Entities.Count} Prio(s).");

            foreach (var prio in prios.Entities)
            {
                var currentFc = prio.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.FundCenter);
                if (currentFc != null && currentFc.Id == newFc.Id)
                    continue;

                // Prios with active Itemized Details are locked to their
                // state-level FC (PrioritizationItemizedFundCenterDefault);
                // cascading the Requirement FC onto them would fight the lock
                // and trip PrioritizationFundCenterLockGuard mid-transaction.
                if (Helpers.StateFundCenterResolver.HasActiveItemizedDetails(service, prio.Id))
                {
                    tracing.Trace(
                        $"Prio {prio.Id} has active Itemized Details (FC locked to state level); skipping cascade.");
                    continue;
                }

                var update = new Entity(EntityNames.Prioritization, prio.Id)
                {
                    [PrioritizationAttributes.FundCenter] = newFc,
                };
                service.Update(update);
            }
        }

        private static EntityCollection QueryLinkedActivePrios(IOrganizationService service, Guid requirementId)
        {
            // Matches both Prio shapes: FY27+ (direct book_requirement) and
            // legacy (book_requirementfunding → RF.Requirement).
            var query = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet(PrioritizationAttributes.FundCenter),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rfLink = query.AddLink(
                EntityNames.RequirementFunding,
                PrioritizationAttributes.RequirementFunding,
                RequirementFundingAttributes.Id,
                JoinOperator.LeftOuter);
            rfLink.EntityAlias = "rf";

            var shapeFilter = new FilterExpression(LogicalOperator.Or);
            shapeFilter.AddCondition(new ConditionExpression(
                PrioritizationAttributes.Requirement,
                ConditionOperator.Equal, requirementId));
            shapeFilter.AddCondition(new ConditionExpression(
                "rf",
                RequirementFundingAttributes.Requirement,
                ConditionOperator.Equal, requirementId));
            query.Criteria.AddFilter(shapeFilter);

            return service.RetrieveMultiple(query);
        }
    }
}
