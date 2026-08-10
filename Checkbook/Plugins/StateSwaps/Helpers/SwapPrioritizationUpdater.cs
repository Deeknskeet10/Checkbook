using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.StateSwaps.Helpers
{
    /// <summary>
    /// Applies net FundedAmount deltas to each Prioritization touched by a State
    /// Swap, and net TDP deltas to each Requirement Funding touched.
    /// Aggregates first so a Prio that appears as a debit in one item and a credit
    /// in another gets a single Update with the net change.
    /// On the credit side, RequestedAmount is raised to match FundedAmount when
    /// the credit would push Funded above Requested — set in the SAME Update so
    /// the "Requested Amount cannot be less than Funded Amount" business rule
    /// (Prioritization-RequestedvsFunded, entity-scoped, no bypass possible)
    /// never observes an invalid state. Mirrors RealignmentProcessor.
    /// </summary>
    public static class SwapPrioritizationUpdater
    {
        /// <summary>
        /// Order-sensitive, debit-first: release funds before claiming them so
        /// EVERY intermediate state is valid under single-record validation —
        /// the per-RF LOA-allocation check (RequirementFundingTDPValidator),
        /// the Prio-level cap checks (PrioritizationFundingValidator), and the
        /// "Req Funding - Funded vs TDP" real-time business rule (entity-scoped,
        /// no bypass possible). On a fully-allocated LOA a credit-first order
        /// transiently over-allocates the LOA by the swap amount; the validators
        /// carry State-Swap ancestor bypasses, but the debit-first order works
        /// even when an unbypassed check is watching (defense in depth — see the
        /// Aug 2026 same-LOA one-way transfer incident).
        ///
        /// Sequence:
        ///   1. Debit Prios' Funded down.
        ///   2. Debit RFs: rolled-down FundedAmount + TDP cut in the SAME Update
        ///      (a TDP-only cut while Funded is stale-high would trip the
        ///      Funded &lt;= TDP business rule — mirrors
        ///      RealignmentProcessor.ApplyDebitToRF). This frees LOA headroom.
        ///   3. Credit RFs: TDP up (fits in the headroom step 2 released).
        ///   4. Credit Prios' Funded up (fits under the raised credit RF TDP).
        ///   5. Re-roll FundedAmount on every touched RF (an RF debited in one
        ///      item and credited in another has children changed after step 2).
        /// </summary>
        public static void ApplyFundingDeltas(
            IOrganizationService service,
            ITracingService tracing,
            IReadOnlyList<ResolvedSwapItem> items)
        {
            // ---- Aggregate net deltas ----
            var prioDeltas = new Dictionary<Guid, decimal>();
            var rfDeltas = new Dictionary<Guid, decimal>();

            foreach (var item in items)
            {
                Accumulate(prioDeltas, item.DebitPrio.Id, -item.Amount);
                Accumulate(prioDeltas, item.CreditPrio.Id, +item.Amount);
                if (item.DebitRF != null)
                    Accumulate(rfDeltas, item.DebitRF.Id, -item.Amount);
                if (item.CreditRF != null)
                    Accumulate(rfDeltas, item.CreditRF.Id, +item.Amount);
            }

            // ---- 1. Debit Prios first (Funded down) ----
            foreach (var pair in prioDeltas.Where(p => p.Value < 0m))
                AdjustPrioFunded(service, tracing, pair.Key, pair.Value);

            // ---- 2. Debit RFs: rolled-down Funded + TDP cut, one Update ----
            // The rollup is explicit for the same reason as in RealignmentProcessor:
            // the nested Prio updates above run at depth > 1, so the rollup helper
            // is skipped there.
            foreach (var pair in rfDeltas.Where(p => p.Value < 0m))
            {
                var update = PrioritizationRollupHelper.BuildRFFundedUpdate(
                    service, pair.Key, tracing);
                update[RequirementFundingAttributes.TDP] =
                    ComputeAdjustedTdp(service, tracing, pair.Key, pair.Value);
                service.Update(update);
            }

            // ---- 3. Credit RFs: TDP up, into the headroom freed by step 2 ----
            foreach (var pair in rfDeltas.Where(p => p.Value > 0m))
                AdjustRFTdp(service, tracing, pair.Key, pair.Value);

            // ---- 4. Credit Prios: Funded up, under the raised credit RF TDP ----
            foreach (var pair in prioDeltas.Where(p => p.Value > 0m))
                AdjustPrioFunded(service, tracing, pair.Key, pair.Value);

            // ---- 5. Final Funded rollup on every touched RF ----
            // Debit RFs were rolled at step 2, but an RF that is debited in one
            // item and credited in another (or net-zero) has child changes from
            // step 4 to fold in; re-rolling every touched RF keeps this simple
            // and idempotent. TDP is already final everywhere.
            foreach (var pair in rfDeltas)
            {
                service.Update(PrioritizationRollupHelper.BuildRFFundedUpdate(
                    service, pair.Key, tracing));
            }
        }

        private static void Accumulate(Dictionary<Guid, decimal> map, Guid key, decimal delta)
        {
            if (map.TryGetValue(key, out var existing))
                map[key] = existing + delta;
            else
                map[key] = delta;
        }

        private static void AdjustPrioFunded(
            IOrganizationService service,
            ITracingService tracing,
            Guid prioId,
            decimal delta)
        {
            if (delta == 0m) return;

            var prio = service.Retrieve(
                EntityNames.Prioritization,
                prioId,
                new ColumnSet(
                    PrioritizationAttributes.FundedAmountTDP,
                    PrioritizationAttributes.RequestedAmount));

            decimal oldFunded = NumericHelper.ToDecimal(
                prio, PrioritizationAttributes.FundedAmountTDP) ?? 0m;
            decimal newFunded = oldFunded + delta;
            if (newFunded < 0m) newFunded = 0m;

            tracing.Trace(
                $"SwapPrioritizationUpdater: Prio {prioId} Funded {oldFunded} → {newFunded} (delta {delta}).");

            var update = new Entity(EntityNames.Prioritization, prioId)
            {
                [PrioritizationAttributes.FundedAmountTDP] = newFunded,
            };

            // Raise Requested in the same Update so the entity-scoped
            // "Requested vs Funded" business rule never sees Requested < Funded.
            decimal requested = NumericHelper.ToDecimal(
                prio, PrioritizationAttributes.RequestedAmount) ?? 0m;
            if (newFunded > requested)
            {
                tracing.Trace(
                    $"SwapPrioritizationUpdater: Prio {prioId} Requested {requested} → {newFunded} (raised to match Funded).");
                update[PrioritizationAttributes.RequestedAmount] = newFunded;
            }

            service.Update(update);
        }

        private static void AdjustRFTdp(
            IOrganizationService service,
            ITracingService tracing,
            Guid rfId,
            decimal delta)
        {
            if (delta == 0m) return;

            service.Update(new Entity(EntityNames.RequirementFunding, rfId)
            {
                [RequirementFundingAttributes.TDP] =
                    ComputeAdjustedTdp(service, tracing, rfId, delta),
            });
        }

        private static decimal ComputeAdjustedTdp(
            IOrganizationService service,
            ITracingService tracing,
            Guid rfId,
            decimal delta)
        {
            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                rfId,
                new ColumnSet(RequirementFundingAttributes.TDP));

            decimal oldTdp = NumericHelper.ToDecimal(
                rf, RequirementFundingAttributes.TDP) ?? 0m;
            decimal newTdp = oldTdp + delta;
            if (newTdp < 0m) newTdp = 0m;

            tracing.Trace(
                $"SwapPrioritizationUpdater: RF {rfId} TDP {oldTdp} → {newTdp} (delta {delta}).");

            return newTdp;
        }
    }
}
