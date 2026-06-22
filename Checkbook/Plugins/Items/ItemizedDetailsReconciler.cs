using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// Custom API handler for <c>book_ReconcileItemizedDetails</c>. Backfills any
    /// Itemized Details that the Prioritization is missing relative to its current
    /// Requirement's Requirement Details — useful when a user toggles a
    /// Prioritization between Direct and Itemized mid‑year and the regular
    /// fan‑out (which deliberately skips Direct Prios) never reached it.
    ///
    /// The action is idempotent: it only ever creates missing rows, never deletes
    /// or modifies existing ones, and never flips <c>book_fundingmode</c>. A Prio
    /// that isn't currently Itemized returns a friendly no‑op message rather than
    /// being auto‑converted, so historical Direct funding on prior FYs is safe.
    ///
    /// Input parameters:
    ///   <c>PrioritizationId</c> (Guid, required) — the Prioritization to reconcile.
    ///
    /// Output parameters:
    ///   <c>AddedCount</c> (int)    — Itemized Details created (0 if already in sync).
    ///   <c>Message</c>    (string) — one‑line summary, always populated, suitable
    ///                                for the ribbon button's alert dialog.
    /// </summary>
    public class ItemizedDetailsReconciler : PluginBase
    {
        private const string MessageName = "book_ReconcileItemizedDetails";
        private const string InputPrioritizationId = "PrioritizationId";
        private const string OutputAddedCount = "AddedCount";
        private const string OutputMessage = "Message";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != MessageName)
            {
                tracing.Trace($"Skipping — message {context.MessageName} is not {MessageName}.");
                return;
            }

            if (!context.InputParameters.TryGetValue(InputPrioritizationId, out var raw)
                || !(raw is Guid prioritizationId)
                || prioritizationId == Guid.Empty)
            {
                throw new InvalidPluginExecutionException(
                    $"Input parameter '{InputPrioritizationId}' is required and must be a non-empty Guid.");
            }

            var prioritization = service.Retrieve(
                EntityNames.Prioritization,
                prioritizationId,
                new ColumnSet(
                    PrioritizationAttributes.FundingMode,
                    PrioritizationAttributes.RequirementFunding,
                    "owningbusinessunit"));

            var fundingMode = prioritization
                .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode);
            if (fundingMode == null || fundingMode.Value != FundingModeValues.Itemized)
            {
                WriteOutputs(context, 0,
                    "Prioritization is not in Itemized mode; nothing to reconcile.");
                return;
            }

            var rf = prioritization.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding);
            if (rf == null)
            {
                WriteOutputs(context, 0,
                    "Prioritization has no Requirement Funding; nothing to reconcile.");
                return;
            }

            var requirementId = GetRequirementIdFromRequirementFunding(service, rf.Id);
            if (requirementId == Guid.Empty)
            {
                WriteOutputs(context, 0,
                    "Requirement Funding has no Requirement; nothing to reconcile.");
                return;
            }

            var detailIds = GetActiveRequirementDetails(service, requirementId);
            if (detailIds.Count == 0)
            {
                WriteOutputs(context, 0,
                    "Requirement has no Requirement Details; nothing to reconcile.");
                return;
            }

            var owningBu = prioritization.GetAttributeValue<EntityReference>("owningbusinessunit");

            // Single bulk fetch of every Itemized Detail already on this Prio,
            // then diff against detailIds in memory — was a top=1 RetrieveMultiple
            // per Requirement Detail.
            var existingRdIds = GetExistingItemizedDetailRdIds(service, prioritizationId);

            var added = 0;
            foreach (var detailId in detailIds)
            {
                if (existingRdIds.Contains(detailId))
                    continue;

                CreateItemizedDetail(service, prioritizationId, detailId, owningBu);
                added++;
            }

            var message = added == 0
                ? $"All {detailIds.Count} Requirement Detail(s) already itemized — nothing added."
                : $"Added {added} Itemized Detail(s); {detailIds.Count - added} already present.";
            WriteOutputs(context, added, message);
            tracing.Trace(message);
        }

        private static HashSet<Guid> GetExistingItemizedDetailRdIds(
            IOrganizationService service, Guid prioritizationId)
        {
            var query = new QueryExpression(EntityNames.ItemizedDetails)
            {
                ColumnSet = new ColumnSet(ItemizedDetailsAttributes.RequirementItem),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            ItemizedDetailsAttributes.Prioritization,
                            ConditionOperator.Equal, prioritizationId),
                    },
                },
            };
            var ids = new HashSet<Guid>();
            foreach (var e in service.RetrieveMultiple(query).Entities)
            {
                var rd = e.GetAttributeValue<EntityReference>(ItemizedDetailsAttributes.RequirementItem);
                if (rd != null) ids.Add(rd.Id);
            }
            return ids;
        }

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

        private static List<Guid> GetActiveRequirementDetails(
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

            var ids = new List<Guid>();
            foreach (var e in service.RetrieveMultiple(query).Entities)
                ids.Add(e.Id);
            return ids;
        }

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

        private static void WriteOutputs(IPluginExecutionContext context, int added, string message)
        {
            context.OutputParameters[OutputAddedCount] = added;
            context.OutputParameters[OutputMessage] = message;
        }
    }
}
