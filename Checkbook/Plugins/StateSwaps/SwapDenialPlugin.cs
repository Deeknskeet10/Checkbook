using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Pre-operation plugin on book_stateswap Update that handles the denial
    /// lifecycle. Three cases, evaluated on the same Update:
    ///
    /// A. Denial transition (book_denied false → true):
    ///    Reset both state approvals and BE approval so the drafter can revise.
    ///    Approver-by / approver-on lookups on the reset flags are cleared too.
    ///    book_denialreason is left as history until the swap is re-approved.
    ///
    /// B. "Next save" after a denial (preImage.book_denied = true, current
    ///    Update does not itself flip book_denied):
    ///    Clear book_denied so the swap is no longer in the denied state. The
    ///    reason text stays for context; case C clears it when someone approves.
    ///
    /// C. State approval after a prior denial (either state approval flag
    ///    false → true AND preImage.book_denialreason had a value):
    ///    Clear book_denialreason — the swap has been resubmitted and someone
    ///    is approving again, so the historical reason is no longer relevant.
    ///
    /// Only user-initiated updates drive this lifecycle — detected by the
    /// absence of a non-wrapper ancestor context (bulk wrappers like
    /// ExecuteMultiple / Excel Online walk through). Nested updates from
    /// SwapRollupPlugin (post-op on item change) or from the orchestrator
    /// (SwapApprovalPlugin's self-deactivate) carry an ancestor pipeline and
    /// must not clear book_denied on the drafter's behalf.
    ///
    /// Register PreImage 'PreImage' with the approval / denial fields so
    /// transitions are detectable.
    /// </summary>
    public class SwapDenialPlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.StateSwap) return;
            if (context.MessageName != "Update") return;

            // User-initiated updates only — nested updates from SwapRollupPlugin
            // (post-op on item change) or the orchestrator's self-deactivate
            // must not clear book_denied on the drafter's behalf. Wrapper-aware
            // rather than Depth-based so bulk denials via Excel Online /
            // ExecuteMultiple (which arrive nested in a wrapper) still work.
            if (HasNonWrapperAncestor(context))
            {
                tracing.Trace("SwapDenialPlugin: automated ancestor context; skipping (not a user-initiated update).");
                return;
            }

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            bool deniedTx = ApprovalTransitionDetector.DetectBoolTransition(
                target, preImage, StateSwapAttributes.Denied);
            bool stateATx = ApprovalTransitionDetector.DetectBoolTransition(
                target, preImage, StateSwapAttributes.StateAApproved);
            bool stateBTx = ApprovalTransitionDetector.DetectBoolTransition(
                target, preImage, StateSwapAttributes.StateBApproved);

            // ---- A. Denial transition — reset approvals ----
            if (deniedTx)
            {
                tracing.Trace("SwapDenialPlugin: denial transition — resetting all approvals.");
                target[StateSwapAttributes.StateAApproved] = false;
                target[StateSwapAttributes.StateAApprovedBy] = null;
                target[StateSwapAttributes.StateAApprovedOn] = null;
                target[StateSwapAttributes.StateBApproved] = false;
                target[StateSwapAttributes.StateBApprovedBy] = null;
                target[StateSwapAttributes.StateBApprovedOn] = null;
                target[StateSwapAttributes.BEApproved] = false;
                target[StateSwapAttributes.BEApprovedBy] = null;
                target[StateSwapAttributes.BEApprovedOn] = null;
                return;
            }

            // ---- B. Next save after denial — clear the flag ----
            bool preDenied = preImage?.GetAttributeValue<bool?>(StateSwapAttributes.Denied) ?? false;
            if (preDenied && !target.Contains(StateSwapAttributes.Denied))
            {
                tracing.Trace("SwapDenialPlugin: preImage.denied=true and no denial change this save — clearing denied flag.");
                target[StateSwapAttributes.Denied] = false;
            }

            // ---- C. Resubmission approval — clear the denial reason ----
            if (stateATx || stateBTx)
            {
                var preReason = preImage?.GetAttributeValue<string>(StateSwapAttributes.DenialReason);
                if (!string.IsNullOrWhiteSpace(preReason) &&
                    !target.Contains(StateSwapAttributes.DenialReason))
                {
                    tracing.Trace("SwapDenialPlugin: state approval after prior denial — clearing denial reason.");
                    target[StateSwapAttributes.DenialReason] = null;
                }
            }
        }
    }
}
