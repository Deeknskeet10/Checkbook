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
    /// See docs/Realignment-FY27-Redesign.md.
    /// </summary>
    public static class RealignmentExecutor
    {
        public static void Execute(IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            // Order matters (see ProcessItems / MovePfJunction):
            //  1) ProcessItems — debit side frees RF/LOA TDP, credit RF.TDP is bumped;
            //     UpsertCreditPf runs only for a Direct credit Prio.
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
            // the single-RF case), NOT by UpsertCreditPf. Crediting then flows as:
            // bump the credit RF.TDP here, raise the credit details afterwards
            // (ApplyDetailIncreases) so the roll-up lifts the Prio total and the
            // single-RF auto-allocate syncs the junction — so we must SKIP
            // UpsertCreditPf for those items (it would double the credit, and
            // raising it before the details are up trips the Σ PF ≤ Prio-total cap).
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
                if (creditPrioItemized && CountActivePf(service, creditPrio.Id) > 1)
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

        private static int CountActivePf(IOrganizationService service, Guid prioId)
        {
            var q = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(false),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(PrioritizationFundingAttributes.Prioritization, ConditionOperator.Equal, prioId),
                        new ConditionExpression(PrioritizationFundingAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return service.RetrieveMultiple(q).Entities.Count;
        }

        /// <summary>
        /// Reduces each selected ItemizedDetail's Funded amount by its
        /// book_realignmentdetailreduction amount. PrioritizationItemizedRollup (no depth
        /// guard) recomputes the parent Prioritization total from the reduced details.
        /// </summary>
        private static void ApplyDetailReductions(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentDetailReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentDetailReductionAttributes.Amount,
                    RealignmentDetailReductionAttributes.ItemizedDetail),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentDetailReductionAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentDetailReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rows = service.RetrieveMultiple(q).Entities;
            if (rows.Count == 0) { tracing.Trace("ApplyDetailReductions: no detail reductions on this realignment."); return; }

            foreach (var row in rows)
            {
                var detailRef = row.GetAttributeValue<EntityReference>(RealignmentDetailReductionAttributes.ItemizedDetail);
                decimal reduceBy = row.GetAttributeValue<decimal?>(RealignmentDetailReductionAttributes.Amount) ?? 0m;
                if (detailRef == null || reduceBy <= 0m) continue;

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.FundedAmount));
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                if (reduceBy > funded)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot execute: an Itemized Detail holds {funded:N2} funded but a detail " +
                        $"reduction of {reduceBy:N2} was entered. Re-balance the detail reductions.");

                var upd = new Entity(EntityNames.ItemizedDetails, detailRef.Id);
                upd[ItemizedDetailsAttributes.FundedAmount] = funded - reduceBy;
                service.Update(upd);
                tracing.Trace($"ApplyDetailReductions: ItemizedDetail {detailRef.Id} funded {funded:N2} -> {(funded - reduceBy):N2}.");
            }
        }

        /// <summary>
        /// Credit-side mirror of <see cref="ApplyDetailReductions"/>. Raises each selected
        /// ItemizedDetail's Funded by its book_realignmentdetailincrease amount so the crediting
        /// Itemized Prioritization's total (via PrioritizationItemizedRollup) is already up before
        /// the credit PF upsert. Increases are always allowed by the FundedAmountLock (only
        /// reductions are gated). Validated to balance by RealignmentValidator.EnforceItemizedCreditBalance.
        /// </summary>
        private static void ApplyDetailIncreases(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentDetailIncreaseAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentDetailIncreaseAttributes.Amount,
                    RealignmentDetailIncreaseAttributes.ItemizedDetail),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentDetailIncreaseAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentDetailIncreaseAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rows = service.RetrieveMultiple(q).Entities;
            if (rows.Count == 0) { tracing.Trace("ApplyDetailIncreases: no detail increases on this realignment."); return; }

            foreach (var row in rows)
            {
                var detailRef = row.GetAttributeValue<EntityReference>(RealignmentDetailIncreaseAttributes.ItemizedDetail);
                decimal raiseBy = row.GetAttributeValue<decimal?>(RealignmentDetailIncreaseAttributes.Amount) ?? 0m;
                if (detailRef == null || raiseBy <= 0m) continue;

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.FundedAmount,
                                  ItemizedDetailsAttributes.ValidatedAmount,
                                  ItemizedDetailsAttributes.RequestedAmount));
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                decimal validated = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.ValidatedAmount) ?? 0m;
                decimal requested = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.RequestedAmount) ?? 0m;
                decimal newFunded = funded + raiseBy;

                var upd = new Entity(EntityNames.ItemizedDetails, detailRef.Id);
                upd[ItemizedDetailsAttributes.FundedAmount] = newFunded;
                // Funded <= Validated <= ... and Funded <= Requested are enforced upstream
                // (PrioritizationItemizedRollup rolls these to the Prio, which blocks
                // Requested < Funded). Lift Validated and Requested to cover the new Funded
                // (mirrors ExecutePriorToPrior raising the credit's Requested).
                if (validated < newFunded) upd[ItemizedDetailsAttributes.ValidatedAmount] = newFunded;
                if (requested < newFunded) upd[ItemizedDetailsAttributes.RequestedAmount] = newFunded;
                service.Update(upd);
                tracing.Trace($"ApplyDetailIncreases: ItemizedDetail {detailRef.Id} funded {funded:N2} -> {newFunded:N2}.");
            }
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

                UpsertCreditRdf(service, tracing, rd, rf, raiseBy);
                FundingRollupHelper.RecalculateRequirementDetail(service, rd.Id, tracing);
                rfs.Add(rf.Id);
                tracing.Trace($"ApplyRdfIncreases: RD {rd.Id} on RF {rf.Id} +{raiseBy:N2}.");
            }
            foreach (var rfId in rfs)
                FundingRollupHelper.RecalculateRFFunded(service, rfId, tracing);
        }

        /// <summary>
        /// OPR debit side (FY27 §9.9): lower each selected Requirement Detail Funding junction
        /// on the debit RF by its book_realignmentrdfreduction amount. RequirementFundingHelper.ApplyDebit already took
        /// the same total out of the RF's Funded (validated by EnforceRdfDebitBalance), so this
        /// brings Σ RDF back in line; the RF is then re-summed from its junctions. Realignments
        /// are an authorized ancestor for the RDF FundedAmountLock.
        /// </summary>
        private static void ApplyRdfReductions(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentRdfReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentRdfReductionAttributes.Amount,
                    RealignmentRdfReductionAttributes.RequirementDetailFunding),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentRdfReductionAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentRdfReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rows = service.RetrieveMultiple(q).Entities;
            if (rows.Count == 0) { tracing.Trace("ApplyRdfReductions: no RD funding reductions on this realignment."); return; }

            var rfs = new System.Collections.Generic.HashSet<Guid>();
            foreach (var row in rows)
            {
                var rdfRef = row.GetAttributeValue<EntityReference>(RealignmentRdfReductionAttributes.RequirementDetailFunding);
                decimal reduceBy = row.GetAttributeValue<decimal?>(RealignmentRdfReductionAttributes.Amount) ?? 0m;
                if (rdfRef == null || reduceBy <= 0m) continue;

                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, rdfRef.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.FundedAmount,
                                  RequirementDetailFundingAttributes.RequirementDetail,
                                  RequirementDetailFundingAttributes.RequirementFunding));
                decimal funded = rdf.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
                if (reduceBy > funded)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot execute: a Requirement Detail Funding holds {funded:N2} funded but a " +
                        $"reduction of {reduceBy:N2} was entered. Re-balance the Requirement Detail reductions.");

                var upd = new Entity(EntityNames.RequirementDetailFunding, rdfRef.Id);
                upd[RequirementDetailFundingAttributes.FundedAmount] = funded - reduceBy;
                service.Update(upd);

                var rd = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementDetail);
                if (rd != null)
                    FundingRollupHelper.RecalculateRequirementDetail(service, rd.Id, tracing);
                var rf = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
                if (rf != null) rfs.Add(rf.Id);
                tracing.Trace($"ApplyRdfReductions: RDF {rdfRef.Id} funded {funded:N2} -> {(funded - reduceBy):N2}.");
            }
            foreach (var rfId in rfs)
                FundingRollupHelper.RecalculateRFFunded(service, rfId, tracing);
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
                    RequirementFundingHelper.ApplyDebit(service, tracing, debitRf, amount, false, "Realignment");
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

            if (debitPfFunded < amount)
                throw new InvalidPluginExecutionException(
                    $"Realignment cannot execute: the debit Prioritization Funding holds only {debitPfFunded:N2} " +
                    $"but the item moves {amount:N2}.");

            // Free the debit side BEFORE raising the credit side so real TDP headroom
            // always exists for the credit RF.TDP increase (no reliance on the
            // RequirementFundingTDPValidator realignment bypass). For cross-LOA moves
            // the credit LOA's headroom comes from the ledger created in ProcessItem;
            // for same-LOA moves it comes from the debit RF.TDP reduction here.

            // 1. Reduce the debit junction.
            var updDebitPf = new Entity(EntityNames.PrioritizationFunding, debitPf.Id);
            updDebitPf[PrioritizationFundingAttributes.FundedAmount] = debitPfFunded - amount;
            service.Update(updDebitPf);

            if (!sameRf)
            {
                // 2. Lower the debit RF Funded (from the reduced junction) and TDP
                //    together, so the entity-scoped "Funded vs TDP" business rule
                //    never sees Funded > TDP, and the LOA regains `amount` of TDP.
                var debitTdp = RequirementFundingHelper.GetTdp(service, debitRf.Id);
                if (debitTdp < amount)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot execute: the debit Requirement Funding TDP {debitTdp:N2} " +
                        $"is less than the move amount {amount:N2}.");
                var debitUpd = FundingRollupHelper.BuildRFFundedUpdate(service, debitRf.Id, tracing);
                debitUpd[RequirementFundingAttributes.TDP] = debitTdp - amount;
                service.Update(debitUpd);

                // 3. Raise the credit RF.TDP (headroom now exists on its LOA).
                RequirementFundingHelper.BumpTdp(service, tracing, creditRf.Id, amount);
            }

            // 4. Add/raise the credit junction (RF.TDP cap now satisfied) — ONLY for a
            //    Direct credit Prio. For an Itemized credit Prio the junction is owned by
            //    the detail roll-up + SingleRfAutoAllocate: ApplyDetailIncreases (run after
            //    this, once RF.TDP is bumped) raises the details, lifting the Prio total and
            //    syncing the junction. Upserting here would double the credit and, before the
            //    details are raised, breach the Σ PF ≤ Prio-total cap.
            if (!creditPrioItemized)
                UpsertCreditPf(service, tracing, creditPrio, creditRf, amount);
            else
                tracing.Trace("MovePfJunction: itemized credit Prio — deferring credit junction to detail increase + auto-allocate.");

            // 5. Refresh the credit RF funded from its junctions (same RF when in-house).
            //    For the itemized-credit case the authoritative refresh happens when
            //    auto-allocate syncs the junction; this is a harmless pre-pass.
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

            if (debitRdfFunded < amount)
                throw new InvalidPluginExecutionException(
                    $"Realignment cannot execute: the debit Requirement Detail Funding holds only {debitRdfFunded:N2} " +
                    $"but the item moves {amount:N2}.");

            // Free the debit side before raising the credit side (see MovePfJunction).
            // 1. Reduce the debit junction.
            var updDebitRdf = new Entity(EntityNames.RequirementDetailFunding, debitRdf.Id);
            updDebitRdf[RequirementDetailFundingAttributes.FundedAmount] = debitRdfFunded - amount;
            service.Update(updDebitRdf);

            if (!sameRf)
            {
                // 2. Lower debit RF Funded + TDP together (returns `amount` of LOA TDP).
                var debitTdp = RequirementFundingHelper.GetTdp(service, debitRf.Id);
                if (debitTdp < amount)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot execute: the debit Requirement Funding TDP {debitTdp:N2} " +
                        $"is less than the move amount {amount:N2}.");
                var debitUpd = FundingRollupHelper.BuildRFFundedUpdate(service, debitRf.Id, tracing);
                debitUpd[RequirementFundingAttributes.TDP] = debitTdp - amount;
                service.Update(debitUpd);

                // 3. Raise the credit RF.TDP (headroom now exists on its LOA).
                RequirementFundingHelper.BumpTdp(service, tracing, creditRf.Id, amount);
            }

            // 4. Add/raise the credit junction (RF.TDP cap now satisfied).
            UpsertCreditRdf(service, tracing, debitRd, creditRf, amount);

            // 5. Refresh the credit RF funded from its junctions.
            FundingRollupHelper.RecalculateRFFunded(service, sameRf ? debitRf.Id : creditRf.Id, tracing);

            // Refresh the RD display totals (both junctions hang off the same RD).
            FundingRollupHelper.RecalculateRequirementDetail(service, debitRd.Id, tracing);
        }

        private static void UpsertCreditPf(
            IOrganizationService service, ITracingService tracing,
            EntityReference creditPrio, EntityReference creditRf, decimal amount)
        {
            var existing = GetActiveJunction(service, EntityNames.PrioritizationFunding,
                PrioritizationFundingAttributes.Prioritization, creditPrio.Id,
                PrioritizationFundingAttributes.RequirementFunding, creditRf.Id,
                PrioritizationFundingAttributes.StateCode,
                PrioritizationFundingAttributes.FundedAmount, PrioritizationFundingAttributes.ValidatedAmount);

            if (existing != null)
            {
                decimal funded = existing.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
                decimal validated = existing.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.ValidatedAmount) ?? 0m;
                decimal newFunded = funded + amount;
                var upd = new Entity(EntityNames.PrioritizationFunding, existing.Id);
                upd[PrioritizationFundingAttributes.FundedAmount] = newFunded;
                if (validated < newFunded) upd[PrioritizationFundingAttributes.ValidatedAmount] = newFunded;
                service.Update(upd);
            }
            else
            {
                var create = new Entity(EntityNames.PrioritizationFunding);
                create[PrioritizationFundingAttributes.Prioritization] = creditPrio;
                create[PrioritizationFundingAttributes.RequirementFunding] = creditRf;
                create[PrioritizationFundingAttributes.FundedAmount] = amount;
                create[PrioritizationFundingAttributes.ValidatedAmount] = amount;

                // Scope the junction to the state that owns the credit Prio (same
                // rule as PrioritizationSingleRfAutoAllocate) so states can read it
                // at Business-Unit depth.
                var prioBu = service.Retrieve(EntityNames.Prioritization, creditPrio.Id,
                        new ColumnSet(CommonAttributes.OwningBusinessUnit))
                    .GetAttributeValue<EntityReference>(CommonAttributes.OwningBusinessUnit);
                if (prioBu != null)
                    create[CommonAttributes.OwningBusinessUnit] = prioBu;

                service.Create(create);
            }
        }

        private static void UpsertCreditRdf(
            IOrganizationService service, ITracingService tracing,
            EntityReference creditRd, EntityReference creditRf, decimal amount)
        {
            var existing = GetActiveJunction(service, EntityNames.RequirementDetailFunding,
                RequirementDetailFundingAttributes.RequirementDetail, creditRd.Id,
                RequirementDetailFundingAttributes.RequirementFunding, creditRf.Id,
                RequirementDetailFundingAttributes.StateCode,
                RequirementDetailFundingAttributes.FundedAmount, RequirementDetailFundingAttributes.ValidatedAmount);

            if (existing != null)
            {
                decimal funded = existing.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
                decimal validated = existing.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.ValidatedAmount) ?? 0m;
                decimal newFunded = funded + amount;
                var upd = new Entity(EntityNames.RequirementDetailFunding, existing.Id);
                upd[RequirementDetailFundingAttributes.FundedAmount] = newFunded;
                if (validated < newFunded) upd[RequirementDetailFundingAttributes.ValidatedAmount] = newFunded;
                service.Update(upd);
            }
            else
            {
                var create = new Entity(EntityNames.RequirementDetailFunding);
                create[RequirementDetailFundingAttributes.RequirementDetail] = creditRd;
                create[RequirementDetailFundingAttributes.RequirementFunding] = creditRf;
                create[RequirementDetailFundingAttributes.FundedAmount] = amount;
                create[RequirementDetailFundingAttributes.ValidatedAmount] = amount;
                service.Create(create);
            }
        }

        /// <summary>Returns the single active junction row for a (parentA, parentB) pair, or null.</summary>
        private static Entity GetActiveJunction(
            IOrganizationService service, string entity,
            string parentAAttr, Guid parentAId, string parentBAttr, Guid parentBId,
            string stateCodeAttr, params string[] columns)
        {
            var q = new QueryExpression(entity)
            {
                ColumnSet = new ColumnSet(columns),
                TopCount = 1,
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(parentAAttr, ConditionOperator.Equal, parentAId),
                        new ConditionExpression(parentBAttr, ConditionOperator.Equal, parentBId),
                        new ConditionExpression(stateCodeAttr, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            var r = service.RetrieveMultiple(q);
            return r.Entities.Count > 0 ? r.Entities[0] : null;
        }
    }
}
