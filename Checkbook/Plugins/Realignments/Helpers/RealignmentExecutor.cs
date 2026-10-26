using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Realignments.Helpers
{
    /// <summary>
    /// Executes an approved item-based (FY27+) realignment: each active
    /// book_realignmentitem is one PF-/RDF-granular Fund/SAG move. Called by
    /// <see cref="RealignmentProcessor"/>, which gates approval and deactivates.
    /// Legacy single-row realignments run <see cref="RealignmentExecutorLegacy"/>.
    /// Junction / detail primitives live in <see cref="JunctionFundingHelper"/>.
    /// See docs/Realignment-FY27-Redesign.md.
    /// </summary>
    public static class RealignmentExecutor
    {
        private const string Label = "Realignment";

        public static void Execute(IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            // Order matters (see ProcessItems / MovePfJunction):
            //  1) ProcessItems — debit side frees RF/LOA TDP, credit RF.TDP is bumped;
            //     UpsertPrioritizationFunding runs only for a Direct credit Prio.
            //  2) ApplyDetailIncreases — raise the crediting Itemized Prio's details, so
            //     PrioritizationItemizedRollup lifts its Prio total and SingleRfAutoAllocate
            //     syncs the credit junction (now within both the raised total and the bumped
            //     RF.TDP). No-op for a Direct credit Prio.
            //  3) ApplyDetailReductions — lower the debiting Itemized Prio's details to match
            //     the junctions the moves already reduced.
            //  4) ApplyRdfIncreases / ApplyRdfReductions — OPR (RF→RF) items on direct-funded
            //     Requirements: fund the credit RF's Requirement Details (after its TDP bump),
            //     then lower the debit RF's RDF junctions to the Funded it already gave up.
            ProcessItems(service, tracing, realignmentId);
            ApplyDetailIncreases(service, tracing, realignmentId);
            ApplyDetailReductions(service, tracing, realignmentId);
            ApplyRdfIncreases(service, tracing, realignmentId);
            ApplyRdfReductions(service, tracing, realignmentId);
        }

        internal static bool HasActiveItems(IOrganizationService service, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return service.RetrieveMultiple(q).Entities.Count > 0;
        }

        private static System.Collections.Generic.List<Entity> GetActiveItems(
            IOrganizationService service, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentItemAttributes.Amount,
                    RealignmentItemAttributes.DebitPrioritizationFunding,
                    RealignmentItemAttributes.DebitRequirementDetailFunding,
                    RealignmentItemAttributes.DebitRequirementFunding,
                    RealignmentItemAttributes.CreditRequirementFunding,
                    RealignmentItemAttributes.SameFundandSAG),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return new System.Collections.Generic.List<Entity>(service.RetrieveMultiple(q).Entities);
        }

        private static void ProcessItems(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var realignment = service.Retrieve(EntityNames.Realignments, realignmentId,
                new ColumnSet(RealignmentsAttributes.CreditedPrioritization));
            var creditPrio = realignment.GetAttributeValue<EntityReference>(
                RealignmentsAttributes.CreditedPrioritization);

            // When the crediting Prioritization is Itemized, its PF junctions are
            // owned by the detail roll-up (+ PrioritizationSingleRfAutoAllocate for
            // the single-RF case), NOT by UpsertPrioritizationFunding. Crediting then
            // flows as: bump the credit RF.TDP here, raise the credit details afterwards
            // (ApplyDetailIncreases) so the roll-up lifts the Prio total and the
            // single-RF auto-allocate syncs the junction — so we must SKIP the credit
            // upsert for those items (it would double the credit, and raising it before
            // the details are up trips the Σ PF ≤ Prio-total cap).
            bool creditPrioItemized = false;
            if (creditPrio != null)
            {
                var cp = service.Retrieve(EntityNames.Prioritization, creditPrio.Id,
                    new ColumnSet(PrioritizationAttributes.FundingMode));
                creditPrioItemized = cp.GetAttributeValue<OptionSetValue>(
                    PrioritizationAttributes.FundingMode)?.Value == FundingModeValues.Itemized;

                // The single-RF auto-allocate is what re-syncs the itemized credit
                // junction. A multi-RF itemized credit Prio would leave Σ PF short
                // (auto-allocate no-ops) — not supported on this path yet.
                if (creditPrioItemized && JunctionFundingHelper.CountActivePrioritizationFunding(service, creditPrio.Id) > 1)
                    throw new InvalidPluginExecutionException(
                        "Crediting into an itemized Prioritization that already splits across multiple " +
                        "Requirement Fundings is not supported by this realignment path. Use a single-RF " +
                        "credit Prioritization or a direct-funded one.");
            }

            var items = GetActiveItems(service, realignmentId);
            tracing.Trace(
                $"ProcessItems: processing {items.Count} active realignment item(s) " +
                $"(creditPrioItemized={creditPrioItemized}).");
            foreach (var item in items)
                ProcessItem(service, tracing, item, creditPrio, creditPrioItemized, realignmentId);
        }

        /// <summary>
        /// Reduces each selected ItemizedDetail's Funded amount by its
        /// book_realignmentdetailreduction amount (Requested unchanged).
        /// </summary>
        private static void ApplyDetailReductions(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var rows = JunctionFundingHelper.LoadAdjustments(service,
                RealignmentDetailReductionAttributes.EntityLogicalName,
                RealignmentDetailReductionAttributes.Realignment, realignmentId,
                RealignmentDetailReductionAttributes.ItemizedDetail,
                RealignmentDetailReductionAttributes.Amount);
            if (rows.Count == 0) { tracing.Trace("ApplyDetailReductions: no detail reductions on this realignment."); return; }

            JunctionFundingHelper.ReduceItemizedDetails(service, tracing, rows, lowerRequested: false, operationLabel: Label);
        }

        /// <summary>
        /// Credit-side mirror of <see cref="ApplyDetailReductions"/>. Raises each selected
        /// ItemizedDetail's Funded by its book_realignmentdetailincrease amount so the crediting
        /// Itemized Prioritization's total is already up before the junction sync. Validated to
        /// balance by RealignmentValidator.EnforceItemizedCreditBalance.
        /// </summary>
        private static void ApplyDetailIncreases(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var rows = JunctionFundingHelper.LoadAdjustments(service,
                RealignmentDetailIncreaseAttributes.EntityLogicalName,
                RealignmentDetailIncreaseAttributes.Realignment, realignmentId,
                RealignmentDetailIncreaseAttributes.ItemizedDetail,
                RealignmentDetailIncreaseAttributes.Amount);
            if (rows.Count == 0) { tracing.Trace("ApplyDetailIncreases: no detail increases on this realignment."); return; }

            JunctionFundingHelper.RaiseItemizedDetails(service, tracing, rows, Label);
        }

        /// <summary>
        /// OPR credit side (FY27 §9.9): for each book_realignmentrdfincrease, get-or-create the
        /// RD ↔ credit RF junction and raise it. Runs after ProcessItems so the credit RF.TDP
        /// already carries the landing amount (the RDF guard caps Σ RDF at RF.TDP). The RDF
        /// rollup is depth-guarded off here, so RF and RD totals are recalculated explicitly.
        /// </summary>
        private static void ApplyRdfIncreases(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentRdfIncreaseAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentRdfIncreaseAttributes.Amount,
                    RealignmentRdfIncreaseAttributes.RequirementDetail,
                    RealignmentRdfIncreaseAttributes.RequirementFunding),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentRdfIncreaseAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentRdfIncreaseAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rows = service.RetrieveMultiple(q).Entities;
            if (rows.Count == 0) { tracing.Trace("ApplyRdfIncreases: no RD funding increases on this realignment."); return; }

            var rfs = new System.Collections.Generic.HashSet<Guid>();
            foreach (var row in rows)
            {
                var rd = row.GetAttributeValue<EntityReference>(RealignmentRdfIncreaseAttributes.RequirementDetail);
                var rf = row.GetAttributeValue<EntityReference>(RealignmentRdfIncreaseAttributes.RequirementFunding);
                decimal raiseBy = row.GetAttributeValue<decimal?>(RealignmentRdfIncreaseAttributes.Amount) ?? 0m;
                if (rd == null || rf == null || raiseBy <= 0m) continue;

                JunctionFundingHelper.UpsertRequirementDetailFunding(service, tracing, rd, rf, raiseBy);
                FundingRollupHelper.RecalculateRequirementDetail(service, rd.Id, tracing);
                rfs.Add(rf.Id);
                tracing.Trace($"ApplyRdfIncreases: RD {rd.Id} on RF {rf.Id} +{raiseBy:N2}.");
            }
            foreach (var rfId in rfs)
                FundingRollupHelper.RecalculateRFFunded(service, rfId, tracing);
        }

        /// <summary>
        /// OPR debit side (FY27 §9.9): lower each selected Requirement Detail Funding junction
        /// on the debit RF by its book_realignmentrdfreduction amount. RequirementFundingHelper.ApplyDebit
        /// already took the same total out of the RF's Funded (validated by EnforceRdfDebitBalance),
        /// so this brings Σ RDF back in line; the RF is then re-summed from its junctions.
        /// </summary>
        private static void ApplyRdfReductions(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var rows = JunctionFundingHelper.LoadAdjustments(service,
                RealignmentRdfReductionAttributes.EntityLogicalName,
                RealignmentRdfReductionAttributes.Realignment, realignmentId,
                RealignmentRdfReductionAttributes.RequirementDetailFunding,
                RealignmentRdfReductionAttributes.Amount);
            if (rows.Count == 0) { tracing.Trace("ApplyRdfReductions: no RD funding reductions on this realignment."); return; }

            JunctionFundingHelper.ReduceRequirementDetailFundings(service, tracing, rows, Label);
        }

        /// <summary>
        /// Executes one Fund/SAG move. The debit source is exactly one of a
        /// Prioritization Funding (State path), a Requirement Detail Funding
        /// (direct path), or a Requirement Funding (plain RF→RF); the credit always
        /// lands on the item's credit RF. Moves the junction amount (and RF.TDP for
        /// cross-RF), creating the ledger pair + A18 distributions for cross-LOA /
        /// cross-Fund-SAG moves. The junction rollups are depth-guarded off at this
        /// depth, so RF/Prio totals are recalculated explicitly.
        /// </summary>
        private static void ProcessItem(
            IOrganizationService service, ITracingService tracing,
            Entity item, EntityReference creditPrio, bool creditPrioItemized, Guid realignmentId)
        {
            decimal amount = item.GetAttributeValue<decimal?>(RealignmentItemAttributes.Amount) ?? 0m;
            if (amount <= 0m) { tracing.Trace("Item amount <= 0; skipping."); return; }

            var debitPf = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitPrioritizationFunding);
            var debitRdf = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitRequirementDetailFunding);
            var debitRfDirect = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitRequirementFunding);
            var creditRf = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.CreditRequirementFunding);
            bool sameFundSag = item.GetAttributeValue<bool>(RealignmentItemAttributes.SameFundandSAG);

            if (creditRf == null)
                throw new InvalidPluginExecutionException(
                    "A Realignment Item has no Credit Requirement Funding; cannot execute.");

            EntityReference debitRf;
            EntityReference debitPrio = null;
            EntityReference debitRd = null;
            decimal debitJunctionFunded = 0m;

            if (debitPf != null)
            {
                var pf = service.Retrieve(EntityNames.PrioritizationFunding, debitPf.Id,
                    new ColumnSet(PrioritizationFundingAttributes.RequirementFunding,
                                  PrioritizationFundingAttributes.Prioritization,
                                  PrioritizationFundingAttributes.FundedAmount));
                debitRf = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.RequirementFunding);
                debitPrio = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization);
                debitJunctionFunded = pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
            }
            else if (debitRdf != null)
            {
                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, debitRdf.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.RequirementFunding,
                                  RequirementDetailFundingAttributes.RequirementDetail,
                                  RequirementDetailFundingAttributes.FundedAmount));
                debitRf = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
                debitRd = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementDetail);
                debitJunctionFunded = rdf.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
            }
            else if (debitRfDirect != null)
            {
                debitRf = debitRfDirect;
            }
            else
            {
                throw new InvalidPluginExecutionException("A Realignment Item has no debit source; cannot execute.");
            }

            if (debitRf == null)
                throw new InvalidPluginExecutionException(
                    "The Realignment Item's debit source does not resolve to a Requirement Funding.");

            var debitLoa = RequirementFundingHelper.GetLoa(service, debitRf.Id);
            var creditLoa = RequirementFundingHelper.GetLoa(service, creditRf.Id);
            bool crossLoa = debitLoa != null && creditLoa != null && debitLoa.Id != creditLoa.Id;
            bool sameRf = debitRf.Id == creditRf.Id;

            // 1) Ledger-first for cross-LOA; intermediate recalc without enforcement.
            if (crossLoa)
            {
                LedgerCreator.CreateRealignmentPair(service, tracing, debitLoa, creditLoa, amount, realignmentId);
                TDPCalculationHelper.RecalculateLOATDP(service, debitLoa.Id, tracing, enforceNonNegative: false);
                TDPCalculationHelper.RecalculateLOATDP(service, creditLoa.Id, tracing, enforceNonNegative: false);
            }

            // 2) Junction + RF.TDP movement, per debit-unit shape.
            if (debitPf != null)
            {
                MovePfJunction(service, tracing, debitPf, debitJunctionFunded, debitRf, creditPrio, creditRf, amount, sameRf, creditPrioItemized);
                if (debitPrio != null)
                    FundingRollupHelper.RecalculatePrioritizationFunded(service, debitPrio.Id, tracing);
                if (creditPrio != null)
                    FundingRollupHelper.RecalculatePrioritizationFunded(service, creditPrio.Id, tracing);
            }
            else if (debitRdf != null)
            {
                MoveRdfJunction(service, tracing, debitRdf, debitJunctionFunded, debitRd, debitRf, creditRf, amount, sameRf);
            }
            else
            {
                if (!sameRf)
                {
                    RequirementFundingHelper.ApplyDebit(service, tracing, debitRf, amount, false, Label);
                    RequirementFundingHelper.BumpTdp(service, tracing, creditRf.Id, amount);
                }
            }

            // 3) Settle LOA TDP (cross-LOA) with enforcement.
            if (crossLoa)
            {
                TDPCalculationHelper.RecalculateLOATDP(service, debitLoa.Id, tracing);
                TDPCalculationHelper.RecalculateLOATDP(service, creditLoa.Id, tracing);
            }

            // 4) Cross-Fund/SAG: A18 round-trip AFP/Allotment distributions.
            if (!sameFundSag)
            {
                var debitAnchorFc = debitPrio != null
                    ? FundCenterWalkHelper.GetAnchorFundCenter(service, EntityNames.Prioritization, debitPrio, PrioritizationAttributes.FundCenter)
                    : FundCenterWalkHelper.GetRequirementFundingFundCenter(service, debitRf);
                var creditAnchorFc = creditPrio != null
                    ? FundCenterWalkHelper.GetAnchorFundCenter(service, EntityNames.Prioritization, creditPrio, PrioritizationAttributes.FundCenter)
                    : FundCenterWalkHelper.GetRequirementFundingFundCenter(service, creditRf);

                RealignmentDistributionCreator.CreateDistributions(
                    service, tracing, realignmentId,
                    debitAnchorFc, creditAnchorFc, debitLoa, creditLoa, amount);
            }
        }

        /// <summary>State-path move: debit PF −amount; credit Prio↔creditRF PF +amount.</summary>
        private static void MovePfJunction(
            IOrganizationService service, ITracingService tracing,
            EntityReference debitPf, decimal debitPfFunded, EntityReference debitRf,
            EntityReference creditPrio, EntityReference creditRf, decimal amount, bool sameRf,
            bool creditPrioItemized)
        {
            if (creditPrio == null)
                throw new InvalidPluginExecutionException(
                    "A State-path Realignment Item has no Credit Prioritization on the parent Realignment.");

            // Free the debit side BEFORE raising the credit side so real TDP headroom
            // always exists for the credit RF.TDP increase. For cross-LOA moves the credit
            // LOA's headroom comes from the ledger created in ProcessItem; for same-LOA
            // moves it comes from the debit RF.TDP reduction.
            JunctionFundingHelper.ReduceJunction(service, tracing,
                EntityNames.PrioritizationFunding, PrioritizationFundingAttributes.FundedAmount,
                debitPf.Id, debitPfFunded, amount, Label, "Prioritization Funding");
            JunctionFundingHelper.MoveRfTdp(service, tracing, debitRf.Id, creditRf.Id, amount, Label);

            // Add/raise the credit junction (RF.TDP cap now satisfied) — ONLY for a
            // Direct credit Prio. For an Itemized credit Prio the junction is owned by
            // the detail roll-up + SingleRfAutoAllocate: ApplyDetailIncreases (run after
            // this, once RF.TDP is bumped) raises the details, lifting the Prio total and
            // syncing the junction. Upserting here would double the credit and, before the
            // details are raised, breach the Σ PF ≤ Prio-total cap.
            if (!creditPrioItemized)
                JunctionFundingHelper.UpsertPrioritizationFunding(service, tracing, creditPrio, creditRf, amount);
            else
                tracing.Trace("MovePfJunction: itemized credit Prio — deferring credit junction to detail increase + auto-allocate.");

            // Refresh the credit RF funded from its junctions (same RF when in-house).
            // For the itemized-credit case the authoritative refresh happens when
            // auto-allocate syncs the junction; this is a harmless pre-pass.
            FundingRollupHelper.RecalculateRFFunded(service, sameRf ? debitRf.Id : creditRf.Id, tracing);
        }

        /// <summary>Direct-path move: debit RDF −amount; same RD ↔ creditRF RDF +amount.</summary>
        private static void MoveRdfJunction(
            IOrganizationService service, ITracingService tracing,
            EntityReference debitRdf, decimal debitRdfFunded, EntityReference debitRd,
            EntityReference debitRf, EntityReference creditRf, decimal amount, bool sameRf)
        {
            if (debitRd == null)
                throw new InvalidPluginExecutionException(
                    "A direct-path Realignment Item's debit Requirement Detail Funding has no Requirement Detail.");

            // Free the debit side before raising the credit side (see MovePfJunction).
            JunctionFundingHelper.ReduceJunction(service, tracing,
                EntityNames.RequirementDetailFunding, RequirementDetailFundingAttributes.FundedAmount,
                debitRdf.Id, debitRdfFunded, amount, Label, "Requirement Detail Funding");
            JunctionFundingHelper.MoveRfTdp(service, tracing, debitRf.Id, creditRf.Id, amount, Label);

            // Add/raise the credit junction (RF.TDP cap now satisfied).
            JunctionFundingHelper.UpsertRequirementDetailFunding(service, tracing, debitRd, creditRf, amount);

            // Refresh the credit RF funded from its junctions.
            FundingRollupHelper.RecalculateRFFunded(service, sameRf ? debitRf.Id : creditRf.Id, tracing);

            // Refresh the RD display totals (both junctions hang off the same RD).
            FundingRollupHelper.RecalculateRequirementDetail(service, debitRd.Id, tracing);
        }
    }
}
