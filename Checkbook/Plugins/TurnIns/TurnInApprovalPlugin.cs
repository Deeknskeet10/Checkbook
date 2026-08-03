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
            // book_turnin Update, and an IsNestedUpdateOf(...) guard here
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
                (preImage?.GetAttributeValue<OptionSetValue>("statecode")?.Value
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

            // ---- Resolve LOAs for ledger creation ----
            var loaResolution = TurnInLOAResolver.ResolveLOAs(service, tracing, merged, items);

            // Sanity-check: items sum should match header amount (validator already enforces).
            if (Math.Round(loaResolution.TotalAmount, 2) != Math.Round(headerAmount, 2))
            {
                tracing.Trace(
                    $"WARNING: loaResolution.TotalAmount ({loaResolution.TotalAmount:C}) does not match " +
                    $"header amount ({headerAmount:C}). Proceeding with header amount as source of truth.");
            }

            // ---- 1. Ledger entries ----
            tracing.Trace("Creating ledger entries...");
            LedgerCreator.CreateTurnInEntries(
                service, tracing, turnInId,
                loaResolution.DebitLOAs, loaResolution.CreditLOAs);

            // ---- 2. Distributions — AFP + Allotment (debit at state FC, credit at A18) ----
            // Sized from book_afpamount / book_allotmentamount on the Turn-In header
            // (populated by TurnInAmountCalculator for Kind A, by GenerateDistributions
            // for Kind B). No TDP-side distribution; TDP moves via the Ledger + RF/Prio
            // updates below.
            tracing.Trace("Creating distribution entries...");
            TurnInDistributionCreator.CreateDistributions(service, tracing, merged);

            // ---- 3. Update child Prioritizations (items with a Prio) ----
            tracing.Trace("Updating Prioritizations...");
            TurnInPrioritizationUpdater.ApplyPrioritizationUpdates(service, tracing, items);

            // ---- 4. Update Requirement Fundings directly (RF-only items) ----
            tracing.Trace("Updating Requirement Fundings (RF-only items)...");
            TurnInRequirementFundingUpdater.ApplyRequirementFundingUpdates(service, tracing, items);

            // ---- 5. Roll up affected parent RFs from the Prio changes ----
            // PrioritizationRollupToRequirementFunding is guarded on context.Depth > 1,
            // so the nested Prio updates above do not trigger it. Invoke the shared
            // helper directly for each unique parent RF — same pattern RealignmentProcessor
            // uses (see Plugins/Realignments/RealignmentProcessor.cs).
            //
            // Order matters: roll up RF.FundedAmount FIRST, then reduce RF.TDP.
            // RequirementFundingTDPValidator (pre-op on RF Update) compares effective
            // FundedAmount against effective TDP using target ∪ preImage. If we
            // shrank TDP first, the preImage Funded would still be the pre-Turn-In
            // total — the rollup hadn't fanned up from the depth-2 Prio update — and
            // the validator would reject the TDP reduction with "Funded Amount
            // cannot exceed TDP". Rolling up first lowers RF.Funded so the TDP
            // reduction's pre-image already reflects the post-Turn-In value.
            //
            // The roll-up only recomputes RF.FundedAmount/ValidatedAmount from child
            // Prios; it does NOT touch RF.TDP (TDP is the RF's allocation from the
            // LOA, not a Prio roll-up). So after the roll-up we still need to shrink
            // RF.TDP by the amount pulled — mirroring the RF-only path in
            // TurnInRequirementFundingUpdater. Without that step, RF.TDP stays high,
            // the difference surfaces as Withhold (TDP − Funded), and LOA TDP
            // Remaining (LOA.TDP − Σ RF.TDP) goes negative.
            var rfPulledTotals = items
                .Where(i => i.Prioritization != null && i.RequirementFunding != null)
                .GroupBy(i => i.RequirementFunding.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            foreach (var pair in rfPulledTotals)
            {
                var rfId = pair.Key;
                var pulled = pair.Value;

                tracing.Trace($"Rolling up parent RF {rfId} Funded after Prio reduction.");
                PrioritizationRollupHelper.RecalculateRFFunded(service, rfId, tracing);

                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    rfId,
                    new ColumnSet(RequirementFundingAttributes.TDP));
                decimal oldTdp = NumericHelper.ToDecimal(rf, RequirementFundingAttributes.TDP) ?? 0m;
                decimal newTdp = oldTdp - pulled;
                if (newTdp < 0m) newTdp = 0m;

                tracing.Trace($"Reducing parent RF {rfId} TDP: {oldTdp} -> {newTdp} (pulled {pulled}).");
                service.Update(new Entity(EntityNames.RequirementFunding, rfId)
                {
                    [RequirementFundingAttributes.TDP] = newTdp,
                });
            }

            // ---- 6. Recalculate LOA TDP / TDP Remaining for every LOA touched ----
            // LedgerCreateFundingLineUpdater and RequirementFundingTDPRemainingUpdater
            // both guard on Depth > 1, so the nested Ledger.Create and RF.Update calls
            // above do not trigger them. Drive the recalc directly here so the LOA's
            // TDP (ledger net) and TDP Remaining (RF allocations) reflect the Turn-In.
            var affectedLoaIds = loaResolution.DebitLOAs.Keys
                .Select(r => r.Id)
                .Concat(loaResolution.CreditLOAs.Keys.Select(r => r.Id))
                .Distinct()
                .ToList();
            foreach (var loaId in affectedLoaIds)
            {
                tracing.Trace($"Recalculating LOA {loaId} TDP after Turn-In ledger.");
                TDPCalculationHelper.RecalculateLOATDP(service, loaId, tracing);
            }

            // ---- 7. Deactivate the Turn-In to keep the work queue clean ----
            // Mirrors TurnInDeactivator's statecode/statuscode for the denial path so
            // both completion outcomes (approved or denied) land in the same inactive
            // state. This nested Update carries statecode/statuscode only, so it
            // matches neither this step's filter (book_stateapproved/book_beapproved)
            // nor TurnInDeactivator's (book_stateapproved) — no re-entry.
            tracing.Trace($"Deactivating completed Turn-In {turnInId}.");
            service.Update(new Entity(EntityNames.Turnin, turnInId)
            {
                ["statecode"] = new OptionSetValue(StateCodeValues.Inactive),
                ["statuscode"] = new OptionSetValue(StatusCodeValues.InactiveDefault),
            });

            tracing.Trace("TurnInApprovalPlugin completed successfully.");
        }
    }
}
