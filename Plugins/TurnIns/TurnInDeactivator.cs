using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// Handles the "denied" path for a Turn-In: when the BPF or a user flips
    /// book_stateapproved from true → false (denial), the Turn-In should be
    /// deactivated (statecode = Inactive). The user-facing BPF can also call a
    /// Custom API that triggers this same logic — that's a wiring concern, not
    /// a code concern.
    ///
    /// Runs on book_turnin Update, post-op. No financial side effects — denial only
    /// fires when the Turn-In was never processed (idempotency check in
    /// TurnInValidator guarantees no ledgers exist if we reach this point).
    /// </summary>
    public class TurnInDeactivator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Turnin) return;
            if (context.MessageName != "Update") return;
            if (context.Depth > 1) return; // our own deactivation Update fires this step again

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);
            if (preImage == null)
            {
                tracing.Trace("TurnInDeactivator: no pre-image; cannot detect denial transition. Skipping.");
                return;
            }

            // Only act on State Approval flipping true → false. BE Approval transitions
            // don't deactivate on their own.
            bool preStateApproved = preImage.GetAttributeValue<bool?>(TurninAttributes.StateApproved) ?? false;
            bool newStateApproved = target.Contains(TurninAttributes.StateApproved)
                ? target.GetAttributeValue<bool?>(TurninAttributes.StateApproved) ?? preStateApproved
                : preStateApproved;

            if (!(preStateApproved && !newStateApproved && target.Contains(TurninAttributes.StateApproved)))
            {
                tracing.Trace("TurnInDeactivator: no State Approval denial transition; skipping.");
                return;
            }

            // Already inactive? Nothing to do.
            int? stateCode = preImage.GetAttributeValue<OptionSetValue>("statecode")?.Value;
            if (stateCode == StateCodeValues.Inactive)
            {
                tracing.Trace("TurnInDeactivator: Turn-In already inactive; skipping.");
                return;
            }

            tracing.Trace($"TurnInDeactivator: denial detected on Turn-In {context.PrimaryEntityId}; deactivating.");

            // SetStateRequest is the supported API for deactivation, but a direct
            // statecode/statuscode update works for system-defined statuses too.
            var update = new Entity(EntityNames.Turnin, context.PrimaryEntityId);
            update["statecode"] = new OptionSetValue(StateCodeValues.Inactive);
            update["statuscode"] = new OptionSetValue(2); // "Inactive" default — confirm in env

            service.Update(update);

            tracing.Trace("TurnInDeactivator: Turn-In deactivated.");
        }
    }
}
