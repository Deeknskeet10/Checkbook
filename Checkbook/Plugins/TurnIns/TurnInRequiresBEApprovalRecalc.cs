using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// Keeps book_turnin.book_requiresbeapproval in sync as Turn-In Items change.
    ///
    /// Fires Post-Operation Synchronous on book_turninitems Create / Update / Delete.
    /// Register a PreImage on Update and Delete that includes book_turnin,
    /// book_prioritization, and statecode.
    ///
    /// Rule: a Turn-In requires BE Approval when
    ///   - it has zero active items (AFP-only Turn-In path), OR
    ///   - any active item has no Prioritization (RF-only item).
    /// Otherwise State approval alone is sufficient.
    ///
    /// The flag drives the Turn-In BPF's routing to the BE Approval stage. The
    /// authoritative enforcement still lives in TurnInValidator — this flag only
    /// exists so the UI/BPF can branch before the user hits Approve.
    ///
    /// Cross-entity write only (writes book_turnin, triggered by book_turninitems),
    /// so there is no recursion risk with the other Turn-In steps.
    /// </summary>
    public class TurnInRequiresBEApprovalRecalc : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.TurnInItems) return;

            var affected = new HashSet<Guid>();

            switch (context.MessageName)
            {
                case "Create":
                {
                    var target = GetTarget(context);
                    AddIfPresent(affected,
                        target.GetAttributeValue<EntityReference>(TurnInItemsAttributes.Turnin));
                    break;
                }

                case "Update":
                {
                    var target = GetTarget(context);
                    var preImage = TryGetPreImage(context);

                    AddIfPresent(affected,
                        GetEffectiveEntityReference(target, preImage, TurnInItemsAttributes.Turnin));

                    // Recalc the previous parent as well if the item was re-parented.
                    AddIfPresent(affected,
                        preImage?.GetAttributeValue<EntityReference>(TurnInItemsAttributes.Turnin));
                    break;
                }

                case "Delete":
                {
                    var preImage = GetPreImage(context);
                    AddIfPresent(affected,
                        preImage.GetAttributeValue<EntityReference>(TurnInItemsAttributes.Turnin));
                    break;
                }

                default:
                    tracing.Trace($"Message {context.MessageName} not handled.");
                    return;
            }

            foreach (var turnInId in affected)
                RecalculateFlag(service, tracing, turnInId);
        }

        private static void AddIfPresent(HashSet<Guid> set, EntityReference reference)
        {
            if (reference != null)
                set.Add(reference.Id);
        }

        private static void RecalculateFlag(
            IOrganizationService service, ITracingService tracing, Guid turnInId)
        {
            // Aggregate: total active items and how many carry a Prioritization.
            // countcolumn skips null values, so `withPrio` is exactly the count of
            // items that have a Prio attached.
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.TurnInItems}'>
                        <attribute name='{TurnInItemsAttributes.Id}' alias='total' aggregate='count'/>
                        <attribute name='{TurnInItemsAttributes.Prioritization}' alias='withPrio' aggregate='countcolumn'/>
                        <filter type='and'>
                            <condition attribute='{TurnInItemsAttributes.Turnin}' operator='eq' value='{turnInId}'/>
                            <condition attribute='{TurnInItemsAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                        </filter>
                    </entity>
                </fetch>";

            int total = 0, withPrio = 0;
            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            if (rows.Count > 0)
            {
                total = (int)(rows[0].GetAttributeValue<AliasedValue>("total")?.Value ?? 0);
                withPrio = (int)(rows[0].GetAttributeValue<AliasedValue>("withPrio")?.Value ?? 0);
            }

            bool requires = total == 0 || withPrio < total;

            // Skip the write when the flag already matches — avoids an unnecessary
            // Turn-In Update (and the sync plugins that would early-exit on it).
            var current = service.Retrieve(
                EntityNames.Turnin, turnInId, new ColumnSet(TurninAttributes.RequiresBEApproval));
            bool currentValue = current.GetAttributeValue<bool>(TurninAttributes.RequiresBEApproval);

            tracing.Trace(
                $"Turn-In {turnInId}: total={total}, withPrio={withPrio}, " +
                $"requires={requires}, current={currentValue}.");

            if (requires == currentValue) return;

            var update = new Entity(EntityNames.Turnin, turnInId)
            {
                [TurninAttributes.RequiresBEApproval] = requires
            };
            service.Update(update);
        }
    }
}
