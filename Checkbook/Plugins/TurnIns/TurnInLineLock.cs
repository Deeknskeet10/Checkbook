using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// Locks a Turn-In's lines once the Turn-In is past draft. Blocks Create / Update /
    /// Delete of book_turninitems, book_turnindetailreduction and book_turninrdfreduction
    /// (and re-parenting one onto or off such a Turn-In) when the parent Turn-In is:
    ///   • inactive — processed (approved) or denied; or
    ///   • carrying an approval (State or BE / RI-CSOR) — e.g. an FY26 RF-only Turn-In
    ///     State-approved and waiting on BE; or
    ///   • already backed by ledger entries.
    ///
    /// Why: the money moved at approval (ledgers, distributions, junction reductions) is not
    /// recomputed from the lines, so editing or deleting a completed Turn-In's lines does NOT
    /// undo it — it only leaves the record disagreeing with what happened. Reversals need a
    /// new Turn-In / realignment instead. Applies to every fiscal year.
    ///
    /// Allowed: the cascade when a whole Turn-In is deleted (ParentContext = Delete of
    /// book_turnin — e.g. Generate Distributions removing a spent Sweep tracker). There is no
    /// role bypass: plugins already run as the sysadmin super user, so a role check would
    /// only ever exempt people.
    ///
    /// Pre-Operation Sync on Create / Update / Delete of the three tables; Update and Delete
    /// need a PreImage with book_turnin. No filtering attributes (any edit is blocked).
    /// </summary>
    public class TurnInLineLock : PluginBase
    {
        private static readonly HashSet<string> Tables = new HashSet<string>
        {
            EntityNames.TurnInItems,
            TurnInDetailReductionAttributes.EntityLogicalName,
            TurnInRdfReductionAttributes.EntityLogicalName,
        };

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (!Tables.Contains(context.PrimaryEntityName)) return;
            if (context.MessageName != "Create" && context.MessageName != "Update" && context.MessageName != "Delete") return;
            if (IsCascadeFromTurnInDelete(context))
            {
                tracing.Trace("TurnInLineLock: cascade from a Turn-In delete — allowed.");
                return;
            }

            // book_turninitems names its lookup book_turnin too, so one attribute covers all three.
            const string parentAttr = "book_turnin";
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
                // No pre-image registered — read the stored row's parent.
                var stored = service.Retrieve(context.PrimaryEntityName, context.PrimaryEntityId, new ColumnSet(parentAttr));
                var p = stored.GetAttributeValue<EntityReference>(parentAttr);
                if (p != null) parents.Add(p.Id);
            }

            foreach (var turnInId in parents)
            {
                var reason = LockReason(service, turnInId);
                if (reason == null) continue;
                tracing.Trace($"TurnInLineLock: {context.MessageName} of {context.PrimaryEntityName} blocked — {reason}.");
                throw new InvalidPluginExecutionException(
                    $"This Turn-In {reason}, so its lines can no longer be added, changed or deleted. " +
                    "Changing the lines would not reverse the funds already moved. To correct a completed " +
                    "Turn-In, submit a new Turn-In or realignment.");
            }
        }

        private static string LockReason(IOrganizationService service, Guid turnInId)
        {
            var t = service.Retrieve(EntityNames.Turnin, turnInId, new ColumnSet(
                TurninAttributes.StateCode, TurninAttributes.StateApproved, TurninAttributes.BEApproved));
            if (t.GetAttributeValue<OptionSetValue>(TurninAttributes.StateCode)?.Value == StateCodeValues.Inactive)
                return "has been completed or denied";
            if (t.GetAttributeValue<bool>(TurninAttributes.StateApproved) || t.GetAttributeValue<bool>(TurninAttributes.BEApproved))
                return "has been approved";
            if (LedgerIdempotency.HasExistingLedger(service, LedgerAttributes.TurnIn, turnInId))
                return "has already been processed";
            return null;
        }

        private static bool IsCascadeFromTurnInDelete(IPluginExecutionContext context)
        {
            var ancestor = context.ParentContext;
            while (ancestor != null)
            {
                if (ancestor.MessageName == "Delete" && ancestor.PrimaryEntityName == EntityNames.Turnin)
                    return true;
                ancestor = ancestor.ParentContext;
            }
            return false;
        }
    }
}
