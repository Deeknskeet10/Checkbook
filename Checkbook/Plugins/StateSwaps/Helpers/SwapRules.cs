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
    /// One active FY27 swap item: a PF → PF leg.
    /// </summary>
    public sealed class SwapLeg
    {
        public Guid SwapItemId;
        public decimal Amount;
        public EntityReference DebitPF;
        public EntityReference CreditPF;
    }

    /// <summary>
    /// Approval-time rules for an FY27+ (PF → PF) State Swap, run by SwapValidator in place
    /// of the legacy per-Prio overdraw check. See docs/StateSwap-FY27-Redesign.md §5.2.
    /// SwapItemDerivedFieldsPlugin checks each leg at save; balances can move between save
    /// and approval, so everything is re-checked here against live data.
    /// </summary>
    public static class SwapRules
    {
        private const decimal Epsilon = 0.005m;

        /// <summary>True for an FY26-or-earlier (or FY-less) swap — the Prio-level path.</summary>
        public static bool IsLegacy(Entity swap)
        {
            return FiscalYearHelper.IsLegacyFiscalYear(
                swap.GetAttributeValue<OptionSetValue>(StateSwapAttributes.FiscalYear)?.Value);
        }

        public static List<SwapLeg> LoadLegs(IOrganizationService service, Guid swapId)
        {
            var q = new QueryExpression(EntityNames.SwapItem)
            {
                ColumnSet = new ColumnSet(
                    SwapItemAttributes.Amount,
                    SwapItemAttributes.DebitPrioritizationFunding,
                    SwapItemAttributes.CreditPrioritizationFunding),
            };
            q.Criteria.AddCondition(SwapItemAttributes.StateSwap, ConditionOperator.Equal, swapId);
            q.Criteria.AddCondition(SwapItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            return service.RetrieveMultiple(q).Entities.Select(r => new SwapLeg
            {
                SwapItemId = r.Id,
                Amount = r.GetAttributeValue<decimal?>(SwapItemAttributes.Amount) ?? 0m,
                DebitPF = r.GetAttributeValue<EntityReference>(SwapItemAttributes.DebitPrioritizationFunding),
                CreditPF = r.GetAttributeValue<EntityReference>(SwapItemAttributes.CreditPrioritizationFunding),
            }).ToList();
        }

        public static void Validate(IOrganizationService service, ITracingService tracing, Guid swapId)
        {
            var legs = LoadLegs(service, swapId);
            if (legs.Count == 0)
                throw new InvalidPluginExecutionException(
                    "State Swap has no active Swap Items. Add at least one item before approving.");
            if (legs.Any(l => l.DebitPF == null || l.CreditPF == null))
                throw new InvalidPluginExecutionException(
                    "Every Swap Item on an FY27 State Swap must name both the Prioritization Funding it sends from " +
                    "and the Prioritization Funding it sends to before the swap can be approved.");
            if (legs.Any(l => l.Amount <= 0m))
                throw new InvalidPluginExecutionException("Swap Item amounts must be greater than zero.");

            var pfs = SwapPfContext.Load(service, legs.SelectMany(l => new[] { l.DebitPF.Id, l.CreditPF.Id }));

            foreach (var leg in legs)
            {
                if (!pfs.TryGetValue(leg.DebitPF.Id, out var debit) || !pfs.TryGetValue(leg.CreditPF.Id, out var credit))
                    throw new InvalidPluginExecutionException(
                        "A Swap Item points at a Prioritization Funding that no longer exists.");
                var reason = debit.UnusableReason() ?? credit.UnusableReason();
                if (reason != null)
                    throw new InvalidPluginExecutionException($"This State Swap cannot be approved: {reason}.");
                if (debit.State.Id == credit.State.Id)
                    throw new InvalidPluginExecutionException(
                        "A Swap Item sends and receives within the same State.");
                if (debit.Fund.Id != credit.Fund.Id || debit.PG.Id != credit.PG.Id)
                    throw new InvalidPluginExecutionException(
                        $"A Swap Item moves money from {debit.Label} to {credit.Label}, which are on different Funds or PGs. " +
                        "Each item must stay within one Fund and PG.");
            }

            ValidatePfAvailability(tracing, legs, pfs);

            // Σ legs out of / into each itemized Prio must be matched by its detail rows.
            var outByPrio = SumByPrio(legs, pfs, l => l.DebitPF.Id);
            var inByPrio = SumByPrio(legs, pfs, l => l.CreditPF.Id);
            var itemized = new HashSet<Guid>(pfs.Values.Where(p => p.PrioItemized).Select(p => p.Prioritization.Id));

            ValidateDetailBalance(service, tracing, swapId,
                SwapDetailReductionAttributes.EntityLogicalName, SwapDetailReductionAttributes.StateSwap,
                SwapDetailReductionAttributes.ItemizedDetail, SwapDetailReductionAttributes.Amount,
                outByPrio.Where(kv => itemized.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value),
                isReduction: true);
            ValidateDetailBalance(service, tracing, swapId,
                SwapDetailIncreaseAttributes.EntityLogicalName, SwapDetailIncreaseAttributes.StateSwap,
                SwapDetailIncreaseAttributes.ItemizedDetail, SwapDetailIncreaseAttributes.Amount,
                inByPrio.Where(kv => itemized.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value),
                isReduction: false);
        }

        /// <summary>
        /// Per debit PF, Σ legs out ≤ its Funded. Incoming legs to the same PF don't count:
        /// the executor takes every debit before it raises any credit.
        /// </summary>
        private static void ValidatePfAvailability(
            ITracingService tracing, List<SwapLeg> legs, Dictionary<Guid, SwapPfContext> pfs)
        {
            foreach (var g in legs.GroupBy(l => l.DebitPF.Id))
            {
                var pf = pfs[g.Key];
                decimal sending = g.Sum(l => l.Amount);
                tracing.Trace($"SwapRules: PF {g.Key} funded={pf.Funded:N2}, sending={sending:N2}.");
                if (sending > pf.Funded + Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"The State Swap sends {sending:N2} from Prioritization Funding {pf.Label}, " +
                        $"which holds only {pf.Funded:N2} funded.");
            }
        }

        private static Dictionary<Guid, decimal> SumByPrio(
            List<SwapLeg> legs, Dictionary<Guid, SwapPfContext> pfs, Func<SwapLeg, Guid> pfOf)
        {
            return legs.GroupBy(l => pfs[pfOf(l)].Prioritization.Id)
                       .ToDictionary(g => g.Key, g => g.Sum(l => l.Amount));
        }

        /// <summary>
        /// For each itemized Prio the swap debits (reductions) or credits (increases), Σ detail
        /// rows on that Prio's details must equal Σ legs out of / into it. Rows on any other
        /// Prio (a Direct Prio, or one the swap doesn't touch on that side) are rejected.
        /// A reduction must fit the detail's Funded.
        /// </summary>
        private static void ValidateDetailBalance(
            IOrganizationService service, ITracingService tracing, Guid swapId,
            string entity, string parentAttr, string detailAttr, string amountAttr,
            Dictionary<Guid, decimal> requiredByPrio, bool isReduction)
        {
            string verb = isReduction ? "reduce" : "increase";
            string side = isReduction ? "sends from" : "sends to";

            var rows = JunctionFundingHelper.LoadAdjustments(service, entity, parentAttr, swapId, detailAttr, amountAttr);
            var gotByPrio = new Dictionary<Guid, decimal>();
            foreach (var row in rows)
            {
                if (row.Target == null)
                    throw new InvalidPluginExecutionException(
                        $"A Swap Detail {(isReduction ? "Reduction" : "Increase")} has no Itemized Detail selected.");
                if (row.Amount <= 0m)
                    throw new InvalidPluginExecutionException("Swap detail adjustment amounts must be greater than zero.");

                var detail = service.Retrieve(EntityNames.ItemizedDetails, row.Target.Id,
                    new ColumnSet(ItemizedDetailsAttributes.Prioritization, ItemizedDetailsAttributes.FundedAmount));
                var prio = detail.GetAttributeValue<EntityReference>(ItemizedDetailsAttributes.Prioritization);
                if (prio == null || !requiredByPrio.ContainsKey(prio.Id))
                    throw new InvalidPluginExecutionException(
                        $"A selected Itemized Detail does not belong to an itemized Prioritization this State Swap {side}.");

                if (isReduction)
                {
                    decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                    if (row.Amount > funded + Epsilon)
                        throw new InvalidPluginExecutionException(
                            $"An Itemized Detail holds {funded:N2} funded but a reduction of {row.Amount:N2} was entered.");
                }
                gotByPrio[prio.Id] = (gotByPrio.TryGetValue(prio.Id, out var x) ? x : 0m) + row.Amount;
            }

            foreach (var kv in requiredByPrio)
            {
                decimal got = gotByPrio.TryGetValue(kv.Key, out var g) ? g : 0m;
                tracing.Trace($"SwapRules: itemized Prio {kv.Key} {verb} required={kv.Value:N2}, entered={got:N2}.");
                if (Math.Abs(got - kv.Value) >= Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"This State Swap sends {kv.Value:N2} {(isReduction ? "from" : "to")} an itemized Prioritization. Before it can be " +
                        $"approved, {verb} its Itemized Details by a total of {kv.Value:N2} (currently {got:N2}).");
            }
        }
    }
}
