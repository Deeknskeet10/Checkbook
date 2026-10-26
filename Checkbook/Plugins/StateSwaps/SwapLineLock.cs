using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.StateSwaps.Helpers;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Locks an FY27+ State Swap's lines once either state has signed off. Blocks Create /
    /// Update / Delete of book_swapitem, book_swapdetailreduction and book_swapdetailincrease
    /// (and re-parenting one onto or off such a swap) when the parent swap is:
    ///   • inactive — processed (BE approved); or
    ///   • carrying any approval (State A, State B or BE) — one state must not change the
    ///     legs after the other approved them; or
    ///   • already backed by ledger entries.
    /// A denial clears the approvals (SwapDenialPlugin), which re-opens editing.
    /// See docs/StateSwap-FY27-Redesign.md §3 decision 6. Mirrors TurnInLineLock.
    ///
    /// FY27+ only: FY26 swaps keep today's behavior. Allowed: the cascade when a whole swap
    /// is deleted. No role bypass (plugins run as the sysadmin super user).
    ///
    /// Pre-Operation Sync on Create / Update / Delete of the three tables; Update and Delete
    /// should carry a PreImage with book_stateswap (falls back to a Retrieve). No filtering
    /// attributes (any edit is blocked).
    /// </summary>
    public class SwapLineLock : PluginBase
    {
        private static readonly HashSet<string> Tables = new HashSet<string>
        {
            EntityNames.SwapItem,
            SwapDetailReductionAttributes.EntityLogicalName,
            SwapDetailIncreaseAttributes.EntityLogicalName,
        };

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (!Tables.Contains(context.PrimaryEntityName)) return;
            if (context.MessageName != "Create" && context.MessageName != "Update" && context.MessageName != "Delete") return;
            if (IsCascadeFromSwapDelete(context))
            {
                tracing.Trace("SwapLineLock: cascade from a State Swap delete — allowed.");
                return;
            }

            // All three tables name their parent lookup book_stateswap.
            const string parentAttr = SwapItemAttributes.StateSwap;
            var preImage = TryGetPreImage(context);
            var parents = new HashSet<Guid>();

            if (context.MessageName != "Delete")
            {
                var target = GetTarget(context);
                var t = target.Contains(parentAttr)
                    ? target.GetAttributeValue<EntityReference>(parentAttr)
                    : preImage?.GetAttributeValue<EntityReference>(parentAttr);
                if (t != null) parents.Add(t.Id);
            }
            var prev = preImage?.GetAttributeValue<EntityReference>(parentAttr);
            if (prev != null) parents.Add(prev.Id);

            if (parents.Count == 0 && context.MessageName != "Create")
            {
                var stored = service.Retrieve(context.PrimaryEntityName, context.PrimaryEntityId, new ColumnSet(parentAttr));
                var p = stored.GetAttributeValue<EntityReference>(parentAttr);
                if (p != null) parents.Add(p.Id);
            }

            foreach (var swapId in parents)
            {
                var reason = LockReason(service, swapId);
                if (reason == null) continue;
                tracing.Trace($"SwapLineLock: {context.MessageName} of {context.PrimaryEntityName} blocked — {reason}.");
                throw new InvalidPluginExecutionException(
                    $"This State Swap {reason}, so its items and detail adjustments can no longer be added, changed " +
                    "or deleted. To change it, ask an approver to deny it (which re-opens editing), or submit a new swap.");
            }
        }

        private static string LockReason(IOrganizationService service, Guid swapId)
        {
            var s = service.Retrieve(EntityNames.StateSwap, swapId, new ColumnSet(
                StateSwapAttributes.FiscalYear, StateSwapAttributes.StateCode,
                StateSwapAttributes.StateAApproved, StateSwapAttributes.StateBApproved, StateSwapAttributes.BEApproved));
            if (SwapRules.IsLegacy(s)) return null;

            if (s.GetAttributeValue<OptionSetValue>(StateSwapAttributes.StateCode)?.Value == StateCodeValues.Inactive)
                return "has been completed";
            if (s.GetAttributeValue<bool>(StateSwapAttributes.StateAApproved)
                || s.GetAttributeValue<bool>(StateSwapAttributes.StateBApproved)
                || s.GetAttributeValue<bool>(StateSwapAttributes.BEApproved))
                return "has been approved";
            if (LedgerIdempotency.HasExistingLedger(service, LedgerAttributes.StateSwap, swapId))
                return "has already been processed";
            return null;
        }

        private static bool IsCascadeFromSwapDelete(IPluginExecutionContext context)
        {
            var ancestor = context.ParentContext;
            while (ancestor != null)
            {
                if (ancestor.MessageName == "Delete" && ancestor.PrimaryEntityName == EntityNames.StateSwap)
                    return true;
                ancestor = ancestor.ParentContext;
            }
            return false;
        }
    }
}
