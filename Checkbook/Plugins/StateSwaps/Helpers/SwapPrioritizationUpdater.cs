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
        /// Order-sensitive: increase credit RFs' TDP first (creates headroom for the
        /// credit-side Prio Funded increase), then apply Prio Funded deltas, then
        /// reduce debit RFs' TDP. The intermediate states can transiently violate
        /// Funded &lt;= TDP on individual RFs; RequirementFundingTDPValidator's
        /// State-Swap ancestor bypass makes that safe.
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

            // ---- 1. Credit RFs first (TDP up = headroom) ----
            foreach (var pair in rfDeltas.Where(p => p.Value > 0m))
                AdjustRFTdp(service, tracing, pair.Key, pair.Value);

            // ---- 2. Prio deltas ----
            foreach (var pair in prioDeltas)
                AdjustPrioFunded(service, tracing, pair.Key, pair.Value);

            // ---- 3. Debit RFs (TDP down) ----
            foreach (var pair in rfDeltas.Where(p => p.Value < 0m))
                AdjustRFTdp(service, tracing, pair.Key, pair.Value);

            // ---- 4. Rollup RF.FundedAmount from children on every touched RF ----
            // Same reason RealignmentProcessor calls this explicitly: the nested
            // Prio updates above run at depth > 1, so the rollup helper is skipped.
            foreach (var rfId in rfDeltas.Keys)
                PrioritizationRollupHelper.RecalculateRFFunded(service, rfId, tracing);
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

            service.Update(new Entity(EntityNames.RequirementFunding, rfId)
            {
                [RequirementFundingAttributes.TDP] = newTdp,
            });
        }
    }
}
