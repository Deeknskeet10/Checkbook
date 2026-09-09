using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-operation gate on book_realignments Update. Fires when an approval or
    /// denial choice value is written to book_newstateapproved / book_bedecision.
    ///
    /// Enforces, in order:
    ///   1. Role gating (the "control" this validator gained when the BPF was
    ///      retired) — a State stage action (approve or deny book_newstateapproved)
    ///      requires State Approver / State Administrator / Checkbook Administrator,
    ///      scoped to the DEBITING state's business unit (unless Checkbook Admin);
    ///      a BE stage action (approve or deny book_bedecision) requires Budget
    ///      Executor / Checkbook Administrator. Modeled on
    ///      <see cref="Checkbook.Plugins.StateSwaps.SwapValidator"/>.EnforceApprovalRoles.
    ///   2. Shape-based prerequisites (unchanged Case 1/2/3) — the right approval
    ///      must be present for the realignment's shape (RF-level vs Prio-to-Prio,
    ///      Same Fund/SAG vs Cross Fund/SAG).
    ///
    /// After the checks pass, stamps the audit fields for each approval that
    /// transitions to Approved this Update (book_newstateapprovedby/on,
    /// book_bedecisionby/on = initiating user + UtcNow). Transition-based so a
    /// re-save that re-drives a stuck approval keeps the original stamp. Denials
    /// carry their reason in book_denialreason (written by the approval PCF); this
    /// validator does not require one.
    ///
    /// Role/scope + stamps are the State-Swap parity work; the money movement and
    /// deactivation still live in RealignmentProcessor (post-op).
    /// </summary>
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

            // ---- Transition detection (approvals and denials, both fields) ----
            bool stateApprovedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Approved);
            bool stateDeniedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Denied);
            bool beApprovedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Approved);
            bool beDeniedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Denied);

            // If no approval/denial transition is in the payload, this is an
            // ordinary edit/save — nothing for the gate to do.
            if (!stateApprovedTx && !stateDeniedTx && !beApprovedTx && !beDeniedTx)
            {
                tracing.Trace("No approval/denial transition detected — skipping RealignmentValidator.");
                return;
            }

            // ---- 1. Role gating ----
            EnforceApprovalRoles(
                service, tracing, context.UserId,
                stateApprovedTx || stateDeniedTx,
                beApprovedTx || beDeniedTx,
                context.PrimaryEntityId);

            // Denials are allowed regardless of shape prerequisites — a denied
            // realignment can be in any state. RealignmentProcessor deactivates it.
            if (stateDeniedTx || beDeniedTx)
            {
                tracing.Trace("Denial transition — role gate passed; skipping shape prerequisite checks.");
                return;
            }

            // ---- 2. Shape-based prerequisites (unchanged Case 1/2/3) ----
            var sameFundSAG = GetEffectiveBool(target, preImage, RealignmentsAttributes.SameFundandSAG);

            int? statePre = preImage?.GetAttributeValue<OptionSetValue>(
                RealignmentsAttributes.StateApproved)?.Value;
            int? statePost = target.Contains(RealignmentsAttributes.StateApproved)
                ? target.GetAttributeValue<OptionSetValue>(RealignmentsAttributes.StateApproved)?.Value
                : statePre;
            bool isStateApproved = statePost == RealignmentBEDecisionValues.Approved;

            var beDecision = GetEffectiveOptionSetValue(target, preImage, RealignmentsAttributes.BEDecision);
            var beDecisionValue = beDecision?.Value;

            var debitPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedPrioritization);
            var creditPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedPrioritization);

            tracing.Trace(
                $"Validator: SameFundSAG={sameFundSAG}, IsStateApproved={isStateApproved}, " +
                $"BEDecisionSet={beDecisionValue != null}, DebitPrior={debitPrior != null}, " +
                $"CreditPrior={creditPrior != null}");

            // If State approves a non-Same SAG/Fund realignment; continue forward
            // until BE Decision (State approval alone cannot finalize it).
            if (stateApprovedTx && !beApprovedTx && !sameFundSAG)
            {
                tracing.Trace("State Approved - Not same SAG or Fund - requires BE Approval.");
                // fall through to the stamp; no prerequisite is violated.
            }
            else
            {
                // Case 1: RF-level realignment (NO prioritizations) — State Approval
                // NOT required; BE Decision IS required.
                if (debitPrior == null && creditPrior == null)
                {
                    tracing.Trace("Validator: RF-level realignment detected.");
                    if (beDecisionValue == null)
                    {
                        throw new InvalidPluginExecutionException(
                            "This RF-level realignment requires a BE Decision before it can be executed.");
                    }
                    tracing.Trace("Validator: RF-level BE-approved realignment; approved.");
                }
                else
                {
                    // Case 2: Prioritization-to-Prioritization — State Approval ALWAYS required.
                    if (!isStateApproved)
                    {
                        throw new InvalidPluginExecutionException(
                            "This realignment requires State Approval before it can be executed.");
                    }

                    // Case 3: BE Decision required only when SameFund/SAG = NO.
                    if (!sameFundSAG && beDecisionValue == null)
                    {
                        throw new InvalidPluginExecutionException(
                            "This realignment requires a BE Decision because Fund or SAG changes.");
                    }

                    tracing.Trace("Validator: Prioritization-based realignment fully approved.");
                }
            }

            // ---- Stamp Approved By / On (pre-op target mutation) ----
            // Transition-based so a re-save that re-drives a stuck approval keeps
            // the original stamp; the stamp and the choice value commit together.
            if (stateApprovedTx)
                StampApproval(context, target, tracing,
                    RealignmentsAttributes.StateApprovedBy, RealignmentsAttributes.StateApprovedOn);
            if (beApprovedTx)
                StampApproval(context, target, tracing,
                    RealignmentsAttributes.BEDecisionBy, RealignmentsAttributes.BEDecisionOn);
        }

        private static void StampApproval(
            IPluginExecutionContext context,
            Entity target,
            ITracingService tracing,
            string byAttribute,
            string onAttribute)
        {
            target[byAttribute] = new EntityReference(EntityNames.SystemUser, context.InitiatingUserId);
            target[onAttribute] = DateTime.UtcNow;
            tracing.Trace(
                $"RealignmentValidator: stamped {byAttribute}/{onAttribute} for user {context.InitiatingUserId}.");
        }

        /// <summary>
        /// Stage-ownership role gate. A State stage action (approve or deny
        /// book_newstateapproved) requires a State role scoped to the debiting
        /// state's BU; a BE stage action (approve or deny book_bedecision)
        /// requires the Budget Executor role. Checkbook Administrators bypass both
        /// the role and the BU scope.
        /// </summary>
        private static void EnforceApprovalRoles(
            IOrganizationService service,
            ITracingService tracing,
            Guid userId,
            bool stateStageAction,
            bool beStageAction,
            Guid realignmentId)
        {
            bool isCheckbookAdmin = UserRoleHelper.HasAnyRole(
                service, tracing, userId, RoleNames.CheckbookAdministrator);

            if (stateStageAction)
            {
                bool hasStateRole = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.StateApprover, RoleNames.StateAdministrator);
                if (!hasStateRole && !isCheckbookAdmin)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the State Approver, State Administrator, or Checkbook " +
                        "Administrator roles may act on the State Approval of a Realignment.");
                }

                if (!isCheckbookAdmin)
                {
                    var debitState = ResolveDebitingState(service, tracing, realignmentId);
                    if (debitState != null &&
                        !StateScopeHelper.IsUserInStateBU(service, tracing, userId, debitState))
                    {
                        throw new InvalidPluginExecutionException(
                            "You cannot act on the State Approval of this Realignment — your account " +
                            "does not belong to the debiting state's business unit.");
                    }
                    if (debitState == null)
                    {
                        // No debiting Prioritization to scope by (RF-level or
                        // unset). State approval is anomalous on that shape; the
                        // role check above still applies, BU scope is skipped.
                        tracing.Trace(
                            "RealignmentValidator: no debiting state resolved; BU scope skipped for State stage.");
                    }
                }
            }

            if (beStageAction)
            {
                bool allowed = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.BudgetExecutor, RoleNames.CheckbookAdministrator);
                if (!allowed)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the Budget Executor or Checkbook Administrator roles " +
                        "may act on the BE Decision of a Realignment.");
                }
            }
        }

        /// <summary>
        /// Resolves the debiting state from the realignment's debit Prioritization
        /// (a direct book_state lookup on book_prioritization — no fund-center
        /// walk needed). Read live from the record, mirroring how SwapValidator
        /// retrieves State A / State B. Returns null when there is no debiting
        /// Prioritization or it has no state.
        /// </summary>
        private static EntityReference ResolveDebitingState(
            IOrganizationService service,
            ITracingService tracing,
            Guid realignmentId)
        {
            try
            {
                var realignment = service.Retrieve(
                    EntityNames.Realignments, realignmentId,
                    new ColumnSet(RealignmentsAttributes.DebitedPrioritization));
                var debitPrior = realignment.GetAttributeValue<EntityReference>(
                    RealignmentsAttributes.DebitedPrioritization);
                if (debitPrior == null) return null;

                var prio = service.Retrieve(
                    EntityNames.Prioritization, debitPrior.Id,
                    new ColumnSet(PrioritizationAttributes.State));
                return prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);
            }
            catch (Exception ex)
            {
                tracing.Trace($"RealignmentValidator: could not resolve debiting state: {ex.Message}");
                return null;
            }
        }
    }
}
