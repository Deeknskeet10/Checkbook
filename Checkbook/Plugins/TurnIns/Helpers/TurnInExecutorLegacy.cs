using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Executes an approved header-based Turn-In: legacy (FY26) item Turn-Ins, and
    /// zero-item Sweep Turn-Ins in every FY. The header carries Fund / PG / AFP /
    /// Allotment; money is taken straight off the source Prioritization or RF.
    /// Item-based (FY27+) Turn-Ins run <see cref="TurnInExecutor"/> instead.
    ///
    /// Steps: ledgers → Distributions → Prio reductions → RF-only reductions →
    /// parent-RF roll-up + TDP shrink → LOA TDP recalc. The orchestrator
    /// (TurnInApprovalPlugin) gates readiness and deactivates afterwards.
    /// </summary>
    public static class TurnInExecutorLegacy
    {
        public static void Execute(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn,
            List<TurnInItemRecord> items,
            decimal headerAmount)
        {
            var turnInId = turnIn.Id;

            // ---- Resolve LOAs for ledger creation ----
            var loaResolution = TurnInLOAResolver.ResolveLOAsForHeader(service, tracing, turnIn, items);

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
            // (populated by TurnInAmountCalculator, or by GenerateDistributions for
            // Sweeps). No TDP-side distribution; TDP moves via the Ledger + RF/Prio
            // updates below.
            tracing.Trace("Creating distribution entries...");
            TurnInDistributionCreator.CreateDistributions(service, tracing, turnIn);

            // ---- 3. Reduce child Prioritizations (items with a Prio) ----
            ApplyPrioritizationUpdates(service, tracing, items);

            // ---- 4. Reduce Requirement Fundings directly (RF-only items) ----
            ApplyRequirementFundingUpdates(service, tracing, items);

            // ---- 5. Roll up affected parent RFs from the Prio changes ----
            // PrioritizationRollupToRequirementFunding early-returns at Depth > 1,
            // so the nested Prio updates above do not trigger it — call the helper
            // directly for each parent RF.
            //
            // Order matters: roll up RF.FundedAmount FIRST, then reduce RF.TDP.
            // RequirementFundingTDPValidator (pre-op on RF Update) compares effective
            // FundedAmount against effective TDP using target ∪ preImage. Shrinking
            // TDP first would leave the pre-Turn-In Funded in the pre-image and the
            // validator would reject it with "Funded Amount cannot exceed TDP".
            //
            // The roll-up only recomputes RF.FundedAmount/ValidatedAmount; it does NOT
            // touch RF.TDP (the RF's allocation from the LOA). Without the TDP shrink
            // the difference surfaces as Withholding and LOA TDP Remaining goes negative.
            var rfPulledTotals = items
                .Where(i => i.Prioritization != null && i.RequirementFunding != null)
                .GroupBy(i => i.RequirementFunding.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            foreach (var pair in rfPulledTotals)
            {
                var rfId = pair.Key;
                var pulled = pair.Value;

                tracing.Trace($"Rolling up parent RF {rfId} Funded after Prio reduction.");
                FundingRollupHelper.RecalculateRFFunded(service, rfId, tracing);

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
            // early-return at Depth > 1, so drive the recalc directly.
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
        }

        /// <summary>
        /// Reduces each source Prioritization's Funded by the Σ of its items (floored
        /// at 0), and its Requested by the same applied delta.
        /// </summary>
        private static void ApplyPrioritizationUpdates(
            IOrganizationService service,
            ITracingService tracing,
            List<TurnInItemRecord> items)
        {
            // Aggregate by Prio so several items on one Prio make a single Update.
            var prioTotals = items
                .Where(i => i.Prioritization != null)
                .GroupBy(i => i.Prioritization.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            foreach (var pair in prioTotals)
            {
                var prioId = pair.Key;
                var amount = pair.Value;

                var pri = service.Retrieve(
                    EntityNames.Prioritization,
                    prioId,
                    new ColumnSet(
                        PrioritizationAttributes.FundedAmountTDP,
                        PrioritizationAttributes.RequestedAmount));

                decimal oldFunded = NumericHelper.ToDecimal(pri, PrioritizationAttributes.FundedAmountTDP) ?? 0m;
                decimal oldRequested = NumericHelper.ToDecimal(pri, PrioritizationAttributes.RequestedAmount) ?? 0m;

                // The actual reduction applied to Funded (floored at 0); Requested drops
                // by the same delta so the Prio's request shrinks alongside the Turn-In.
                decimal newFunded = oldFunded - amount;
                if (newFunded < 0m) newFunded = 0m;
                decimal appliedReduction = oldFunded - newFunded;

                decimal newRequested = oldRequested - appliedReduction;
                if (newRequested < 0m) newRequested = 0m;

                tracing.Trace(
                    $"Prioritization {prioId}: Funded {oldFunded} -> {newFunded}; " +
                    $"Requested {oldRequested} -> {newRequested} (taken {amount}, applied {appliedReduction}).");

                var update = new Entity(EntityNames.Prioritization, prioId);
                update[PrioritizationAttributes.FundedAmountTDP] = newFunded;
                update[PrioritizationAttributes.RequestedAmount] = newRequested;
                service.Update(update);
            }
        }

        /// <summary>
        /// RF-only items (no Prioritization): reduce the RF's TDP and Funded by the
        /// Σ of its items, floored at 0. The RF is not re-rolled afterwards.
        /// </summary>
        private static void ApplyRequirementFundingUpdates(
            IOrganizationService service,
            ITracingService tracing,
            List<TurnInItemRecord> items)
        {
            // One Update per RF.
            var rfTotals = items
                .Where(i => i.IsRFOnly)
                .GroupBy(i => i.RequirementFunding.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            foreach (var pair in rfTotals)
            {
                var rfId = pair.Key;
                var amount = pair.Value;

                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    rfId,
                    new ColumnSet(
                        RequirementFundingAttributes.TDP,
                        RequirementFundingAttributes.FundedAmount));

                decimal oldTdp = NumericHelper.ToDecimal(rf, RequirementFundingAttributes.TDP) ?? 0m;
                decimal oldFunded = NumericHelper.ToDecimal(rf, RequirementFundingAttributes.FundedAmount) ?? 0m;

                decimal newTdp = oldTdp - amount;
                decimal newFunded = oldFunded - amount;

                // Floor at zero — the validator should have prevented overdraw.
                if (newTdp < 0m) newTdp = 0m;
                if (newFunded < 0m) newFunded = 0m;

                tracing.Trace($"RF {rfId}: TDP {oldTdp:C} → {newTdp:C}; Funded {oldFunded:C} → {newFunded:C}");

                var update = new Entity(EntityNames.RequirementFunding, rfId);
                update[RequirementFundingAttributes.TDP] = newTdp;
                update[RequirementFundingAttributes.FundedAmount] = newFunded;
                service.Update(update);
            }
        }
    }
}
