using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// Rolls the Requested / Validated / Funded amounts of a Prioritization's
    /// book_itemizeddetails children up onto the Prioritization itself.
    ///
    /// Targets only the decimal-typed Prioritization fields (book_newrequestedamount,
    /// book_validatedamount, book_newfundedamounttdp); the float-typed twins are being retired.
    ///
    /// Steps handled on book_itemizeddetails (all Post-Operation, Synchronous):
    /// - Create: recalc the parent Prioritization.
    /// - Update: recalc the parent; if the parent lookup changed, recalc the old parent too.
    /// - Delete: recalc the (PreImage) parent.
    ///
    /// When a Prioritization has no remaining Itemized Details the three roll-up fields
    /// are set to zero. Because the plugin only ever runs in response to an Itemized
    /// Detail change, a Prioritization that has never had Itemized Details is never
    /// written to — its funding amounts stay under manual control.
    /// </summary>
    public class PrioritizationItemizedRollup : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var affectedPrioritizations = new HashSet<Guid>();

            switch (context.MessageName)
            {
                case "Create":
                {
                    var target = GetTarget(context);
                    AddIfPresent(affectedPrioritizations,
                        target.GetAttributeValue<EntityReference>(
                            ItemizedDetailsAttributes.Prioritization));
                    break;
                }

                case "Update":
                {
                    var target = GetTarget(context);
                    var preImage = TryGetPreImage(context);

                    // Current parent (target value, falling back to the pre-image).
                    AddIfPresent(affectedPrioritizations,
                        GetEffectiveEntityReference(target, preImage,
                            ItemizedDetailsAttributes.Prioritization));

                    // Previous parent — recalc it too if the record was re-parented.
                    AddIfPresent(affectedPrioritizations,
                        preImage?.GetAttributeValue<EntityReference>(
                            ItemizedDetailsAttributes.Prioritization));
                    break;
                }

                case "Delete":
                {
                    var preImage = GetPreImage(context);
                    AddIfPresent(affectedPrioritizations,
                        preImage.GetAttributeValue<EntityReference>(
                            ItemizedDetailsAttributes.Prioritization));
                    break;
                }

                default:
                    tracingService.Trace($"Message {context.MessageName} not handled.");
                    return;
            }

            foreach (var prioritizationId in affectedPrioritizations)
                RecalculatePrioritization(service, tracingService, prioritizationId);
        }

        private static void AddIfPresent(HashSet<Guid> set, EntityReference reference)
        {
            if (reference != null)
                set.Add(reference.Id);
        }

        /// <summary>
        /// Sums the funding amounts of every active Itemized Detail under the
        /// Prioritization and writes the totals to its decimal funding fields.
        /// With no Itemized Details the totals are zero.
        /// </summary>
        private static void RecalculatePrioritization(
            IOrganizationService service, ITracingService tracingService, Guid prioritizationId)
        {
            var query = new QueryExpression(EntityNames.ItemizedDetails)
            {
                ColumnSet = new ColumnSet(
                    ItemizedDetailsAttributes.RequestedAmount,
                    ItemizedDetailsAttributes.ValidatedAmount,
                    ItemizedDetailsAttributes.FundedAmount),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            ItemizedDetailsAttributes.Prioritization,
                            ConditionOperator.Equal,
                            prioritizationId),
                        new ConditionExpression(
                            ItemizedDetailsAttributes.StateCode,
                            ConditionOperator.Equal,
                            StateCodeValues.Active)
                    }
                }
            };

            var itemizedDetails = service.RetrieveMultiple(query).Entities;

            decimal requested = 0m, validated = 0m, funded = 0m;
            foreach (var record in itemizedDetails)
            {
                requested += record.GetAttributeValue<decimal>(ItemizedDetailsAttributes.RequestedAmount);
                validated += record.GetAttributeValue<decimal>(ItemizedDetailsAttributes.ValidatedAmount);
                funded += record.GetAttributeValue<decimal>(ItemizedDetailsAttributes.FundedAmount);
            }

            tracingService.Trace(
                $"Prioritization {prioritizationId}: {itemizedDetails.Count} Itemized Detail(s) — " +
                $"Requested={requested}, Validated={validated}, Funded={funded}.");

            var update = new Entity(EntityNames.Prioritization, prioritizationId)
            {
                [PrioritizationAttributes.RequestedAmount] = requested,
                [PrioritizationAttributes.ValidatedAmount] = validated,
                [PrioritizationAttributes.FundedAmountTDP] = funded
            };

            service.Update(update);
        }
    }
}
