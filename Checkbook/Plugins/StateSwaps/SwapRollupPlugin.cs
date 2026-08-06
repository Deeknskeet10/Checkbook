using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Post-operation plugin on book_swapitem Create / Update / Delete.
    /// Rolls up active items onto the parent book_stateswap:
    ///   - book_totalsentbya   = Σ items where debitState == parent.StateA
    ///   - book_totalsentbyb   = Σ items where debitState == parent.StateB
    ///   - book_isbalanced     = "ready to approve" — at least one side sends
    ///                           something (totalA > 0 || totalB > 0) AND every
    ///                           active item has both Debit and Credit Prio
    ///                           populated. The name is legacy; the semantic is
    ///                           readiness — the equal-totals rule and the
    ///                           both-sides-contribute rule were both retired
    ///                           (one-sided transfers are allowed).
    ///
    /// Recomputes both the current parent and (on Update) the previous parent if
    /// the item was re-parented.
    ///
    /// Register PreImage 'PreImage' for Update + Delete so the previous
    /// StateSwap lookup is available.
    /// </summary>
    public class SwapRollupPlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            var affected = new HashSet<Guid>();

            switch (context.MessageName)
            {
                case "Create":
                {
                    var target = GetTarget(context);
                    AddIfPresent(affected,
                        target.GetAttributeValue<EntityReference>(SwapItemAttributes.StateSwap));
                    break;
                }

                case "Update":
                {
                    var target = GetTarget(context);
                    var preImage = TryGetPreImage(context);

                    AddIfPresent(affected,
                        GetEffectiveEntityReference(target, preImage, SwapItemAttributes.StateSwap));

                    AddIfPresent(affected,
                        preImage?.GetAttributeValue<EntityReference>(SwapItemAttributes.StateSwap));
                    break;
                }

                case "Delete":
                {
                    var preImage = GetPreImage(context);
                    AddIfPresent(affected,
                        preImage.GetAttributeValue<EntityReference>(SwapItemAttributes.StateSwap));
                    break;
                }

                default:
                    tracing.Trace($"SwapRollupPlugin: message {context.MessageName} not handled.");
                    return;
            }

            foreach (var swapId in affected)
                RecalculateSwap(service, tracing, swapId);
        }

        private static void AddIfPresent(HashSet<Guid> set, EntityReference reference)
        {
            if (reference != null)
                set.Add(reference.Id);
        }

        private static void RecalculateSwap(
            IOrganizationService service, ITracingService tracing, Guid swapId)
        {
            var swap = service.Retrieve(
                EntityNames.StateSwap,
                swapId,
                new ColumnSet(StateSwapAttributes.StateA, StateSwapAttributes.StateB));

            var stateA = swap.GetAttributeValue<EntityReference>(StateSwapAttributes.StateA);
            var stateB = swap.GetAttributeValue<EntityReference>(StateSwapAttributes.StateB);

            decimal totalA = 0m;
            decimal totalB = 0m;

            if (stateA != null)
                totalA = SumActiveItemsForDebitState(service, swapId, stateA.Id);
            if (stateB != null)
                totalB = SumActiveItemsForDebitState(service, swapId, stateB.Id);

            int unpairedItems = CountItemsMissingCreditPrio(service, swapId);
            var isBalanced = (totalA > 0m || totalB > 0m) && unpairedItems == 0;

            tracing.Trace(
                $"SwapRollupPlugin: swap {swapId} totals A={totalA}, B={totalB}, " +
                $"unpaired={unpairedItems}, readyToApprove={isBalanced}.");

            var update = new Entity(EntityNames.StateSwap, swapId)
            {
                [StateSwapAttributes.TotalSentByA] = totalA,
                [StateSwapAttributes.TotalSentByB] = totalB,
                [StateSwapAttributes.IsBalanced]   = isBalanced,
            };
            service.Update(update);
        }

        private static int CountItemsMissingCreditPrio(
            IOrganizationService service, Guid swapId)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.SwapItem}'>
                        <attribute name='{SwapItemAttributes.Id}' alias='n' aggregate='count'/>
                        <filter type='and'>
                            <condition attribute='{SwapItemAttributes.StateSwap}' operator='eq' value='{swapId}'/>
                            <condition attribute='{SwapItemAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                            <condition attribute='{SwapItemAttributes.CreditPrioritization}' operator='null'/>
                        </filter>
                    </entity>
                </fetch>";
            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            if (rows.Count == 0) return 0;
            var raw = rows[0].GetAttributeValue<AliasedValue>("n")?.Value;
            return raw is int i ? i : 0;
        }

        private static decimal SumActiveItemsForDebitState(
            IOrganizationService service,
            Guid swapId,
            Guid debitStateId)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.SwapItem}'>
                        <attribute name='{SwapItemAttributes.Amount}' alias='total' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{SwapItemAttributes.StateSwap}' operator='eq' value='{swapId}'/>
                            <condition attribute='{SwapItemAttributes.DebitState}' operator='eq' value='{debitStateId}'/>
                            <condition attribute='{SwapItemAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                        </filter>
                    </entity>
                </fetch>";

            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            if (rows.Count == 0) return 0m;
            var raw = rows[0].GetAttributeValue<AliasedValue>("total")?.Value;
            return NumericHelper.ToDecimal(raw, 0m);
        }
    }
}
