using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Realignments
{
    /// <summary>
    /// Post-operation plugin on book_realignmentitem Create / Update / Delete (FY27).
    /// Rolls active items up onto the parent book_realignments:
    ///   • book_totalamount    = Σ active item book_newamount
    ///   • book_itemcount      = count of active items
    ///   • book_allsamefundsag = itemcount > 0 AND every active item has
    ///                           book_samefundandsag = true. Drives the approval
    ///                           shape (all-same → State-approval-only; any cross →
    ///                           +BE) and the validator's prerequisites.
    ///
    /// Recomputes the current parent and (on Update) the previous parent if the
    /// item was re-parented. Mirrors SwapRollupPlugin. See
    /// docs/Realignment-FY27-Redesign.md.
    ///
    /// Register PreImage 'PreImage' for Update + Delete so the previous
    /// book_realignment lookup is available.
    /// </summary>
    public class RealignmentRollup : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != RealignmentItemAttributes.EntityLogicalName)
                return;

            var affected = new HashSet<Guid>();

            switch (context.MessageName)
            {
                case "Create":
                {
                    var target = GetTarget(context);
                    AddIfPresent(affected,
                        target.GetAttributeValue<EntityReference>(RealignmentItemAttributes.Realignment));
                    break;
                }
                case "Update":
                {
                    var target = GetTarget(context);
                    var preImage = TryGetPreImage(context);
                    AddIfPresent(affected,
                        GetEffectiveEntityReference(target, preImage, RealignmentItemAttributes.Realignment));
                    AddIfPresent(affected,
                        preImage?.GetAttributeValue<EntityReference>(RealignmentItemAttributes.Realignment));
                    break;
                }
                case "Delete":
                {
                    var preImage = GetPreImage(context);
                    AddIfPresent(affected,
                        preImage.GetAttributeValue<EntityReference>(RealignmentItemAttributes.Realignment));
                    break;
                }
                default:
                    tracing.Trace($"RealignmentRollup: message {context.MessageName} not handled.");
                    return;
            }

            foreach (var realignmentId in affected)
                Recalculate(service, tracing, realignmentId);
        }

        private static void AddIfPresent(HashSet<Guid> set, EntityReference reference)
        {
            if (reference != null)
                set.Add(reference.Id);
        }

        private static void Recalculate(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            decimal total = 0m;
            int count = 0;
            int sameCount = 0;

            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{RealignmentItemAttributes.EntityLogicalName}'>
                        <attribute name='{RealignmentItemAttributes.Amount}' alias='total' aggregate='sum'/>
                        <attribute name='{RealignmentItemAttributes.Id}' alias='cnt' aggregate='count'/>
                        <filter type='and'>
                            <condition attribute='{RealignmentItemAttributes.Realignment}' operator='eq' value='{realignmentId}'/>
                            <condition attribute='{RealignmentItemAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                        </filter>
                    </entity>
                </fetch>";
            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            if (rows.Count > 0)
            {
                total = NumericHelper.ToDecimal(rows[0].GetAttributeValue<AliasedValue>("total")?.Value, 0m);
                var rawCnt = rows[0].GetAttributeValue<AliasedValue>("cnt")?.Value;
                count = rawCnt is int i ? i : 0;
            }

            if (count > 0)
            {
                var sameFetch = $@"
                    <fetch aggregate='true'>
                        <entity name='{RealignmentItemAttributes.EntityLogicalName}'>
                            <attribute name='{RealignmentItemAttributes.Id}' alias='cnt' aggregate='count'/>
                            <filter type='and'>
                                <condition attribute='{RealignmentItemAttributes.Realignment}' operator='eq' value='{realignmentId}'/>
                                <condition attribute='{RealignmentItemAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                                <condition attribute='{RealignmentItemAttributes.SameFundandSAG}' operator='eq' value='1'/>
                            </filter>
                        </entity>
                    </fetch>";
                var sameRows = service.RetrieveMultiple(new FetchExpression(sameFetch)).Entities;
                if (sameRows.Count > 0)
                {
                    var rawSame = sameRows[0].GetAttributeValue<AliasedValue>("cnt")?.Value;
                    sameCount = rawSame is int i ? i : 0;
                }
            }

            bool allSame = count > 0 && sameCount == count;

            tracing.Trace(
                $"RealignmentRollup: realignment {realignmentId} total={total}, items={count}, " +
                $"sameFundSag={sameCount}, allSame={allSame}.");

            var update = new Entity(EntityNames.Realignments, realignmentId)
            {
                [RealignmentsAttributes.TotalAmount] = total,
                [RealignmentsAttributes.ItemCount] = count,
                [RealignmentsAttributes.AllSameFundSAG] = allSame,
            };
            service.Update(update);
        }
    }
}
