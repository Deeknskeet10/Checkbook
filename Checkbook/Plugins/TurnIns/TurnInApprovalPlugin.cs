using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.TurnIns.Helpers;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// Post-operation orchestrator for an approved Turn-In.
    ///
    /// Fires on book_turnin Update. Fires when the payload carries an approval flag
    /// (book_stateapproved / book_beapproved = true) and the record is still active —
    /// deactivation-on-completion marks "processed" and the ledger-existence guard
    /// is the durable double-processing barrier. No nesting/Depth guard: server-side
    /// field setters (real-time Business Rules) can nest the decision-bearing save
    /// under another book_turnin Update, and an ancestor-walk guard would silently
    /// drop every approval — the exact failure RealignmentProcessor and
    /// SwapApprovalPlugin had (see the note in ExecutePlugin).
    /// Runs the financial side effects in order:
    ///   1. Idempotency guard (existence of any ledger linked to this Turn-In)
    ///   2. Load items (LOA Fund + PG carried on each item for distribution grouping)
    ///   3. Resolve credit LOA
    ///   4. Create ledger entries (debit per LOA, single credit)
    ///   5. Create distributions (debit grouped by Fund/PG, single credit)
    ///   6. Update Prioritizations (items with a Prio)
    ///   7. Update Requirement Fundings directly (items without a Prio — RF-only)
    ///
    /// FY27+ Turn-Ins with items take TurnInExecutor instead (junction reductions,
    /// per-debit-LOA ARNG credit, per-Fund/PG distributions) — docs/TurnIn-FY27-Redesign.md.
    ///
    /// Validation (header/items math, approval routing) is owned by TurnInValidator
    /// running pre-op on the same Update. By the time this orchestrator runs we trust
    /// the input is valid; the idempotency guard here is the only defensive check.
    /// </summary>
    public class TurnInApprovalPlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            tracing.Trace("TurnInApprovalPlugin started.");

            if (context.PrimaryEntityName != EntityNames.Turnin) return;
            if (context.MessageName != "Update") return;

            // NOTE: Do NOT skip when nested inside another book_turnin Update.
            // Real-time Business Rules / server-side field setters on this
            // table would nest the user's approval save under another
            // book_turnin Update, and an same-table-nesting guard here
            // silently dropped every approval on book_realignments and
            // book_stateswap when exactly that happened (removed here
            // preemptively, Aug 2026 — same fix as commit 23aef51).
            //
            // No self re-entry guard is needed. This step is filtered on
            // book_stateapproved / book_beapproved, and the deactivation
            // Updates (step 7 below and TurnInDeactivator's) write only
            // statecode/statuscode, so they cannot re-trigger the
            // orchestrator. Idempotency comes from the record-active check
            // plus the ledger-existence guard below.

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            // ---- Approval detection (value + active, same logic as the validator) ----
            // Processed Turn-Ins are always deactivated (approved here in step 7,
            // denied via TurnInDeactivator), so an *active* record whose payload
            // carries an approval flag is unprocessed. Pre-image edge-detection
            // left approvals that committed without processing permanently stuck
            // (true → true is invisible to a transition check); value + active
            // lets a re-save of the flag re-drive them. The ledger-existence
            // guard below stays as the durable double-processing barrier.
            bool recordActive =
                (preImage?.GetAttributeValue<OptionSetValue>(CommonAttributes.StateCode)?.Value
                 ?? StateCodeValues.Active) == StateCodeValues.Active;

            if (!recordActive)
            {
                tracing.Trace("Turn-In already inactive (processed) — skipping.");
                return;
            }

            bool stateApprovedInPayload = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, TurninAttributes.StateApproved);
            bool beApprovedInPayload = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, TurninAttributes.BEApproved);

            if (!stateApprovedInPayload && !beApprovedInPayload)
            {
                tracing.Trace("No approval value in payload — orchestrator does nothing.");
                return;
            }

            // ---- Idempotency: bail if any ledgers already exist for this Turn-In ----
            // Defense-in-depth — the validator should have caught this pre-op, but if
            // the validator step ever gets disabled this guard still prevents duplicates.
            if (LedgerIdempotency.HasExistingLedger(service, LedgerAttributes.TurnIn, context.PrimaryEntityId))
            {
                tracing.Trace(
                    "Ledger entries already exist for this Turn-In — orchestrator declines to re-process. " +
                    "(Validator should have blocked the update at pre-op; this is a defensive guard.)");
                return;
            }

            tracing.Trace("Approval value + active record + clean ledger state — beginning Turn-In processing.");

            var merged = GetMergedEntity(target, preImage);
            Guid turnInId = merged.Id;
            decimal headerAmount = NumericHelper.ToDecimal(merged, TurninAttributes.Amount) ?? 0m;

            // ---- Load items (also resolves LOA.Fund + LOA.PG on each item) ----
            var items = TurnInItemRepository.GetTurnInItems(service, tracing, turnInId);

            // ---- Execution-readiness gate (owns the RF-only BE requirement) ----
            // The validator now permits an intermediate State-only approval on an
            // RF-only Turn-In (State approves first, which routes it to BE), so the
            // "RF-only needs BE approval before funds move" rule lives HERE: don't
            // create any ledgers/distributions until the Turn-In is fully approved.
            //   * RF-only (any item without a Prio) — needs BOTH State and BE approval.
            //   * Otherwise (all items Prio-backed) — State approval alone.
            // A save that only records one half of an RF-only approval falls through
            // to a no-op return; the other approval's save re-drives this orchestrator
            // (value-based trigger) once both flags are effective.
            bool anyRfOnly = items.Any(i => i.IsRFOnly);
            bool newStateApproved = GetEffectiveBool(target, preImage, TurninAttributes.StateApproved);
            bool newBeApproved = GetEffectiveBool(target, preImage, TurninAttributes.BEApproved);
            // FY27 RF-level Turn-Ins are approved in one step by a Resource Integrator / CSOR
            // (carried on book_beapproved) — no State step.
            EnsureFiscalYear(service, merged, turnInId);
            bool rfLevel = items.Count > 0 && items.All(i => i.IsRFOnly) && !TurnInRules.IsLegacy(merged);
            bool readyToExecute = rfLevel
                ? newBeApproved
                : anyRfOnly ? (newStateApproved && newBeApproved) : newStateApproved;

            if (!readyToExecute)
            {
                tracing.Trace(
                    $"Approval recorded but Turn-In not yet ready to execute " +
                    $"(anyRfOnly={anyRfOnly}, state={newStateApproved}, be={newBeApproved}). " +
                    "Awaiting the remaining approval — no financial side effects yet.");
                return;
            }

            // ---- Execute ----
            // Item-based (FY27+) Turn-Ins: money lives on Prioritization Funding /
            // Requirement Detail Funding junctions and the header carries no Fund/PG
            // (docs/TurnIn-FY27-Redesign.md). Legacy (FY26) Turn-Ins and zero-item
            // Sweep Turn-Ins in every FY take the header-based path.
            if (items.Count > 0 && !TurnInRules.IsLegacy(merged))
            {
                tracing.Trace("Item-based Turn-In — executing the junction-based path.");
                TurnInExecutor.Execute(service, tracing, merged, items);
            }
            else
            {
                tracing.Trace("Header-based Turn-In (legacy FY26 or Sweep) — executing the legacy path.");
                TurnInExecutorLegacy.Execute(service, tracing, merged, items, headerAmount);
            }

            // ---- Deactivate the Turn-In to keep the work queue clean ----
            // Mirrors TurnInDeactivator's statecode/statuscode for the denial path so
            // both completion outcomes (approved or denied) land in the same inactive
            // state. This nested Update carries statecode/statuscode only, so it
            // matches neither this step's filter (book_stateapproved/book_beapproved)
            // nor TurnInDeactivator's (book_stateapproved) — no re-entry.
            Deactivate(service, tracing, turnInId);

            tracing.Trace("TurnInApprovalPlugin completed successfully.");
        }

        /// <summary>Backfills book_fiscalyear / book_fundcenter when the pre-image lacks them.</summary>
        private static void EnsureFiscalYear(IOrganizationService service, Entity merged, Guid turnInId)
        {
            if (merged.Contains(TurninAttributes.FiscalYear) && merged.Contains(TurninAttributes.FundCenter)) return;
            var stored = service.Retrieve(EntityNames.Turnin, turnInId,
                new ColumnSet(TurninAttributes.FiscalYear, TurninAttributes.FundCenter));
            if (!merged.Contains(TurninAttributes.FiscalYear))
                merged[TurninAttributes.FiscalYear] = stored.GetAttributeValue<OptionSetValue>(TurninAttributes.FiscalYear);
            if (!merged.Contains(TurninAttributes.FundCenter))
                merged[TurninAttributes.FundCenter] = stored.GetAttributeValue<EntityReference>(TurninAttributes.FundCenter);
        }

        private static void Deactivate(IOrganizationService service, ITracingService tracing, Guid turnInId)
        {
            tracing.Trace($"Deactivating completed Turn-In {turnInId}.");
            service.Update(new Entity(EntityNames.Turnin, turnInId)
            {
                [CommonAttributes.StateCode] = new OptionSetValue(StateCodeValues.Inactive),
                [CommonAttributes.StatusCode] = new OptionSetValue(StatusCodeValues.InactiveDefault),
            });
        }
    }
}
