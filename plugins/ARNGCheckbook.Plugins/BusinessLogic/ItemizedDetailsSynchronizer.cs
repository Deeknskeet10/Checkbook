using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using ARNGCheckbook.Plugins.Constants;

namespace ARNGCheckbook.Plugins.BusinessLogic
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

            var prioritizationIds = GetPrioritizationsForRequirement(service, requirement.Id);
            tracingService.Trace(
                $"Found {prioritizationIds.Count} Prioritization(s) for Requirement {requirement.Id}.");

            var created = 0;
            foreach (var prioritizationId in prioritizationIds)
            {
                if (ItemizedDetailExists(service, prioritizationId, detailId))
                {
                    tracingService.Trace(
                        $"Itemized Detail already exists for Prioritization {prioritizationId}; skipping.");
                    continue;
                }

                CreateItemizedDetail(service, prioritizationId, detailId);
                created++;
            }

            tracingService.Trace($"Created {created} Itemized Detail(s).");
        }

        /// <summary>
        /// A new Prioritization was created — seed its Itemized Details from the
        /// Requirement Details of the Requirement behind its Requirement Funding.
        /// </summary>
        private void HandlePrioritizationCreated(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var prioritization = GetTarget(context);
            var prioritizationId = context.PrimaryEntityId;

            var requirementFunding = prioritization.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding);
            if (requirementFunding == null)
            {
                tracingService.Trace("Prioritization has no Requirement Funding; nothing to sync.");
                return;
            }

            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                requirementFunding.Id,
                new ColumnSet(RequirementFundingAttributes.Requirement));

            var requirement = rf.GetAttributeValue<EntityReference>(
                RequirementFundingAttributes.Requirement);
            if (requirement == null)
            {
                tracingService.Trace("Requirement Funding has no Requirement; nothing to sync.");
                return;
            }

            var detailIds = GetRequirementDetails(service, requirement.Id);
            tracingService.Trace(
                $"Found {detailIds.Count} Requirement Detail(s) for Requirement {requirement.Id}.");

            foreach (var detailId in detailIds)
                CreateItemizedDetail(service, prioritizationId, detailId);

            tracingService.Trace(
                $"Created {detailIds.Count} Itemized Detail(s) for new Prioritization.");
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
        /// Returns the ids of every active Prioritization whose Requirement Funding
        /// points at the given Requirement.
        /// </summary>
        private static List<Guid> GetPrioritizationsForRequirement(
            IOrganizationService service, Guid requirementId)
        {
            var query = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet(false),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationAttributes.StateCode,
                            ConditionOperator.Equal,
                            StateCodeValues.Active)
                    }
                }
            };

            var rfLink = query.AddLink(
                EntityNames.RequirementFunding,
                PrioritizationAttributes.RequirementFunding, // book_requirementfunding on prioritization
                RequirementFundingAttributes.Id);            // book_requirementfundingid
            rfLink.LinkCriteria.AddCondition(
                RequirementFundingAttributes.Requirement,
                ConditionOperator.Equal,
                requirementId);

            return service.RetrieveMultiple(query).Entities
                .Select(e => e.Id)
                .Distinct()
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
        /// Creates an Itemized Detail carrying only the two lookups. Quantity and the
        /// Requested/Validated/Funded amounts are left for the user to populate.
        /// </summary>
        private static void CreateItemizedDetail(
            IOrganizationService service, Guid prioritizationId, Guid requirementDetailId)
        {
            var itemizedDetail = new Entity(EntityNames.ItemizedDetails)
            {
                [ItemizedDetailsAttributes.Prioritization] =
                    new EntityReference(EntityNames.Prioritization, prioritizationId),
                [ItemizedDetailsAttributes.RequirementItem] =
                    new EntityReference(EntityNames.RequirementDetails, requirementDetailId)
            };

            service.Create(itemizedDetail);
        }
    }
}
