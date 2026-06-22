using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    public class RealignmentValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Realignments)
                return;

            if (context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            var sameFundSAG = GetEffectiveBool(target, preImage, RealignmentsAttributes.SameFundandSAG);

            // State Approved is an OptionSetValue; read the effective post-update
            // value to decide whether Case 2 already passed State Approval.
            int? statePre = preImage?.GetAttributeValue<OptionSetValue>(
                RealignmentsAttributes.StateApproved)?.Value;
            int? statePost = target.Contains(RealignmentsAttributes.StateApproved)
                ? target.GetAttributeValue<OptionSetValue>(RealignmentsAttributes.StateApproved)?.Value
                : statePre;
            bool isStateApproved = statePost == RealignmentBEDecisionValues.Approved;

            var beDecision = GetEffectiveOptionSetValue(target, preImage, RealignmentsAttributes.BEDecision);
            var beDecisionValue = beDecision?.Value;

            // Retrieve prioritizations
            var debitPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedPrioritization);
            var creditPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedPrioritization);

            tracing.Trace(
                $"Validator: SameFundSAG={sameFundSAG}, " +
                $"IsStateApproved={isStateApproved}, " +
                $"BEDecisionSet={beDecisionValue != null}, " +
                $"DebitPrior={debitPrior != null}, CreditPrior={creditPrior != null}");

            /* ============================================================
               Two‑Approval Trigger Logic (State + BE Decision)
               ============================================================ */

            bool stateApprovalChangedToApproved = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Approved);
            bool beDecisionChangedToApproved = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Approved);

            // 2. If NEITHER approval changed, skip validation entirely
            
            if (!stateApprovalChangedToApproved && !beDecisionChangedToApproved)
            {
                tracing.Trace("No approval changes detected — skipping RealignmentValidator.");
                return;
            }
            // If State approves a non-Same SAG/Fund realignment; continue forward until BE Decision
            if (stateApprovalChangedToApproved && !beDecisionChangedToApproved && !sameFundSAG)
            {
                tracing.Trace("State Approved - Not same SAG or Fund - requires BE Approval.");
                return;
            }

            // -------------------------------------------------------------
            // Case 1: RF-level realignment (NO prioritizations)
            // State Approval NOT required
            // BE Decision IS required
            // -------------------------------------------------------------
            if (debitPrior == null && creditPrior == null)
            {
                tracing.Trace("Validator: RF-level realignment detected.");

                if (beDecisionValue == null)
                {
                    throw new InvalidPluginExecutionException(
                        "This RF-level realignment requires a BE Decision before it can be executed.");
                }

                tracing.Trace("Validator: RF-level BE-approved realignment; approved.");
                return;
            }

            // -------------------------------------------------------------
            // Case 2: Prioritization-to-Prioritization realignment
            // State Approval ALWAYS required
            // -------------------------------------------------------------
            if (!isStateApproved)
            {
                throw new InvalidPluginExecutionException(
                    "This realignment requires State Approval before it can be executed.");
            }

            // -------------------------------------------------------------
            // Case 3: BE Decision required only when SameFund/SAG = NO
            // -------------------------------------------------------------
            if (!sameFundSAG && beDecisionValue == null)
            {
                throw new InvalidPluginExecutionException(
                    "This realignment requires a BE Decision because Fund or SAG changes.");
            }

            tracing.Trace("Validator: Prioritization-based realignment fully approved.");
        }
    }
}
