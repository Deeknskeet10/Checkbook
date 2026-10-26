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
    /// Financial side effects of an approved FY27+ item-based Turn-In
    /// (docs/TurnIn-FY27-Redesign.md). Called by TurnInApprovalPlugin once the Turn-In is
    /// ready to execute; TurnInValidator has already enforced the balance rules.
    ///
    /// FY27 money lives on junctions, so the Turn-In reduces those — never a raw total
    /// that the next roll-up would restore:
    ///   1. Ledger: debit each source LOA, credit the ARNG LOA with the same Fund + PG/SAG.
    ///   2. Distributions: one AFP / Allotment pair per (Fund, PG) from per-item amounts.
    ///   3. Prioritization items: lower each PF junction, re-sum the RF and lower its TDP
    ///      by the same amount, re-sum Direct Prios and lower their Requested.
    ///   4. Itemized detail reductions: lower Funded and Requested on the selected details
    ///      (PrioritizationItemizedRollup re-sums the Prio).
    ///   5. RF-level items: Withholding first, then Funded + TDP; RDF reductions bring
    ///      Σ RDF back in line with the RF's Funded.
    ///   6. Recalculate every touched LOA's TDP.
    /// Funded reductions are authorized by FundedAmountLockBase (book_turnin ancestor).
    /// </summary>
    public static class TurnInExecutor
    {
        private const string Label = "Turn-In";

        public static void Execute(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn,
            List<TurnInItemRecord> items)
        {
            var turnInId = turnIn.Id;

            var loas = TurnInLOAResolver.ResolveLOAsForItems(service, tracing, items);

            tracing.Trace("FY27: creating ledger entries...");
            LedgerCreator.CreateTurnInEntries(service, tracing, turnInId, loas.DebitLOAs, loas.CreditLOAs);

            tracing.Trace("FY27: creating distributions...");
            TurnInDistributionCreator.CreateDistributionsByItems(service, tracing, turnIn, items);

            ReducePrioritizationFunding(service, tracing, items);
            ApplyDetailReductions(service, tracing, turnInId);
            ReduceRequirementFundingLevel(service, tracing, items, turnInId);

            foreach (var loaId in loas.DebitLOAs.Keys.Select(r => r.Id)
                         .Concat(loas.CreditLOAs.Keys.Select(r => r.Id)).Distinct())
            {
                tracing.Trace($"FY27: recalculating LOA {loaId} TDP.");
                TDPCalculationHelper.RecalculateLOATDP(service, loaId, tracing);
            }
        }

        /// <summary>
        /// Prioritization items (PF junction set): PF −amount; then per RF, Funded re-summed
        /// from the junctions and TDP lowered by the pulled total in ONE update (the "Funded vs
        /// TDP" business rule is entity-scoped); then Direct Prios re-summed from their
        /// junctions with Requested lowered by the amount turned in.
        /// </summary>
        private static void ReducePrioritizationFunding(
            IOrganizationService service, ITracingService tracing, List<TurnInItemRecord> items)
        {
            var pfItems = items.Where(i => i.PrioritizationFunding != null).ToList();
            if (pfItems.Count == 0) { tracing.Trace("FY27: no Prioritization Funding items."); return; }

            foreach (var g in pfItems.GroupBy(i => i.PrioritizationFunding.Id))
            {
                var pf = service.Retrieve(EntityNames.PrioritizationFunding, g.Key,
                    new ColumnSet(PrioritizationFundingAttributes.FundedAmount));
                JunctionFundingHelper.ReduceJunction(service, tracing,
                    EntityNames.PrioritizationFunding, PrioritizationFundingAttributes.FundedAmount, g.Key,
                    pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m,
                    g.Sum(i => i.Amount), Label, "Prioritization Funding");
            }

            foreach (var g in pfItems.GroupBy(i => i.RequirementFunding.Id))
                JunctionFundingHelper.LowerRfTdp(service, tracing, g.Key, g.Sum(i => i.Amount), Label);

            foreach (var g in pfItems.GroupBy(i => i.Prioritization.Id))
            {
                decimal amount = g.Sum(i => i.Amount);
                var prio = service.Retrieve(EntityNames.Prioritization, g.Key,
                    new ColumnSet(PrioritizationAttributes.FundingMode));
                if (prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode)?.Value
                    == FundingModeValues.Itemized)
                {
                    // Total and Requested follow the detail reductions (ApplyDetailReductions).
                    continue;
                }

                FundingRollupHelper.RecalculatePrioritizationFunded(service, g.Key, tracing);

                // The state is saying it does not need these funds — the request shrinks too.
                var after = service.Retrieve(EntityNames.Prioritization, g.Key,
                    new ColumnSet(PrioritizationAttributes.RequestedAmount));
                decimal requested = NumericHelper.ToDecimal(after, PrioritizationAttributes.RequestedAmount) ?? 0m;
                decimal newRequested = Math.Max(0m, requested - amount);
                service.Update(new Entity(EntityNames.Prioritization, g.Key)
                {
                    [PrioritizationAttributes.RequestedAmount] = newRequested,
                });
                tracing.Trace($"FY27: Direct Prio {g.Key} requested {requested:N2} -> {newRequested:N2}.");
            }
        }

        /// <summary>
        /// Itemized Prioritizations: lower each selected detail's Funded and Requested by its
        /// book_turnindetailreduction amount. PrioritizationItemizedRollup (no depth guard)
        /// re-sums the Prio's Requested / Validated / Funded from the details.
        /// </summary>
        private static void ApplyDetailReductions(
            IOrganizationService service, ITracingService tracing, Guid turnInId)
        {
            var rows = JunctionFundingHelper.LoadAdjustments(service,
                TurnInDetailReductionAttributes.EntityLogicalName,
                TurnInDetailReductionAttributes.TurnIn, turnInId,
                TurnInDetailReductionAttributes.ItemizedDetail,
                TurnInDetailReductionAttributes.Amount);
            if (rows.Count == 0) { tracing.Trace("FY27: no itemized detail reductions."); return; }

            JunctionFundingHelper.ReduceItemizedDetails(service, tracing, rows, lowerRequested: true, operationLabel: Label);
        }

        /// <summary>
        /// RF-level items: Withholding first, then Funded + TDP (shared with the RF→RF
        /// realignment leg). On a direct-funded RF the Funded part comes out of the selected
        /// Requirement Detail Funding junctions, after which the RD and RF are re-summed.
        /// </summary>
        private static void ReduceRequirementFundingLevel(
            IOrganizationService service, ITracingService tracing, List<TurnInItemRecord> items, Guid turnInId)
        {
            var rfItems = items.Where(i => i.IsRFOnly).ToList();
            if (rfItems.Count == 0) { tracing.Trace("FY27: no RF-level items."); return; }

            foreach (var g in rfItems.GroupBy(i => i.RequirementFunding.Id))
            {
                RequirementFundingHelper.ApplyDebit(
                    service, tracing, new EntityReference(EntityNames.RequirementFunding, g.Key),
                    g.Sum(i => i.Amount), allowChildFunded: false, operationLabel: Label);
            }

            var rows = JunctionFundingHelper.LoadAdjustments(service,
                TurnInRdfReductionAttributes.EntityLogicalName,
                TurnInRdfReductionAttributes.TurnIn, turnInId,
                TurnInRdfReductionAttributes.RequirementDetailFunding,
                TurnInRdfReductionAttributes.Amount);
            JunctionFundingHelper.ReduceRequirementDetailFundings(service, tracing, rows, Label);
        }
    }
}
