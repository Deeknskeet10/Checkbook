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
    /// Financial side effects of a BE-approved FY27+ State Swap, whose items are
    /// PF → PF legs (docs/StateSwap-FY27-Redesign.md §6). Called by SwapApprovalPlugin;
    /// SwapValidator / SwapRules have already enforced availability and balance.
    /// FY26 swaps run <see cref="SwapExecutorLegacy"/>.
    ///
    /// Order (each intermediate state passes single-record validation):
    ///   0. Credit PF targets = pre-swap Funded − Σ legs out of it + Σ legs into it.
    ///   1. Per leg, debit first: ledger pair when cross-LOA; debit PF −amount; debit RF
    ///      TDP down (Funded re-summed) then credit RF TDP up.
    ///   2. Credit Itemized Prios: raise the selected details, so the itemized roll-up
    ///      lifts the Prio total before its credit PF rises (Σ PF ≤ Prio-total cap).
    ///   3. Direct credit Prios: lift Requested first if the new Funded would exceed it
    ///      (entity-scoped "Requested vs Funded" business rule); then set every credit PF
    ///      to its target. Absolute, so a SingleRfAutoAllocate sync in step 2 isn't doubled.
    ///   4. Debit Itemized Prios: lower the selected details (Requested unchanged).
    ///   5. Re-sum touched Direct Prios and RFs (junction roll-ups are depth-guarded off).
    ///   6. Enforcing LOA TDP recalc on every touched LOA.
    /// Funded reductions are authorized by FundedAmountLockBase (book_stateswap ancestor).
    /// </summary>
    public static class SwapExecutor
    {
        private const string Label = "State Swap";

        public static void Execute(
            IOrganizationService service,
            ITracingService tracing,
            Guid swapId,
            IReadOnlyList<ResolvedSwapItem> items)
        {
            var outByPf = items.GroupBy(i => i.DebitPF.Id).ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));
            var inByPf = items.GroupBy(i => i.CreditPF.Id).ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            // ---- 0. Credit PF targets (before anything moves) ----
            var targets = new Dictionary<Guid, decimal>();
            foreach (var kv in inByPf)
            {
                decimal funded = GetPfFunded(service, kv.Key);
                decimal sent = outByPf.TryGetValue(kv.Key, out var o) ? o : 0m;
                targets[kv.Key] = funded - sent + kv.Value;
                tracing.Trace($"SwapExecutor: credit PF {kv.Key} target {funded:N2} - {sent:N2} + {kv.Value:N2} = {targets[kv.Key]:N2}.");
            }

            var touchedLoas = new HashSet<Guid>();
            var touchedRfs = new HashSet<Guid>();
            var touchedPrios = new HashSet<Guid>();

            // ---- 1. Per leg: ledger, debit PF, RF TDP ----
            foreach (var item in items)
            {
                touchedLoas.Add(item.DebitLOA.Id);
                touchedLoas.Add(item.CreditLOA.Id);
                touchedRfs.Add(item.DebitRF.Id);
                touchedRfs.Add(item.CreditRF.Id);
                touchedPrios.Add(item.DebitPrio.Id);
                touchedPrios.Add(item.CreditPrio.Id);

                if (item.DebitLOA.Id != item.CreditLOA.Id)
                {
                    LedgerCreator.CreateStateSwapPair(service, tracing, item.DebitLOA, item.CreditLOA, item.Amount, swapId);
                    TDPCalculationHelper.RecalculateLOATDP(service, item.DebitLOA.Id, tracing, enforceNonNegative: false);
                    TDPCalculationHelper.RecalculateLOATDP(service, item.CreditLOA.Id, tracing, enforceNonNegative: false);
                }
                else
                {
                    tracing.Trace($"SwapExecutor: item {item.SwapItemId} same LOA {item.DebitLOA.Id} — no ledger.");
                }

                JunctionFundingHelper.ReduceJunction(service, tracing,
                    EntityNames.PrioritizationFunding, PrioritizationFundingAttributes.FundedAmount,
                    item.DebitPF.Id, GetPfFunded(service, item.DebitPF.Id), item.Amount,
                    Label, "Prioritization Funding");
                JunctionFundingHelper.MoveRfTdp(service, tracing, item.DebitRF.Id, item.CreditRF.Id, item.Amount, Label);
            }

            // ---- 2. Credit Itemized Prios: details up ----
            var increases = JunctionFundingHelper.LoadAdjustments(service,
                SwapDetailIncreaseAttributes.EntityLogicalName, SwapDetailIncreaseAttributes.StateSwap, swapId,
                SwapDetailIncreaseAttributes.ItemizedDetail, SwapDetailIncreaseAttributes.Amount);
            JunctionFundingHelper.RaiseItemizedDetails(service, tracing, increases, Label);

            // ---- 3. Direct credit Requested lift, then credit PFs to target ----
            foreach (var prioId in items.Select(i => i.CreditPrio.Id).Distinct())
                LiftRequestedForTargets(service, tracing, prioId, targets);
            foreach (var kv in targets)
                SetPfFunded(service, tracing, kv.Key, kv.Value);

            // ---- 4. Debit Itemized Prios: details down ----
            var reductions = JunctionFundingHelper.LoadAdjustments(service,
                SwapDetailReductionAttributes.EntityLogicalName, SwapDetailReductionAttributes.StateSwap, swapId,
                SwapDetailReductionAttributes.ItemizedDetail, SwapDetailReductionAttributes.Amount);
            JunctionFundingHelper.ReduceItemizedDetails(service, tracing, reductions, lowerRequested: false, operationLabel: Label);

            // ---- 5. Re-sum ----
            foreach (var prioId in touchedPrios)
                FundingRollupHelper.RecalculatePrioritizationFunded(service, prioId, tracing); // no-op when Itemized
            foreach (var rfId in touchedRfs)
                FundingRollupHelper.RecalculateRFFunded(service, rfId, tracing);

            // ---- 6. LOA TDP (enforcing) ----
            foreach (var loaId in touchedLoas)
                TDPCalculationHelper.RecalculateLOATDP(service, loaId, tracing);
        }

        private static decimal GetPfFunded(IOrganizationService service, Guid pfId)
        {
            var pf = service.Retrieve(EntityNames.PrioritizationFunding, pfId,
                new ColumnSet(PrioritizationFundingAttributes.FundedAmount));
            return pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
        }

        /// <summary>Sets a PF's Funded to an absolute value, lifting Validated if below it.</summary>
        private static void SetPfFunded(IOrganizationService service, ITracingService tracing, Guid pfId, decimal funded)
        {
            var pf = service.Retrieve(EntityNames.PrioritizationFunding, pfId,
                new ColumnSet(PrioritizationFundingAttributes.FundedAmount, PrioritizationFundingAttributes.ValidatedAmount));
            decimal current = pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
            decimal validated = pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.ValidatedAmount) ?? 0m;

            var upd = new Entity(EntityNames.PrioritizationFunding, pfId);
            upd[PrioritizationFundingAttributes.FundedAmount] = funded;
            if (validated < funded) upd[PrioritizationFundingAttributes.ValidatedAmount] = funded;
            service.Update(upd);
            tracing.Trace($"SwapExecutor: credit PF {pfId} funded {current:N2} -> {funded:N2}.");
        }

        /// <summary>
        /// Direct credit Prio: its Funded will become Σ its active PFs (with the credit
        /// targets applied). If that exceeds Requested, raise Requested first so the
        /// entity-scoped "Requested vs Funded" business rule never sees Funded &gt; Requested.
        /// Itemized Prios are covered by RaiseItemizedDetails (detail Requested is lifted).
        /// </summary>
        private static void LiftRequestedForTargets(
            IOrganizationService service, ITracingService tracing, Guid prioId, Dictionary<Guid, decimal> targets)
        {
            var prio = service.Retrieve(EntityNames.Prioritization, prioId,
                new ColumnSet(PrioritizationAttributes.FundingMode, PrioritizationAttributes.RequestedAmount));
            if (prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode)?.Value == FundingModeValues.Itemized)
                return;

            var q = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(PrioritizationFundingAttributes.FundedAmount),
            };
            q.Criteria.AddCondition(PrioritizationFundingAttributes.Prioritization, ConditionOperator.Equal, prioId);
            q.Criteria.AddCondition(PrioritizationFundingAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            decimal expected = 0m;
            foreach (var pf in service.RetrieveMultiple(q).Entities)
                expected += targets.TryGetValue(pf.Id, out var t)
                    ? t
                    : pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;

            decimal requested = NumericHelper.ToDecimal(prio, PrioritizationAttributes.RequestedAmount) ?? 0m;
            if (expected <= requested) return;

            service.Update(new Entity(EntityNames.Prioritization, prioId)
            {
                [PrioritizationAttributes.RequestedAmount] = expected,
            });
            tracing.Trace($"SwapExecutor: Direct credit Prio {prioId} requested {requested:N2} -> {expected:N2} (covers new Funded).");
        }
    }
}
