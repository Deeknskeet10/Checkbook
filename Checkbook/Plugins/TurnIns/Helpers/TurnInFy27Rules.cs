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
    /// FY27+ availability and balance rules for an item-based Turn-In, run by TurnInValidator
    /// at approval in place of the FY26 per-Prio / per-RF availability check.
    /// See docs/TurnIn-FY27-Redesign.md. The same rules the FY27 realignment applies
    /// (RealignmentValidator.EnforceItemizedDebitBalance / EnforceRdfDebitBalance), keyed on
    /// the Turn-In's own child tables.
    /// </summary>
    public static class TurnInFy27Rules
    {
        private const decimal Epsilon = 0.005m;

        public static void Validate(
            IOrganizationService service, ITracingService tracing, Guid turnInId, List<TurnInItemRecord> items)
        {
            // FY27 Prioritization money lives on the PF junctions; an item that names a
            // Prioritization without its junction cannot say which Fund/SAG it comes from.
            if (items.Any(i => i.Prioritization != null && i.PrioritizationFunding == null))
                throw new InvalidPluginExecutionException(
                    "Each Prioritization line on an FY27 Turn-In must name the Prioritization Funding " +
                    "(Fund/SAG) it is turned in from. Rebuild the Turn-In Items with the Turn-In builder.");

            // Prioritization lines (State, State-approved) and RF lines (NPM, RI / CSOR-approved)
            // take different approval routes, so one Turn-In carries one kind only.
            if (items.Any(i => i.IsRFOnly) && items.Any(i => !i.IsRFOnly))
                throw new InvalidPluginExecutionException(
                    "A Turn-In can carry Prioritization lines or Requirement Funding lines, not both. " +
                    "Split it into two Turn-Ins.");

            if (items.Any(i => i.AFPAmount < 0m || i.AllotmentAmount < 0m))
                throw new InvalidPluginExecutionException("Turn-In AFP and Allotment amounts cannot be negative.");

            ValidatePfAvailability(service, tracing, items);
            ValidateItemizedBalance(service, tracing, turnInId, items);
            ValidateRequirementFundingLevel(service, tracing, turnInId, items);
            ValidateDistributable(service, tracing, items);
        }

        /// <summary>
        /// AFP / Allotment go back as Distributions tagged with the active Funding Event for the
        /// line's (Fund, PG). An amount with no such event would be silently dropped by
        /// TurnInDistributionCreator — block it here so the submitter knows.
        /// </summary>
        private static void ValidateDistributable(
            IOrganizationService service, ITracingService tracing, List<TurnInItemRecord> items)
        {
            var asOf = DateTime.UtcNow.Date;
            var groups = items
                .Where(i => i.LOAFund != null && i.LOAPG != null)
                .GroupBy(i => new { Fund = i.LOAFund.Id, Pg = i.LOAPG.Id });
            foreach (var g in groups)
            {
                RequireEvent(service, tracing, g.Key.Fund, g.Key.Pg, FundingTypeValues.AFP, "AFP", g.Sum(i => i.AFPAmount), asOf);
                RequireEvent(service, tracing, g.Key.Fund, g.Key.Pg, FundingTypeValues.Allotment, "Allotment",
                    g.Sum(i => i.AllotmentAmount), asOf);
            }
        }

        private static void RequireEvent(
            IOrganizationService service, ITracingService tracing,
            Guid fundId, Guid pgId, int fundingType, string label, decimal amount, DateTime asOf)
        {
            if (amount <= 0m) return;
            if (FundingPercentageHelper.Resolve(service, tracing, fundId, pgId, fundingType, asOf) != null) return;
            var fund = service.Retrieve(EntityNames.Fund, fundId, new ColumnSet(FundAttributes.Name))
                .GetAttributeValue<string>(FundAttributes.Name);
            var pg = service.Retrieve(EntityNames.PG, pgId, new ColumnSet("book_name"))
                .GetAttributeValue<string>("book_name");
            throw new InvalidPluginExecutionException(
                $"This Turn-In returns {amount:N2} {label} on Fund {fund} / PG {pg}, but there is no active " +
                $"{label} Funding Event for that Fund and PG today, so it cannot be distributed back. " +
                $"Clear the {label} amount or ask an administrator to open the Funding Event.");
        }

        private static void ValidatePfAvailability(
            IOrganizationService service, ITracingService tracing, List<TurnInItemRecord> items)
        {
            foreach (var g in items.Where(i => i.PrioritizationFunding != null).GroupBy(i => i.PrioritizationFunding.Id))
            {
                decimal requested = g.Sum(i => i.Amount);
                var pf = service.Retrieve(EntityNames.PrioritizationFunding, g.Key,
                    new ColumnSet(PrioritizationFundingAttributes.FundedAmount, PrioritizationFundingAttributes.Name));
                decimal funded = pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
                tracing.Trace($"TurnInFy27Rules: PF {g.Key} funded={funded:N2}, taking={requested:N2}.");
                if (requested > funded + Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"The Turn-In takes {requested:N2} from Prioritization Funding " +
                        $"{pf.GetAttributeValue<string>(PrioritizationFundingAttributes.Name) ?? g.Key.ToString()}, " +
                        $"which holds only {funded:N2} funded.");
            }
        }

        /// <summary>
        /// For each Itemized Prioritization the Turn-In draws from, Σ detail reductions on that
        /// Prio must equal Σ the item amounts on its PF junctions, so Σ details ≡ Σ PF ≡ total
        /// still holds after approval. Each reduction must fit the detail's Funded.
        /// </summary>
        private static void ValidateItemizedBalance(
            IOrganizationService service, ITracingService tracing, Guid turnInId, List<TurnInItemRecord> items)
        {
            var pulledByPrio = items
                .Where(i => i.PrioritizationFunding != null)
                .GroupBy(i => i.Prioritization.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            var itemizedPrios = new HashSet<Guid>();
            foreach (var prioId in pulledByPrio.Keys)
            {
                var prio = service.Retrieve(EntityNames.Prioritization, prioId,
                    new ColumnSet(PrioritizationAttributes.FundingMode));
                if (prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode)?.Value
                    == FundingModeValues.Itemized)
                    itemizedPrios.Add(prioId);
            }

            var q = new QueryExpression(TurnInDetailReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    TurnInDetailReductionAttributes.Amount,
                    TurnInDetailReductionAttributes.ItemizedDetail),
            };
            q.Criteria.AddCondition(TurnInDetailReductionAttributes.TurnIn, ConditionOperator.Equal, turnInId);
            q.Criteria.AddCondition(TurnInDetailReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var reducedByPrio = new Dictionary<Guid, decimal>();
            foreach (var r in service.RetrieveMultiple(q).Entities)
            {
                var detailRef = r.GetAttributeValue<EntityReference>(TurnInDetailReductionAttributes.ItemizedDetail);
                if (detailRef == null)
                    throw new InvalidPluginExecutionException("A Turn-In Detail Reduction has no Itemized Detail selected.");

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.Prioritization, ItemizedDetailsAttributes.FundedAmount));
                var prioRef = detail.GetAttributeValue<EntityReference>(ItemizedDetailsAttributes.Prioritization);
                if (prioRef == null || !itemizedPrios.Contains(prioRef.Id))
                    throw new InvalidPluginExecutionException(
                        "A selected Itemized Detail does not belong to an itemized Prioritization this Turn-In draws from.");

                decimal amt = r.GetAttributeValue<decimal?>(TurnInDetailReductionAttributes.Amount) ?? 0m;
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                if (amt > funded + Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"An Itemized Detail holds {funded:N2} funded but a reduction of {amt:N2} was entered.");

                reducedByPrio[prioRef.Id] = (reducedByPrio.TryGetValue(prioRef.Id, out var x) ? x : 0m) + amt;
            }

            foreach (var prioId in itemizedPrios)
            {
                decimal required = pulledByPrio[prioId];
                decimal got = reducedByPrio.TryGetValue(prioId, out var g) ? g : 0m;
                tracing.Trace($"TurnInFy27Rules: itemized Prio {prioId} required={required:N2}, reduced={got:N2}.");
                if (Math.Abs(got - required) >= Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"This Turn-In takes {required:N2} from an itemized Prioritization. Before it can be approved, " +
                        $"reduce its Itemized Details by a total of {required:N2} (currently {got:N2}).");
            }
        }

        /// <summary>
        /// RF-level items: Withholding first. An RF funded through Prioritizations may give up
        /// only Withholding; on a direct-funded RF (Σ RDF) the remainder must come out of its RDF
        /// junctions — Σ reductions == max(0, amount − Withholding).
        /// </summary>
        private static void ValidateRequirementFundingLevel(
            IOrganizationService service, ITracingService tracing, Guid turnInId, List<TurnInItemRecord> items)
        {
            var taken = items.Where(i => i.IsRFOnly)
                .GroupBy(i => i.RequirementFunding.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            var q = new QueryExpression(TurnInRdfReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    TurnInRdfReductionAttributes.Amount,
                    TurnInRdfReductionAttributes.RequirementDetailFunding),
            };
            q.Criteria.AddCondition(TurnInRdfReductionAttributes.TurnIn, ConditionOperator.Equal, turnInId);
            q.Criteria.AddCondition(TurnInRdfReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var reduced = new Dictionary<Guid, decimal>();
            foreach (var r in service.RetrieveMultiple(q).Entities)
            {
                var rdfRef = r.GetAttributeValue<EntityReference>(TurnInRdfReductionAttributes.RequirementDetailFunding);
                if (rdfRef == null)
                    throw new InvalidPluginExecutionException(
                        "A Turn-In RD Funding Reduction has no Requirement Detail Funding selected.");

                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, rdfRef.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.RequirementFunding,
                                  RequirementDetailFundingAttributes.FundedAmount));
                var rfRef = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
                if (rfRef == null || !taken.ContainsKey(rfRef.Id))
                    throw new InvalidPluginExecutionException(
                        "A selected Requirement Detail Funding is not on a Requirement Funding this Turn-In draws from.");

                decimal amt = r.GetAttributeValue<decimal?>(TurnInRdfReductionAttributes.Amount) ?? 0m;
                decimal funded = rdf.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
                if (amt > funded + Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"A Requirement Detail Funding holds {funded:N2} funded but a reduction of {amt:N2} was entered.");

                reduced[rfRef.Id] = (reduced.TryGetValue(rfRef.Id, out var x) ? x : 0m) + amt;
            }

            foreach (var kv in taken)
            {
                var rf = service.Retrieve(EntityNames.RequirementFunding, kv.Key,
                    new ColumnSet(RequirementFundingAttributes.Withholding,
                                  RequirementFundingAttributes.FundedAmount,
                                  RequirementFundingAttributes.Name));
                string name = rf.GetAttributeValue<string>(RequirementFundingAttributes.Name) ?? kv.Key.ToString();
                decimal withholding = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.Withholding) ?? 0m;
                decimal funded = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.FundedAmount) ?? 0m;

                bool prioFunded =
                    PrioritizationFundingRollupHelper.SumForRequirementFunding(service, kv.Key).funded > 0m ||
                    RequirementFundingHelpers.HasActiveChildren(service, kv.Key);
                if (prioFunded && kv.Value > withholding + Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"{name} is funded through Prioritizations, so an RF-level Turn-In can take at most its " +
                        $"Withholding ({withholding:N2}), not {kv.Value:N2}. Turn in from the Prioritization instead.");

                if (kv.Value > withholding + funded + Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"The Turn-In takes {kv.Value:N2} from {name}, which holds only {withholding + funded:N2} " +
                        $"(Withholding {withholding:N2} + Funded {funded:N2}).");

                bool hasRdf = RequirementDetailFundingRollupHelper.SumForRequirementFunding(service, kv.Key).funded > 0m;
                decimal required = hasRdf ? Math.Max(0m, kv.Value - withholding) : 0m;
                decimal got = reduced.TryGetValue(kv.Key, out var g) ? g : 0m;
                tracing.Trace(
                    $"TurnInFy27Rules: RF {kv.Key} taken={kv.Value:N2}, withholding={withholding:N2}, " +
                    $"required RDF reduction={required:N2}, reduced={got:N2}.");

                if (Math.Abs(got - required) >= Epsilon)
                    throw new InvalidPluginExecutionException(
                        $"This Turn-In takes {kv.Value:N2} from {name}, which has {withholding:N2} in Withholding. " +
                        $"Before it can be approved, reduce its Requirement Detail funding by a total of {required:N2} " +
                        $"(currently {got:N2}).");
            }
        }
    }
}
