using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.StateSwaps.Helpers;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Post-operation orchestrator for a BE-approved State Swap.
    ///
    /// Fires on book_stateswap Update when the payload carries
    /// book_beapproved = true and the swap is still active — deactivation at
    /// step 7 marks "processed" and the ledger-existence guard is the durable
    /// double-processing barrier. No nesting/Depth guard: server-side field
    /// setters on this table (real-time Business Rules, pre-op target
    /// mutation) can nest the decision-bearing save under another
    /// book_stateswap Update, and an ancestor-walk guard silently dropped
    /// every approval (same failure RealignmentProcessor had — see the note
    /// in ExecutePlugin).
    /// Runs the financial side effects:
    ///   1. Idempotency guard (existing ledger blocks re-processing)
    ///   2. Resolve LOAs + parent RFs for every active item
    ///   3. Ledger pairs: one debit + one credit per item, skipping items where
    ///      debit LOA == credit LOA (net-zero at the LOA level, per user spec)
    ///   4. Recalc LOA TDP for every LOA that got a ledger row
    ///   5. Apply Prio.FundedAmount + parent RF.TDP deltas (aggregated per Prio / RF)
    ///   6. Recalc LOA TDP again as a catch-all (mirrors Realignment)
    ///      then create AFP/Allotment Distributions (SwapDistributionCreator:
    ///      per direction, giving state → A18 pair + A18 → receiving state pair,
    ///      all linked to the swap via book_stateswap)
    ///   7. Deactivate the swap (statecode Inactive, statuscode 2 = BE Approved)
    ///
    /// Validation (role gating, balance, overdraw) is owned by SwapValidator
    /// running pre-op on the same Update. By the time this runs we trust the
    /// input; the idempotency guard is defense-in-depth.
    ///
    /// Register PreImage 'PreImage' on the Update step (filter attr =
    /// book_beapproved) so the transition is detectable.
    /// </summary>
    public class SwapApprovalPlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.StateSwap) return;
            if (context.MessageName != "Update") return;

            // NOTE: Do NOT skip when nested inside another book_stateswap
            // Update. Real-time Business Rules / server-side field setters on
            // this table issue a nested book_stateswap Update, so the user's
            // BE-approval save can run *inside* that nesting — an
            // IsNestedUpdateOf(...) guard here silently dropped every approval
            // (symptom: trace showed only "self re-entry — skipping"; no
            // ledgers, no distributions, swap never deactivated). Same failure
            // and same fix as RealignmentProcessor (commit 23aef51).
            //
            // No self re-entry guard is needed. The deactivation at step 7
            // writes only statecode/statuscode and this step is filtered on
            // book_beapproved, so it cannot re-trigger the orchestrator;
            // SwapRollupPlugin's parent writes (totals + isbalanced) cannot
            // either. Idempotency comes from the record-active check plus the
            // ledger-existence guard below.

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            // Value + active detection: processed swaps are always deactivated
            // at step 7, so an *active* swap whose payload carries
            // book_beapproved = true is unprocessed — even if the flag was
            // already true (a stuck approval that committed without processing
            // is re-driven by re-saving the flag; a transition check would
            // skip it). The ledger-existence guard below is the durable
            // double-processing barrier.
            bool recordActive =
                (preImage?.GetAttributeValue<OptionSetValue>("statecode")?.Value
                 ?? StateCodeValues.Active) == StateCodeValues.Active;

            if (!recordActive)
            {
                tracing.Trace("SwapApprovalPlugin: swap already inactive (processed) — skipping.");
                return;
            }

            bool beApprovedInPayload = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, StateSwapAttributes.BEApproved);

            if (!beApprovedInPayload)
            {
                tracing.Trace("SwapApprovalPlugin: no BE approval value in payload; nothing to do.");
                return;
            }

            var swapId = context.PrimaryEntityId;

            // ---- 1. Idempotency (defense-in-depth) ----
            if (LedgerIdempotency.HasExistingLedger(service, LedgerAttributes.StateSwap, swapId))
            {
                tracing.Trace(
                    "SwapApprovalPlugin: ledger entries already exist for this swap — orchestrator declines. " +
                    "(Validator should have blocked this pre-op; defensive guard.)");
                return;
            }

            tracing.Trace($"SwapApprovalPlugin: processing BE approval on swap {swapId}.");

            // ---- 2. Resolve LOAs + RFs ----
            var items = SwapLOAResolver.ResolveItems(service, tracing, swapId);
            if (items.Count == 0)
            {
                throw new InvalidPluginExecutionException(
                    "State Swap has no active Swap Items to process.");
            }

            // ---- 3. Ledger pairs (skip same-LOA net-zero rows) ----
            var touchedLOAs = new HashSet<Guid>();
            foreach (var item in items)
            {
                if (item.DebitLOA.Id == item.CreditLOA.Id)
                {
                    tracing.Trace(
                        $"SwapApprovalPlugin: item {item.SwapItemId} debits + credits LOA {item.DebitLOA.Id} " +
                        "— net-zero at LOA, skipping ledger creation.");
                    continue;
                }

                LedgerCreator.CreateStateSwapPair(
                    service, tracing,
                    item.DebitLOA, item.CreditLOA,
                    item.Amount, swapId);

                touchedLOAs.Add(item.DebitLOA.Id);
                touchedLOAs.Add(item.CreditLOA.Id);
            }

            // ---- 4. Recalc LOA TDP after ledger writes ----
            foreach (var loaId in touchedLOAs)
                TDPCalculationHelper.RecalculateLOATDP(service, loaId, tracing);

            // ---- 5. Apply Prio + RF deltas ----
            // The RF validator's IsTriggeredByStateSwap bypass covers the
            // intermediate states this creates on each RF.
            SwapPrioritizationUpdater.ApplyFundingDeltas(service, tracing, items);

            // ---- 6. Recalc LOA TDP once more (catch-all, matches Realignment) ----
            foreach (var loaId in touchedLOAs)
                TDPCalculationHelper.RecalculateLOATDP(service, loaId, tracing);

            // ---- 6b. AFP/Allotment Distributions (state → A18 → state) ----
            // Linked to the swap via book_stateswap; the swap-related
            // Distribution views and GFEBS entry work off these rows.
            SwapDistributionCreator.CreateDistributions(service, tracing, swapId, items);

            // ---- 7. Deactivate ----
            // statuscode 2 = BE Approved (mapped Inactive in the schema).
            tracing.Trace($"SwapApprovalPlugin: deactivating swap {swapId}.");
            service.Update(new Entity(EntityNames.StateSwap, swapId)
            {
                ["statecode"] = new OptionSetValue(StateCodeValues.Inactive),
                ["statuscode"] = new OptionSetValue(StatusCodeValues.InactiveDefault),
            });

            tracing.Trace("SwapApprovalPlugin: completed successfully.");
        }
    }
}
