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
    public static class TurnInFy27Executor
    {
        public static void Execute(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn,
            List<TurnInItemRecord> items)
        {
            var turnInId = turnIn.Id;

            var loas = TurnInLOAResolver.ResolveLOAsFy27(service, tracing, items);

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
                decimal amount = g.Sum(i => i.Amount);
                var pf = service.Retrieve(EntityNames.PrioritizationFunding, g.Key,
                    new ColumnSet(PrioritizationFundingAttributes.FundedAmount));
                decimal funded = pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
                if (amount > funded)
                    throw new InvalidPluginExecutionException(
                        $"Turn-In cannot execute: a Prioritization Funding holds only {funded:N2} funded but the " +
                        $"Turn-In takes {amount:N2} from it. It was likely reduced after the Turn-In was submitted.");

                service.Update(new Entity(EntityNames.PrioritizationFunding, g.Key)
                {
                    [PrioritizationFundingAttributes.FundedAmount] = funded - amount,
                });
                tracing.Trace($"FY27: PF {g.Key} funded {funded:N2} -> {funded - amount:N2}.");
            }

            foreach (var g in pfItems.GroupBy(i => i.RequirementFunding.Id))
            {
                decimal pulled = g.Sum(i => i.Amount);
                var rf = service.Retrieve(EntityNames.RequirementFunding, g.Key,
                    new ColumnSet(RequirementFundingAttributes.TDP));
                decimal tdp = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;
                if (pulled > tdp)
                    throw new InvalidPluginExecutionException(
                        $"Turn-In cannot execute: Requirement Funding TDP {tdp:N2} is less than the {pulled:N2} turned in from it.");

                var upd = FundingRollupHelper.BuildRFFundedUpdate(service, g.Key, tracing);
                upd[RequirementFundingAttributes.TDP] = tdp - pulled;
                service.Update(upd);
                tracing.Trace($"FY27: RF {g.Key} TDP {tdp:N2} -> {tdp - pulled:N2}.");
            }

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
            var q = new QueryExpression(TurnInDetailReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    TurnInDetailReductionAttributes.Amount,
                    TurnInDetailReductionAttributes.ItemizedDetail),
            };
            q.Criteria.AddCondition(TurnInDetailReductionAttributes.TurnIn, ConditionOperator.Equal, turnInId);
            q.Criteria.AddCondition(TurnInDetailReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var rows = service.RetrieveMultiple(q).Entities;
            if (rows.Count == 0) { tracing.Trace("FY27: no itemized detail reductions."); return; }

            foreach (var row in rows)
            {
                var detailRef = row.GetAttributeValue<EntityReference>(TurnInDetailReductionAttributes.ItemizedDetail);
                decimal reduceBy = row.GetAttributeValue<decimal?>(TurnInDetailReductionAttributes.Amount) ?? 0m;
                if (detailRef == null || reduceBy <= 0m) continue;

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.FundedAmount, ItemizedDetailsAttributes.RequestedAmount));
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                decimal requested = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.RequestedAmount) ?? 0m;
                if (reduceBy > funded)
                    throw new InvalidPluginExecutionException(
                        $"Turn-In cannot execute: an Itemized Detail holds {funded:N2} funded but a reduction of " +
                        $"{reduceBy:N2} was entered. Re-balance the detail reductions.");

                service.Update(new Entity(EntityNames.ItemizedDetails, detailRef.Id)
                {
                    [ItemizedDetailsAttributes.FundedAmount] = funded - reduceBy,
                    [ItemizedDetailsAttributes.RequestedAmount] = Math.Max(0m, requested - reduceBy),
                });
                tracing.Trace($"FY27: ItemizedDetail {detailRef.Id} funded {funded:N2} -> {funded - reduceBy:N2}.");
            }
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
                    g.Sum(i => i.Amount), allowChildFunded: false, operationLabel: "Turn-In");
            }

            var q = new QueryExpression(TurnInRdfReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    TurnInRdfReductionAttributes.Amount,
                    TurnInRdfReductionAttributes.RequirementDetailFunding),
            };
            q.Criteria.AddCondition(TurnInRdfReductionAttributes.TurnIn, ConditionOperator.Equal, turnInId);
            q.Criteria.AddCondition(TurnInRdfReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var rfs = new HashSet<Guid>();
            foreach (var row in service.RetrieveMultiple(q).Entities)
            {
                var rdfRef = row.GetAttributeValue<EntityReference>(TurnInRdfReductionAttributes.RequirementDetailFunding);
                decimal reduceBy = row.GetAttributeValue<decimal?>(TurnInRdfReductionAttributes.Amount) ?? 0m;
                if (rdfRef == null || reduceBy <= 0m) continue;

                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, rdfRef.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.FundedAmount,
                                  RequirementDetailFundingAttributes.RequirementDetail,
                                  RequirementDetailFundingAttributes.RequirementFunding));
                decimal funded = rdf.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
                if (reduceBy > funded)
                    throw new InvalidPluginExecutionException(
                        $"Turn-In cannot execute: a Requirement Detail Funding holds {funded:N2} funded but a " +
                        $"reduction of {reduceBy:N2} was entered. Re-balance the Requirement Detail reductions.");

                service.Update(new Entity(EntityNames.RequirementDetailFunding, rdfRef.Id)
                {
                    [RequirementDetailFundingAttributes.FundedAmount] = funded - reduceBy,
                });

                var rd = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementDetail);
                if (rd != null)
                    FundingRollupHelper.RecalculateRequirementDetail(service, rd.Id, tracing);
                var rf = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
                if (rf != null) rfs.Add(rf.Id);
                tracing.Trace($"FY27: RDF {rdfRef.Id} funded {funded:N2} -> {funded - reduceBy:N2}.");
            }

            foreach (var rfId in rfs)
                FundingRollupHelper.RecalculateRFFunded(service, rfId, tracing);
        }
    }
}
