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
    /// Keeps book_itemizeddetails records in sync with the book_requirementdetails
    /// defined on a Requirement.
    ///
    /// Workflow: Admins define book_item records; NPMs add them to a Requirement as
    /// book_requirementdetails. Every Prioritization tied to that Requirement — matched
    /// via its book_requirementfunding -> book_requirement — gets a matching
    /// book_itemizeddetails record that points back to the source Requirement Detail
    /// through book_requirementitem.
    ///
    /// Steps handled (branches on message + primary entity):
    /// - book_requirementdetails Create  (Post-Operation, Async):
    ///       fan a new Itemized Detail out to every existing Prioritization of the Requirement.
    /// - book_requirementdetails Delete  (Pre-Operation, Sync):
    ///       remove every Itemized Detail that points back to the deleted Requirement Detail.
    /// - book_prioritization Create      (Post-Operation, Async):
    ///       seed Itemized Details for the new Prioritization from the Requirement's details.
    /// - book_prioritization Update      (Post-Operation, Async, filtering book_requirementfunding):
    ///       when the user re-points a Prioritization to a different Requirement Funding
    ///       (and therefore a different Requirement), wipe the now-stale Itemized Details
    ///       and reseed from the new Requirement's details.
    ///
    /// Newly created Itemized Details carry only the two lookups (book_prioritization,
    /// book_requirementitem); users populate the quantity and funding amounts afterward.
    /// Each Itemized Detail create/delete here triggers <see cref="PrioritizationItemizedRollup"/>.
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

            if (message == "Create" && entity == EntityNames.RequirementDetails)
                HandleRequirementDetailCreated(context, service, tracingService);
            else if (message == "Delete" && entity == EntityNames.RequirementDetails)
                HandleRequirementDetailDeleted(context, service, tracingService);
            else if (message == "Create" && entity == EntityNames.Prioritization)
                HandlePrioritizationCreated(context, service, tracingService);
            else if (message == "Update" && entity == EntityNames.Prioritization)
                HandlePrioritizationRequirementFundingChanged(context, service, tracingService);
            else
                tracingService.Trace($"No handler for {message} on {entity}.");
        }

        /// <summary>
        /// A Requirement Detail was added — create a matching Itemized Detail on every
        /// Prioritization already tied to that Requirement.
        /// </summary>
        private void HandleRequirementDetailCreated(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var detail = GetTarget(context);
            var detailId = context.PrimaryEntityId;

            var requirement = detail.GetAttributeValue<EntityReference>(
                RequirementDetailsAttributes.Requirement);
            if (requirement == null)
            {
                tracingService.Trace("Requirement Detail has no Requirement; nothing to sync.");
                return;
            }

            var prioritizations = GetPrioritizationsForRequirement(service, requirement.Id);
            tracingService.Trace(
                $"Found {prioritizations.Count} Itemized Prioritization(s) for Requirement {requirement.Id}.");

            var created = 0;
            foreach (var p in prioritizations)
            {
                if (ItemizedDetailExists(service, p.Id, detailId))
                {
                    tracingService.Trace(
                        $"Itemized Detail already exists for Prioritization {p.Id}; skipping.");
                    continue;
                }

                var owningBu = p.GetAttributeValue<EntityReference>("owningbusinessunit");
                CreateItemizedDetail(service, p.Id, detailId, owningBu);
                created++;
            }

            tracingService.Trace($"Created {created} Itemized Detail(s).");
        }

        /// <summary>
        /// A new Prioritization was created — seed its Itemized Details from the
        /// Requirement Details of its Requirement.
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
                    PrioritizationAttributes.RequirementFunding,
                    "owningbusinessunit"));

            var requirement = prioritization.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.Requirement);

            if (requirement == null)
            {
                var requirementFunding = prioritization.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.RequirementFunding);
                if (requirementFunding == null)
                {
                    tracingService.Trace(
                        "Prioritization has neither Requirement nor Requirement Funding; nothing to sync.");
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
                    tracingService.Trace("Requirement Funding has no Requirement; nothing to sync.");
                    return;
                }
            }

            var detailIds = GetRequirementDetails(service, requirement.Id);
            tracingService.Trace(
                $"Found {detailIds.Count} Requirement Detail(s) for Requirement {requirement.Id}.");

            if (detailIds.Count == 0)
            {
                tracingService.Trace(
                    "Requirement has no Requirement Details; leaving Prioritization in Direct funding mode.");
                return;
            }

            var owningBu = prioritization.GetAttributeValue<EntityReference>("owningbusinessunit");

            // The Requirement already itemizes its funding, so this Prioritization
            // adopts Itemized mode. Flip the flag before seeding so the rollup that
            // fires on each Itemized Detail create sees the Prioritization as Itemized.
            service.Update(new Entity(EntityNames.Prioritization, prioritizationId)
            {
                [PrioritizationAttributes.FundingMode] =
                    new OptionSetValue(FundingModeValues.Itemized)
            });

            foreach (var detailId in detailIds)
                CreateItemizedDetail(service, prioritizationId, detailId, owningBu);

            tracingService.Trace(
                $"Set Prioritization to Itemized and created {detailIds.Count} Itemized Detail(s).");
        }

        /// <summary>
        /// The Prioritization's book_requirementfunding lookup changed. If the new RF
        /// points to a different Requirement than the old one, the existing Itemized
        /// Details are now linked to Requirement Details of the wrong Requirement —
        /// delete them all and reseed from the new Requirement's Requirement Details.
        /// </summary>
        private void HandlePrioritizationRequirementFundingChanged(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var target = GetTarget(context);
            if (!target.Contains(PrioritizationAttributes.RequirementFunding))
            {
                tracingService.Trace(
                    "book_requirementfunding not in Target; nothing to do.");
                return;
            }

            var prioritizationId = context.PrimaryEntityId;
            var preImage = TryGetPreImage(context);

            var oldRf = preImage?.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding);
            var newRf = target.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding);

            if (newRf == null)
            {
                tracingService.Trace(
                    "New Requirement Funding is null; nothing to sync.");
                return;
            }

            var oldRequirementId = oldRf != null
                ? GetRequirementIdFromRequirementFunding(service, oldRf.Id)
                : Guid.Empty;
            var newRequirementId = GetRequirementIdFromRequirementFunding(service, newRf.Id);

            if (newRequirementId == Guid.Empty)
            {
                tracingService.Trace(
                    "New Requirement Funding has no Requirement; nothing to sync.");
                return;
            }

            if (oldRequirementId == newRequirementId)
            {
                tracingService.Trace(
                    $"Requirement unchanged ({newRequirementId}); Itemized Details remain valid.");
                return;
            }

            var existing = GetItemizedDetailsForPrioritization(service, prioritizationId);
            tracingService.Trace(
                $"Deleting {existing.Count} stale Itemized Detail(s) on Prioritization {prioritizationId}.");
            foreach (var id in existing)
                service.Delete(EntityNames.ItemizedDetails, id);

            var detailIds = GetRequirementDetails(service, newRequirementId);
            tracingService.Trace(
                $"Found {detailIds.Count} Requirement Detail(s) for new Requirement {newRequirementId}.");

            if (detailIds.Count == 0)
            {
                // No items to itemize against — drop the Prioritization back to Direct
                // so the user can hand-enter funding instead of being stranded in
                // Itemized mode with nothing to roll up from.
                service.Update(new Entity(EntityNames.Prioritization, prioritizationId)
                {
                    [PrioritizationAttributes.FundingMode] =
                        new OptionSetValue(FundingModeValues.Direct)
                });
                tracingService.Trace(
                    "New Requirement has no Requirement Details; set Prioritization to Direct.");
                return;
            }

            var owningBu = service.Retrieve(
                    EntityNames.Prioritization,
                    prioritizationId,
                    new ColumnSet("owningbusinessunit"))
                .GetAttributeValue<EntityReference>("owningbusinessunit");

            service.Update(new Entity(EntityNames.Prioritization, prioritizationId)
            {
                [PrioritizationAttributes.FundingMode] =
                    new OptionSetValue(FundingModeValues.Itemized)
            });

            foreach (var detailId in detailIds)
                CreateItemizedDetail(service, prioritizationId, detailId, owningBu);

            tracingService.Trace(
                $"Set Prioritization to Itemized and created {detailIds.Count} Itemized Detail(s).");
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
        /// Returns the ids of every active, Itemized-mode Prioritization on the
        /// given Requirement. Direct-mode Prioritizations are intentionally
        /// excluded so adding a Requirement Detail never fans an Itemized Detail
        /// onto a manually-funded Prioritization (which would let
        /// <see cref="PrioritizationItemizedRollup"/> zero its funding).
        ///
        /// Matches via the Prio's direct book_requirement lookup (FY27+) OR via
        /// the legacy book_requirementfunding lookup → RF.Requirement, so both
        /// shapes of Prio are found.
        /// </summary>
        private static List<Entity> GetPrioritizationsForRequirement(
            IOrganizationService service, Guid requirementId)
        {
            var direct = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet("owningbusinessunit"),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationAttributes.StateCode,
                            ConditionOperator.Equal,
                            StateCodeValues.Active),
                        new ConditionExpression(
                            PrioritizationAttributes.FundingMode,
                            ConditionOperator.Equal,
                            FundingModeValues.Itemized),
                        new ConditionExpression(
                            PrioritizationAttributes.Requirement,
                            ConditionOperator.Equal,
                            requirementId)
                    }
                }
            };

            var viaRf = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet("owningbusinessunit"),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationAttributes.StateCode,
                            ConditionOperator.Equal,
                            StateCodeValues.Active),
                        new ConditionExpression(
                            PrioritizationAttributes.FundingMode,
                            ConditionOperator.Equal,
                            FundingModeValues.Itemized)
                    }
                }
            };

            var rfLink = viaRf.AddLink(
                EntityNames.RequirementFunding,
                PrioritizationAttributes.RequirementFunding,
                RequirementFundingAttributes.Id);
            rfLink.LinkCriteria.AddCondition(
                RequirementFundingAttributes.Requirement,
                ConditionOperator.Equal,
                requirementId);

            var combined = service.RetrieveMultiple(direct).Entities
                .Concat(service.RetrieveMultiple(viaRf).Entities);

            return combined
                .GroupBy(e => e.Id)
                .Select(g => g.First())
                .ToList();
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

        /// <summary>
        /// Returns true if an Itemized Detail already links this Prioritization to this
        /// Requirement Detail — guards against duplicates.
        /// </summary>
        private static bool ItemizedDetailExists(
            IOrganizationService service, Guid prioritizationId, Guid requirementDetailId)
        {
            var query = new QueryExpression(EntityNames.ItemizedDetails)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            ItemizedDetailsAttributes.Prioritization,
                            ConditionOperator.Equal,
                            prioritizationId),
                        new ConditionExpression(
                            ItemizedDetailsAttributes.RequirementItem,
                            ConditionOperator.Equal,
                            requirementDetailId)
                    }
                }
            };

            return service.RetrieveMultiple(query).Entities.Count > 0;
        }

        /// <summary>
        /// Creates an Itemized Detail carrying only the two lookups (and the parent
        /// Prioritization's owning BU, so state users can see it). Quantity and the
        /// Requested/Validated/Funded amounts are left for the user to populate.
        /// </summary>
        private static void CreateItemizedDetail(
            IOrganizationService service, Guid prioritizationId, Guid requirementDetailId,
            EntityReference owningBu)
        {
            var itemizedDetail = new Entity(EntityNames.ItemizedDetails)
            {
                [ItemizedDetailsAttributes.Prioritization] =
                    new EntityReference(EntityNames.Prioritization, prioritizationId),
                [ItemizedDetailsAttributes.RequirementItem] =
                    new EntityReference(EntityNames.RequirementDetails, requirementDetailId)
            };
            if (owningBu != null)
                itemizedDetail["owningbusinessunit"] = owningBu;

            service.Create(itemizedDetail);
        }
    }
}
