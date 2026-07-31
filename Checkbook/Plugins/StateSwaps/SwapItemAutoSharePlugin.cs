using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.StateSwaps.Helpers;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Post-operation plugin on book_swapitem Create. Shares the newly created
    /// swap item with the State Approver + State Administrator owner-teams of BOTH
    /// StateA and StateB (read from the parent book_stateswap), so each state can
    /// see the items the other side adds.
    ///
    /// Why this exists: the parent book_stateswap → book_swapitem 1:N is configured
    /// Share = Cascade All, but that cascade is point-in-time — it only shares the
    /// child rows that exist at the instant the parent is shared (by
    /// <see cref="SwapAutoSharePlugin"/> on parent Create / state-change). Swap items
    /// added LATER to an already-shared swap — e.g. the crediting state filling in
    /// its leg after the debiting state drafted the swap — are not retroactively
    /// covered by the parent's earlier share, so without this step the counterparty
    /// state cannot see them under User-scope Read. Sharing each item at its own
    /// creation closes that gap.
    ///
    /// Runs as the calling user, so the swap drafter's role must grant Share on
    /// book_swapitem (User scope is sufficient — they own the item they just
    /// created). Missing owner-teams are logged and skipped by the helper.
    /// </summary>
    public class SwapItemAutoSharePlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.SwapItem) return;
            if (context.MessageName != "Create") return;

            var target = GetTarget(context);

            var swapRef = target.GetAttributeValue<EntityReference>(SwapItemAttributes.StateSwap);
            if (swapRef == null)
            {
                // Lookup may not be on the Target payload — fall back to a retrieve.
                var item = service.Retrieve(
                    EntityNames.SwapItem, context.PrimaryEntityId,
                    new ColumnSet(SwapItemAttributes.StateSwap));
                swapRef = item.GetAttributeValue<EntityReference>(SwapItemAttributes.StateSwap);
            }

            if (swapRef == null)
            {
                tracing.Trace(
                    "SwapItemAutoSharePlugin: item has no parent swap — nothing to share.");
                return;
            }

            var swap = service.Retrieve(
                EntityNames.StateSwap, swapRef.Id,
                new ColumnSet(StateSwapAttributes.StateA, StateSwapAttributes.StateB));

            var stateA = swap.GetAttributeValue<EntityReference>(StateSwapAttributes.StateA);
            var stateB = swap.GetAttributeValue<EntityReference>(StateSwapAttributes.StateB);

            var itemRef = new EntityReference(EntityNames.SwapItem, context.PrimaryEntityId);

            SwapTeamShareHelper.GrantAccessForState(service, tracing, itemRef, stateA);
            SwapTeamShareHelper.GrantAccessForState(service, tracing, itemRef, stateB);
        }
    }
}
