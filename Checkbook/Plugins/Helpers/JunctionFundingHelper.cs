using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// One requested change to a junction or Itemized Detail: the record plus the
    /// amount to raise or lower it by. Loaded from a feature's adjustment table
    /// (book_realignmentdetailreduction, book_turnindetailreduction, …) by
    /// <see cref="JunctionFundingHelper.LoadAdjustments"/>.
    /// </summary>
    public sealed class FundingAdjustment
    {
        public EntityReference Target;
        public decimal Amount;
    }

    /// <summary>
    /// FY27 junction-level money movement shared by the Realignment, Turn-In and
    /// State Swap executors. FY27 money lives on book_prioritizationfunding (Prio ↔ RF)
    /// and book_requirementdetailfunding (RD ↔ RF) junctions plus, for Itemized Prios,
    /// the per-detail Funded — so every move goes through these, never through a raw
    /// total the next roll-up would restore.
    ///
    /// Ordering rule every caller follows: free the debit side BEFORE raising the
    /// credit side, so each intermediate state passes single-record validation (the
    /// per-RF TDP cap on junctions, the LOA allocation check, and the entity-scoped
    /// "Funded vs TDP" business rule) without relying on ancestor bypasses.
    ///
    /// The junction roll-ups are Depth-guarded off inside these orchestrations, so
    /// callers recalculate RF / Prio / RD totals explicitly (FundingRollupHelper).
    /// Funded reductions are authorized by FundedAmountLockBase via the orchestrator's
    /// Update ancestor (book_turnin / book_realignments / book_stateswap).
    /// </summary>
    public static class JunctionFundingHelper
    {
        // ------------------------------------------------------------------
        // Requirement Funding TDP
        // ------------------------------------------------------------------

        /// <summary>
        /// Lowers an RF's TDP by <paramref name="amount"/> and re-sums its Funded from the
        /// (already reduced) junctions in ONE Update, so the "Funded vs TDP" business rule
        /// never sees Funded &gt; TDP. Returns the freed TDP to the RF's LOA.
        /// </summary>
        public static void LowerRfTdp(
            IOrganizationService service, ITracingService tracing,
            Guid rfId, decimal amount, string operationLabel)
        {
            var tdp = RequirementFundingHelper.GetTdp(service, rfId);
            if (tdp < amount)
                throw new InvalidPluginExecutionException(
                    $"{operationLabel} cannot execute: the debit Requirement Funding TDP {tdp:N2} " +
                    $"is less than the {amount:N2} it gives up.");

            var upd = FundingRollupHelper.BuildRFFundedUpdate(service, rfId, tracing);
            upd[RequirementFundingAttributes.TDP] = tdp - amount;
            service.Update(upd);
            tracing.Trace($"{operationLabel}: RF {rfId} TDP {tdp:N2} -> {tdp - amount:N2}.");
        }

        /// <summary>
        /// Cross-RF TDP move: debit RF TDP down (Funded re-summed in the same Update),
        /// then credit RF TDP up into the headroom just freed (same LOA) or the ledger
        /// credit (cross LOA). No-op when both are the same RF.
        /// </summary>
        public static void MoveRfTdp(
            IOrganizationService service, ITracingService tracing,
            Guid debitRfId, Guid creditRfId, decimal amount, string operationLabel)
        {
            if (debitRfId == creditRfId) return;
            LowerRfTdp(service, tracing, debitRfId, amount, operationLabel);
            RequirementFundingHelper.BumpTdp(service, tracing, creditRfId, amount);
        }

        // ------------------------------------------------------------------
        // Junctions
        // ------------------------------------------------------------------

        /// <summary>
        /// Lowers a junction's Funded by <paramref name="amount"/>. Throws (never clamps)
        /// when it holds less — the credit side would otherwise receive money that was
        /// never taken out.
        /// </summary>
        public static void ReduceJunction(
            IOrganizationService service, ITracingService tracing,
            string entityName, string fundedAttribute, Guid junctionId,
            decimal currentFunded, decimal amount, string operationLabel, string junctionLabel)
        {
            if (currentFunded < amount)
                throw new InvalidPluginExecutionException(
                    $"{operationLabel} cannot execute: the debit {junctionLabel} holds only {currentFunded:N2} " +
                    $"but {amount:N2} is taken from it. It was likely reduced after the " +
                    $"{operationLabel.ToLowerInvariant()} was submitted.");

            service.Update(new Entity(entityName, junctionId)
            {
                [fundedAttribute] = currentFunded - amount,
            });
            tracing.Trace($"{operationLabel}: {junctionLabel} {junctionId} funded {currentFunded:N2} -> {currentFunded - amount:N2}.");
        }

        /// <summary>
        /// Get-or-create the Prio ↔ RF junction and raise its Funded (and Validated, if
        /// below) by <paramref name="amount"/>. A new junction is stamped with the Prio's
        /// owning BU (same rule as PrioritizationSingleRfAutoAllocate) so states read it
        /// at Business-Unit depth. The caller must already have raised the RF's TDP.
        /// </summary>
        public static void UpsertPrioritizationFunding(
            IOrganizationService service, ITracingService tracing,
            EntityReference prio, EntityReference rf, decimal amount)
        {
            var existing = GetActiveJunction(service, EntityNames.PrioritizationFunding,
                PrioritizationFundingAttributes.Prioritization, prio.Id,
                PrioritizationFundingAttributes.RequirementFunding, rf.Id,
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
                tracing.Trace($"PF {existing.Id} funded {funded:N2} -> {newFunded:N2}.");
                return;
            }

            var create = new Entity(EntityNames.PrioritizationFunding);
            create[PrioritizationFundingAttributes.Prioritization] = prio;
            create[PrioritizationFundingAttributes.RequirementFunding] = rf;
            create[PrioritizationFundingAttributes.FundedAmount] = amount;
            create[PrioritizationFundingAttributes.ValidatedAmount] = amount;

            var prioBu = service.Retrieve(EntityNames.Prioritization, prio.Id,
                    new ColumnSet(CommonAttributes.OwningBusinessUnit))
                .GetAttributeValue<EntityReference>(CommonAttributes.OwningBusinessUnit);
            if (prioBu != null)
                create[CommonAttributes.OwningBusinessUnit] = prioBu;

            var id = service.Create(create);
            tracing.Trace($"PF {id} created for Prio {prio.Id} / RF {rf.Id} with funded {amount:N2}.");
        }

        /// <summary>
        /// Get-or-create the RD ↔ RF junction and raise its Funded (and Validated, if
        /// below) by <paramref name="amount"/>. The caller must already have raised the
        /// RF's TDP (the RDF guard caps Σ RDF at RF.TDP).
        /// </summary>
        public static void UpsertRequirementDetailFunding(
            IOrganizationService service, ITracingService tracing,
            EntityReference rd, EntityReference rf, decimal amount)
        {
            var existing = GetActiveJunction(service, EntityNames.RequirementDetailFunding,
                RequirementDetailFundingAttributes.RequirementDetail, rd.Id,
                RequirementDetailFundingAttributes.RequirementFunding, rf.Id,
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
                tracing.Trace($"RDF {existing.Id} funded {funded:N2} -> {newFunded:N2}.");
                return;
            }

            var create = new Entity(EntityNames.RequirementDetailFunding);
            create[RequirementDetailFundingAttributes.RequirementDetail] = rd;
            create[RequirementDetailFundingAttributes.RequirementFunding] = rf;
            create[RequirementDetailFundingAttributes.FundedAmount] = amount;
            create[RequirementDetailFundingAttributes.ValidatedAmount] = amount;
            var id = service.Create(create);
            tracing.Trace($"RDF {id} created for RD {rd.Id} / RF {rf.Id} with funded {amount:N2}.");
        }

        /// <summary>
        /// Lowers each Requirement Detail Funding junction by its adjustment, then re-sums
        /// the RD and the junction's RF. Used where the RF's Funded was already taken out
        /// at the RF level (RequirementFundingHelper.ApplyDebit) and Σ RDF must follow.
        /// </summary>
        public static void ReduceRequirementDetailFundings(
            IOrganizationService service, ITracingService tracing,
            IEnumerable<FundingAdjustment> adjustments, string operationLabel)
        {
            var rfs = new HashSet<Guid>();
            foreach (var adj in adjustments)
            {
                if (adj.Target == null || adj.Amount <= 0m) continue;

                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, adj.Target.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.FundedAmount,
                                  RequirementDetailFundingAttributes.RequirementDetail,
                                  RequirementDetailFundingAttributes.RequirementFunding));
                decimal funded = rdf.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
                if (adj.Amount > funded)
                    throw new InvalidPluginExecutionException(
                        $"{operationLabel} cannot execute: a Requirement Detail Funding holds {funded:N2} funded but a " +
                        $"reduction of {adj.Amount:N2} was entered. Re-balance the Requirement Detail reductions.");

                service.Update(new Entity(EntityNames.RequirementDetailFunding, adj.Target.Id)
                {
                    [RequirementDetailFundingAttributes.FundedAmount] = funded - adj.Amount,
                });

                var rd = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementDetail);
                if (rd != null)
                    FundingRollupHelper.RecalculateRequirementDetail(service, rd.Id, tracing);
                var rf = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
                if (rf != null) rfs.Add(rf.Id);
                tracing.Trace($"{operationLabel}: RDF {adj.Target.Id} funded {funded:N2} -> {funded - adj.Amount:N2}.");
            }

            foreach (var rfId in rfs)
                FundingRollupHelper.RecalculateRFFunded(service, rfId, tracing);
        }

        /// <summary>Active book_prioritizationfunding rows on a Prio.</summary>
        public static int CountActivePrioritizationFunding(IOrganizationService service, Guid prioId)
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

        /// <summary>Returns the single active junction row for a (parentA, parentB) pair, or null.</summary>
        public static Entity GetActiveJunction(
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

        // ------------------------------------------------------------------
        // Itemized Details
        // ------------------------------------------------------------------

        /// <summary>
        /// Lowers each Itemized Detail's Funded by its adjustment (and Requested too when
        /// <paramref name="lowerRequested"/> — Turn-Ins, where the state gives up the need).
        /// PrioritizationItemizedRollup (no depth guard) re-sums the Prio from the details.
        /// </summary>
        public static void ReduceItemizedDetails(
            IOrganizationService service, ITracingService tracing,
            IEnumerable<FundingAdjustment> adjustments, bool lowerRequested, string operationLabel)
        {
            foreach (var adj in adjustments)
            {
                if (adj.Target == null || adj.Amount <= 0m) continue;

                var detail = service.Retrieve(EntityNames.ItemizedDetails, adj.Target.Id,
                    new ColumnSet(ItemizedDetailsAttributes.FundedAmount, ItemizedDetailsAttributes.RequestedAmount));
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                if (adj.Amount > funded)
                    throw new InvalidPluginExecutionException(
                        $"{operationLabel} cannot execute: an Itemized Detail holds {funded:N2} funded but a reduction of " +
                        $"{adj.Amount:N2} was entered. Re-balance the detail reductions.");

                var upd = new Entity(EntityNames.ItemizedDetails, adj.Target.Id);
                upd[ItemizedDetailsAttributes.FundedAmount] = funded - adj.Amount;
                if (lowerRequested)
                {
                    decimal requested = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.RequestedAmount) ?? 0m;
                    upd[ItemizedDetailsAttributes.RequestedAmount] = Math.Max(0m, requested - adj.Amount);
                }
                service.Update(upd);
                tracing.Trace($"{operationLabel}: ItemizedDetail {adj.Target.Id} funded {funded:N2} -> {funded - adj.Amount:N2}.");
            }
        }

        /// <summary>
        /// Raises each Itemized Detail's Funded by its adjustment, lifting Validated and
        /// Requested to cover the new Funded (the Prio roll-up would otherwise trip
        /// "Requested &lt; Funded"). PrioritizationItemizedRollup lifts the Prio total, so
        /// the credit junction can then rise under the Σ PF ≤ Prio-total cap. Increases
        /// are never gated by the FundedAmountLock.
        /// </summary>
        public static void RaiseItemizedDetails(
            IOrganizationService service, ITracingService tracing,
            IEnumerable<FundingAdjustment> adjustments, string operationLabel)
        {
            foreach (var adj in adjustments)
            {
                if (adj.Target == null || adj.Amount <= 0m) continue;

                var detail = service.Retrieve(EntityNames.ItemizedDetails, adj.Target.Id,
                    new ColumnSet(ItemizedDetailsAttributes.FundedAmount,
                                  ItemizedDetailsAttributes.ValidatedAmount,
                                  ItemizedDetailsAttributes.RequestedAmount));
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                decimal validated = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.ValidatedAmount) ?? 0m;
                decimal requested = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.RequestedAmount) ?? 0m;
                decimal newFunded = funded + adj.Amount;

                var upd = new Entity(EntityNames.ItemizedDetails, adj.Target.Id);
                upd[ItemizedDetailsAttributes.FundedAmount] = newFunded;
                if (validated < newFunded) upd[ItemizedDetailsAttributes.ValidatedAmount] = newFunded;
                if (requested < newFunded) upd[ItemizedDetailsAttributes.RequestedAmount] = newFunded;
                service.Update(upd);
                tracing.Trace($"{operationLabel}: ItemizedDetail {adj.Target.Id} funded {funded:N2} -> {newFunded:N2}.");
            }
        }

        // ------------------------------------------------------------------
        // Adjustment tables
        // ------------------------------------------------------------------

        /// <summary>
        /// Loads the active rows of a feature's adjustment table (detail / RDF reductions
        /// or increases) for one parent record, as (target, amount) pairs.
        /// </summary>
        public static List<FundingAdjustment> LoadAdjustments(
            IOrganizationService service, string entityName, string parentAttribute, Guid parentId,
            string targetAttribute, string amountAttribute)
        {
            var q = new QueryExpression(entityName)
            {
                ColumnSet = new ColumnSet(targetAttribute, amountAttribute),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(parentAttribute, ConditionOperator.Equal, parentId),
                        new ConditionExpression(CommonAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var result = new List<FundingAdjustment>();
            foreach (var row in service.RetrieveMultiple(q).Entities)
            {
                result.Add(new FundingAdjustment
                {
                    Target = row.GetAttributeValue<EntityReference>(targetAttribute),
                    Amount = row.GetAttributeValue<decimal?>(amountAttribute) ?? 0m,
                });
            }
            return result;
        }
    }
}
