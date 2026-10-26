using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.Realignments.Helpers;

namespace Checkbook.Plugins.Realignments
{
    /// <summary>
    /// Post-operation orchestrator for an approved / denied realignment
    /// (book_realignments Update on book_newstateapproved / book_bedecision).
    /// Validation lives in RealignmentValidator (pre-op); this plugin decides
    /// WHETHER to execute, delegates the money movement, and deactivates:
    ///   • item-based (FY27+) realignments → <see cref="RealignmentExecutor"/>
    ///   • legacy (FY26) single-row realignments → <see cref="RealignmentExecutorLegacy"/>
    ///
    /// Shared rules: LOA balances move only through ledger rows; the credit RF
    /// gets a TDP-only increase (RF Funded is owned by the roll-ups); an RF with
    /// child Prioritizations can only give up Withholding.
    ///
    /// Idempotent trigger: fires when the payload carries a decision value and
    /// the record is still active (deactivation marks "processed"), so bulk
    /// saves and re-saves of a stuck approval both work, plus a ledger-existence
    /// barrier. No nesting/Depth guard: server-side field setters nest the
    /// decision save under a book_realignments Update, so an ancestor-walk guard
    /// would silently drop every approval (see note in ExecutePlugin).
    /// </summary>
    public class RealignmentProcessor : PluginBase
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

            // NOTE: Do NOT skip when nested inside another book_realignments
            // Update. Real-time Business Rules on this table (Realignments -
            // SetStateApproval, Realignments - LockSameSAGFundField, Mode=1) set
            // fields server-side, which issues a nested book_realignments
            // Update; the user's decision-bearing save runs *inside* that
            // nesting. An same-table-nesting guard here silently dropped every
            // approval (symptom: "self re-entry — skipping" with nothing else
            // logged and the record never deactivating).
            //
            // No self re-entry guard is needed. FinalizeRealignment writes only
            // statecode/statuscode and this step is filtered on
            // book_newstateapproved/book_bedecision, so Finalize cannot
            // re-trigger the processor. Idempotency is provided by the
            // value-in-payload + record-active checks below; because the
            // decision check reads the Target payload only, the nested
            // business-rule updates (which carry other attributes, not the
            // user's decision write) fall through to "No approval value in
            // payload" without double-processing.

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            decimal amount = GetEffectiveDecimal(target, preImage, RealignmentsAttributes.Amount);

            var debitPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedPrioritization);
            var creditPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedPrioritization);

            var debitRF = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedRequirement);
            var creditRF = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedRequirement);

            var debitLOA = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedLOA);
            var creditLOA = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedLOA);

            bool sameFundSAG = GetEffectiveBool(target, preImage, RealignmentsAttributes.SameFundandSAG);
            bool isPriorPath = debitPrior != null && creditPrior != null;
            bool isRFPath = debitRF != null && creditRF != null;

            // FY27 multi-line: a realignment that carries child book_realignmentitem
            // rows takes its approval shape from the item rollup (all-same-Fund/SAG +
            // entry mode), not the single parent lookups. Legacy FY26 single-row
            // realignments (no items) fall through to the existing path unchanged.
            bool hasItems = RealignmentExecutor.HasActiveItems(service, context.PrimaryEntityId);
            if (hasItems)
            {
                var shape = service.Retrieve(EntityNames.Realignments, context.PrimaryEntityId,
                    new ColumnSet(RealignmentsAttributes.AllSameFundSAG, RealignmentsAttributes.EntryMode));
                sameFundSAG = shape.GetAttributeValue<bool>(RealignmentsAttributes.AllSameFundSAG);
                var entryMode = shape.GetAttributeValue<OptionSetValue>(RealignmentsAttributes.EntryMode)?.Value;
                isPriorPath = entryMode == RealignmentEntryModeValues.State;
                isRFPath = !isPriorPath;
                tracing.Trace(
                    $"RealignmentProcessor: item-based realignment (entryMode={(entryMode?.ToString() ?? "null")}, " +
                    $"allSameFundSAG={sameFundSAG}).");
            }


            // =============================================================
            // APPROVAL & DENIAL DETECTION (Choice-Based, value + active)
            // =============================================================
            // Every processed realignment is deactivated in
            // FinalizeRealignment, so an *active* record whose payload carries
            // a decision value is by definition unprocessed. Pre-image
            // edge-detection proved fragile: a decision written while the step
            // was disabled (or the update dropped at depth) sticks, and every
            // later approval is Approved→Approved — invisible to a transition
            // check, with no way out short of deny/reactivate/re-approve.
            // Value + still-active lets any save carrying the value re-drive
            // the stuck record.

            bool recordActive =
                (preImage?.GetAttributeValue<OptionSetValue>(CommonAttributes.StateCode)?.Value
                 ?? StateCodeValues.Active) == StateCodeValues.Active;

            if (!recordActive)
            {
                tracing.Trace("Realignment already inactive (processed) — skipping.");
                return;
            }

            bool stateApprovedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Approved);
            bool stateDeniedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Denied);

            bool beApprovedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Approved);
            bool beDeniedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Denied);

            // ---- Denial → Immediate deactivation ----
            if (stateDeniedInPayload || beDeniedInPayload)
            {
                tracing.Trace("Realignment explicitly denied — auto-deactivating.");
                FinalizeRealignment(service, tracing, context.PrimaryEntityId);
                return;
            }

            // ---- Approval determination ----
            bool newlyApproved;
            if (sameFundSAG && isPriorPath)
            {
                newlyApproved = stateApprovedInPayload;
            }
            else
            {
                newlyApproved = beApprovedInPayload;
            }

            // If no approval value in the payload → user is saving/editing → do nothing
            if (!newlyApproved)
            {
                tracing.Trace("No approval value in payload — skipping processing.");
                return;
            }

            // Durable double-processing barrier (parity with Turn-Ins / Swaps): a
            // reactivated-and-re-approved realignment must not post a second
            // ledger pair. Same-LOA realignments write no ledgers and rely on
            // deactivation alone.
            if (LedgerIdempotency.HasExistingLedger(service, LedgerAttributes.Realignment, context.PrimaryEntityId))
            {
                tracing.Trace("Ledger entries already exist for this Realignment — declining to re-process.");
                return;
            }

            tracing.Trace("RealignmentProcessor: Approved and beginning execution.");

            // Item-based realignments carry child items (each a Fund/SAG move);
            // legacy single-row realignments have none.
            if (hasItems)
            {
                RealignmentExecutor.Execute(service, tracing, context.PrimaryEntityId);
                FinalizeRealignment(service, tracing, context.PrimaryEntityId);
                return;
            }

            RealignmentExecutorLegacy.Execute(
                service, tracing, context.PrimaryEntityId, amount,
                debitPrior, creditPrior, debitRF, creditRF, debitLOA, creditLOA,
                sameFundSAG, isPriorPath, isRFPath);

            FinalizeRealignment(service, tracing, context.PrimaryEntityId);
        }

        private static void FinalizeRealignment(IOrganizationService service, ITracingService tracing, Guid id)
        {
            tracing.Trace("Deactivating realignment.");

            var update = new Entity(EntityNames.Realignments, id);
            update[CommonAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive);
            update[CommonAttributes.StatusCode] = new OptionSetValue(StatusCodeValues.InactiveDefault);

            service.Update(update);

            tracing.Trace("RealignmentProcessor completed.");
        }
    }
}