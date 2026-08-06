using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// Keeps a Prioritization's book_fundingmode and its book_itemizeddetails
    /// children consistent with the book_requirementdetails defined on the
    /// parent Requirement.
    ///
    /// Itemized Details are user-selected: the ItemizedDetailsGrid control on the
    /// Prioritization form lets the user pick which Requirement Details to add.
    /// This plugin no longer creates Itemized Details — it only sets the funding
    /// mode and cleans up rows that would otherwise be orphaned or stale.
    ///
    /// Steps handled (branches on message + primary entity):
    /// - book_requirementdetails Delete  (Pre-Operation, Sync):
    ///       remove every Itemized Detail that points back to the deleted Requirement Detail.
    /// - book_prioritization Create      (Post-Operation, Async):
    ///       set book_fundingmode to Itemized when the Requirement has Requirement
    ///       Details (Requested is then owned by the rollup), otherwise leave Direct.
    /// - book_prioritization Update      (Post-Operation, Async, filtering
    ///       book_requirement + book_requirementfunding):
    ///       when the user re-points a Prioritization at a different Requirement —
    ///       via the direct book_requirement lookup (FY27+) or via a different
    ///       Requirement Funding (legacy) — wipe the now-stale Itemized Details
    ///       and reset the funding mode from the new Requirement's details.
    ///
    /// Each Itemized Detail delete here triggers <see cref="PrioritizationItemizedRollup"/>.
    /// </summary>
    public class ItemizedDetailsSynchronizer : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var message = context.MessageName;
            var entity = context.PrimaryEntityName;

            if (message == "Delete" && entity == EntityNames.RequirementDetails)
                HandleRequirementDetailDeleted(context, service, tracingService);
            else if (message == "Create" && entity == EntityNames.Prioritization)
                HandlePrioritizationCreated(context, service, tracingService);
            else if (message == "Update" && entity == EntityNames.Prioritization)
                HandlePrioritizationRequirementChanged(context, service, tracingService);
            else
                tracingService.Trace($"No handler for {message} on {entity}.");
        }

        /// <summary>
        /// A new Prioritization was created — if its Requirement has Requirement
        /// Details, flip the Prioritization to Itemized mode. Itemized Details
        /// themselves are added by the user from the grid, not seeded here.
        ///
        /// FY27+ Prios carry the Requirement directly via book_requirement (the
        /// per-RF link moved to the book_prioritizationfunding junction).
        /// Legacy Prios still use the direct book_requirementfunding lookup, so
        /// we fall back to RF→Requirement when book_requirement is empty.
        /// </summary>
        private void HandlePrioritizationCreated(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var prioritizationId = context.PrimaryEntityId;

            // Re-read instead of trusting Target: book_requirement may have been
            // set by a sync plugin/workflow that ran between Target materialise
            // and this Post-Op Async stage.
            var prioritization = service.Retrieve(
                EntityNames.Prioritization,
                prioritizationId,
                new ColumnSet(
                    PrioritizationAttributes.Requirement,
                    PrioritizationAttributes.RequirementFunding));

            var requirement = prioritization.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.Requirement);

            if (requirement == null)
            {
                var requirementFunding = prioritization.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.RequirementFunding);
                if (requirementFunding == null)
                {
                    tracingService.Trace(
                        "Prioritization has neither Requirement nor Requirement Funding; nothing to do.");
                    return;
                }

                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    requirementFunding.Id,
                    new ColumnSet(RequirementFundingAttributes.Requirement));

                requirement = rf.GetAttributeValue<EntityReference>(
                    RequirementFundingAttributes.Requirement);
                if (requirement == null)
                {
                    tracingService.Trace("Requirement Funding has no Requirement; nothing to do.");
                    return;
                }
            }

            var detailCount = GetRequirementDetails(service, requirement.Id).Count;
            tracingService.Trace(
                $"Found {detailCount} Requirement Detail(s) for Requirement {requirement.Id}.");

            if (detailCount == 0)
            {
                tracingService.Trace(
                    "Requirement has no Requirement Details; leaving Prioritization in Direct funding mode.");
                return;
            }

            // The Requirement itemizes its funding, so this Prioritization adopts
            // Itemized mode: Requested is locked on the form and only ever written
            // by the rollup once the user adds Itemized Details from the grid.
            service.Update(new Entity(EntityNames.Prioritization, prioritizationId)
            {
                [PrioritizationAttributes.FundingMode] =
                    new OptionSetValue(FundingModeValues.Itemized)
            });

            tracingService.Trace("Set Prioritization to Itemized.");
        }

        /// <summary>
        /// The Prioritization was re-pointed — its book_requirement lookup (FY27+)
        /// or book_requirementfunding lookup (legacy RF→Requirement) changed. If
        /// the effective Requirement is now a different one, the existing Itemized
        /// Details are linked to Requirement Details of the wrong Requirement —
        /// delete them all and reset the funding mode from the new Requirement.
        /// The user re-selects Itemized Details from the grid afterwards.
        /// </summary>
        private void HandlePrioritizationRequirementChanged(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var target = GetTarget(context);
            if (!target.Contains(PrioritizationAttributes.Requirement) &&
                !target.Contains(PrioritizationAttributes.RequirementFunding))
            {
                tracingService.Trace(
                    "Neither book_requirement nor book_requirementfunding in Target; nothing to do.");
                return;
            }

            var prioritizationId = context.PrimaryEntityId;
            var preImage = TryGetPreImage(context);

            var oldRequirementId = ResolveRequirementId(
                service,
                preImage?.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.Requirement),
                preImage?.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.RequirementFunding));

            var newRequirementId = ResolveRequirementId(
                service,
                GetEffectiveEntityReference(target, preImage,
                    PrioritizationAttributes.Requirement),
                GetEffectiveEntityReference(target, preImage,
                    PrioritizationAttributes.RequirementFunding));

            if (oldRequirementId == newRequirementId)
            {
                tracingService.Trace(
                    $"Effective Requirement unchanged ({newRequirementId}); Itemized Details remain valid.");
                return;
            }

            var existing = GetItemizedDetailsForPrioritization(service, prioritizationId);
            tracingService.Trace(
                $"Deleting {existing.Count} stale Itemized Detail(s) on Prioritization {prioritizationId}.");
            foreach (var id in existing)
                service.Delete(EntityNames.ItemizedDetails, id);

            var detailCount = newRequirementId == Guid.Empty
                ? 0
                : GetRequirementDetails(service, newRequirementId).Count;
            tracingService.Trace(
                $"Found {detailCount} Requirement Detail(s) for new Requirement {newRequirementId}.");

            // Itemized when the new Requirement itemizes (user re-selects details
            // from the grid); Direct when it doesn't — or when the Requirement was
            // cleared entirely — so the user can hand-enter funding instead of
            // being stranded in Itemized mode with nothing to roll up from.
            service.Update(new Entity(EntityNames.Prioritization, prioritizationId)
            {
                [PrioritizationAttributes.FundingMode] = new OptionSetValue(
                    detailCount > 0 ? FundingModeValues.Itemized : FundingModeValues.Direct)
            });

            tracingService.Trace(
                $"Set Prioritization to {(detailCount > 0 ? "Itemized" : "Direct")}.");
        }

        /// <summary>
        /// Resolves the effective Requirement behind a Prioritization: the direct
        /// book_requirement lookup when set (FY27+), otherwise the legacy
        /// RF→Requirement hop. Guid.Empty when neither resolves.
        /// </summary>
        private static Guid ResolveRequirementId(
            IOrganizationService service,
            EntityReference requirement,
            EntityReference requirementFunding)
        {
            if (requirement != null)
                return requirement.Id;

            if (requirementFunding != null)
                return GetRequirementIdFromRequirementFunding(service, requirementFunding.Id);

            return Guid.Empty;
        }

        /// <summary>
        /// A Requirement Detail is being deleted — delete every Itemized Detail that
        /// points back to it. The book_requirementitem relationship cascades as
        /// RemoveLink, so without this they would be left orphaned. Runs Pre-Operation
        /// so the children are removed before the parent row goes.
        /// </summary>
        private void HandleRequirementDetailDeleted(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var detailId = context.PrimaryEntityId;

            var query = new QueryExpression(EntityNames.ItemizedDetails)
            {
                ColumnSet = new ColumnSet(false),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            ItemizedDetailsAttributes.RequirementItem,
                            ConditionOperator.Equal,
                            detailId)
                    }
                }
            };

            var itemizedDetails = service.RetrieveMultiple(query).Entities;
            tracingService.Trace(
                $"Deleting {itemizedDetails.Count} Itemized Detail(s) linked to Requirement Detail {detailId}.");

            foreach (var record in itemizedDetails)
                service.Delete(EntityNames.ItemizedDetails, record.Id);
        }

        /// <summary>
        /// Returns the Requirement Id behind a Requirement Funding, or Guid.Empty if
        /// the RF doesn't exist or has no Requirement.
        /// </summary>
        private static Guid GetRequirementIdFromRequirementFunding(
            IOrganizationService service, Guid requirementFundingId)
        {
            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                requirementFundingId,
                new ColumnSet(RequirementFundingAttributes.Requirement));
            return rf.GetAttributeValue<EntityReference>(
                RequirementFundingAttributes.Requirement)?.Id ?? Guid.Empty;
        }

        /// <summary>Returns the ids of every Itemized Detail currently on a Prioritization.</summary>
        private static List<Guid> GetItemizedDetailsForPrioritization(
            IOrganizationService service, Guid prioritizationId)
        {
            var query = new QueryExpression(EntityNames.ItemizedDetails)
            {
                ColumnSet = new ColumnSet(false),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            ItemizedDetailsAttributes.Prioritization,
                            ConditionOperator.Equal,
                            prioritizationId)
                    }
                }
            };

            return service.RetrieveMultiple(query).Entities
                .Select(e => e.Id)
                .ToList();
        }

        /// <summary>Returns the ids of every active Requirement Detail on a Requirement.</summary>
        private static List<Guid> GetRequirementDetails(
            IOrganizationService service, Guid requirementId)
        {
            var query = new QueryExpression(EntityNames.RequirementDetails)
            {
                ColumnSet = new ColumnSet(false),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            RequirementDetailsAttributes.Requirement,
                            ConditionOperator.Equal,
                            requirementId),
                        new ConditionExpression(
                            RequirementDetailsAttributes.StateCode,
                            ConditionOperator.Equal,
                            StateCodeValues.Active)
                    }
                }
            };

            return service.RetrieveMultiple(query).Entities
                .Select(e => e.Id)
                .ToList();
        }
    }
}
