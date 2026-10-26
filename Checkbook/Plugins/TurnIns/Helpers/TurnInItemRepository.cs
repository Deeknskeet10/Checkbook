using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Represents a Turn-In Item record. Each item is one row on a Turn-In and represents
    /// money being returned from a specific source: either a Prioritization (most common)
    /// or directly from a Requirement Funding (when the parent RF has no children).
    /// </summary>
    public class TurnInItemRecord
    {
        /// <summary>Source Prioritization. Null on RF-only turn-ins.</summary>
        public EntityReference Prioritization { get; set; }

        /// <summary>
        /// Source Requirement Funding. Always populated. When Prioritization is null this
        /// is the direct source of funds; otherwise it's the parent of the Prio.
        /// </summary>
        public EntityReference RequirementFunding { get; set; }

        /// <summary>Source LOA — the debit target on the ledger side.</summary>
        public EntityReference LOA { get; set; }

        /// <summary>Decimal amount being turned in from this item.</summary>
        public decimal Amount { get; set; }

        /// <summary>LOA's Fund. Used to group debit distributions by (Fund, PG).</summary>
        public EntityReference LOAFund { get; set; }

        /// <summary>LOA's PG. Used to group debit distributions by (Fund, PG).</summary>
        public EntityReference LOAPG { get; set; }

        /// <summary>LOA's SAG. FY27 credit-LOA matching for SAG-keyed appropriations.</summary>
        public EntityReference LOASAG { get; set; }

        /// <summary>LOA's Category (FY27 grain). FY27 credit-LOA matching.</summary>
        public int? LOACategory { get; set; }

        /// <summary>
        /// FY27: the Prioritization Funding junction the item turns in from. Null on FY26
        /// items and RF-level items. When set, Prioritization / RequirementFunding are the
        /// junction's own Prio / RF and LOA is the junction RF's LOA.
        /// </summary>
        public EntityReference PrioritizationFunding { get; set; }

        /// <summary>FY27 per-item AFP / Allotment (header Fund/PG is dropped in FY27).</summary>
        public decimal AFPAmount { get; set; }
        public decimal AllotmentAmount { get; set; }

        /// <summary>True when this item turns in funds directly from RF (no Prio).</summary>
        public bool IsRFOnly => Prioritization == null && RequirementFunding != null;
    }

    /// <summary>
    /// Repository to load Turn-In Items efficiently, including the related LOA's
    /// Fund + PG (needed for distribution grouping).
    /// </summary>
    public static class TurnInItemRepository
    {
        public static List<TurnInItemRecord> GetTurnInItems(
            IOrganizationService service,
            ITracingService tracing,
            Guid turnInId)
        {
            tracing.Trace("Loading Turn-In Items...");

            // Column set uses the strongly-typed TurnInItemsAttributes constants.
            // Historical note: this query used to reference "book_amounttaken" which does
            // not exist in this env — the real child amount column is book_newturninamount
            // (Decimal). See TurnInItemsAttributes.Amount.
            //
            // LOA is NOT stored on book_turninitems. It is derived from the linked
            // Prioritization (or Requirement Funding when RF-only) below.
            var q = new QueryExpression(EntityNames.TurnInItems)
            {
                ColumnSet = new ColumnSet(
                    TurnInItemsAttributes.Amount,
                    TurnInItemsAttributes.Turnin,
                    TurnInItemsAttributes.Prioritization,
                    TurnInItemsAttributes.RequirementFunding,
                    TurnInItemsAttributes.PrioritizationFunding,
                    TurnInItemsAttributes.AFPAmount,
                    TurnInItemsAttributes.AllotmentAmount)
            };

            q.Criteria.AddCondition(TurnInItemsAttributes.Turnin, ConditionOperator.Equal, turnInId);
            q.Criteria.AddCondition(TurnInItemsAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var results = service.RetrieveMultiple(q).Entities;

            var list = new List<TurnInItemRecord>();
            var loaCache = new Dictionary<Guid, Entity>();
            var prioLoaCache = new Dictionary<Guid, EntityReference>();
            var rfLoaCache = new Dictionary<Guid, EntityReference>();

            foreach (var e in results)
            {
                var pri = e.GetAttributeValue<EntityReference>(TurnInItemsAttributes.Prioritization);
                var rf = e.GetAttributeValue<EntityReference>(TurnInItemsAttributes.RequirementFunding);
                var pf = e.GetAttributeValue<EntityReference>(TurnInItemsAttributes.PrioritizationFunding);

                // Decimal column. NumericHelper covers Money/Double/Decimal sources.
                decimal amount = NumericHelper.ToDecimal(e, TurnInItemsAttributes.Amount) ?? 0m;

                // FY27: the PF junction is authoritative for the item's Prio and RF.
                if (pf != null)
                {
                    var pfEnt = service.Retrieve(
                        EntityNames.PrioritizationFunding,
                        pf.Id,
                        new ColumnSet(
                            PrioritizationFundingAttributes.Prioritization,
                            PrioritizationFundingAttributes.RequirementFunding));
                    pri = pfEnt.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization) ?? pri;
                    rf = pfEnt.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.RequirementFunding) ?? rf;
                }

                // At least one of Prio / RF must be present so we know the source.
                if (pri == null && rf == null)
                    throw new InvalidPluginExecutionException(
                        "Turn-In Item is missing both Prioritization and Requirement Funding — " +
                        "at least one source must be specified.");

                // Derive LOA from the source: Prio when present, otherwise RF. FY27
                // Prioritizations carry no LOA (their money lives on PF junctions), so a
                // Prio-backed FY27 item reads the LOA from its RF instead.
                EntityReference loa;
                if (pri != null && pf == null)
                {
                    if (!prioLoaCache.TryGetValue(pri.Id, out loa))
                    {
                        var prioEnt = service.Retrieve(
                            EntityNames.Prioritization,
                            pri.Id,
                            new ColumnSet(PrioritizationAttributes.LineOfAccounting));
                        loa = prioEnt.GetAttributeValue<EntityReference>(
                            PrioritizationAttributes.LineOfAccounting);
                        prioLoaCache[pri.Id] = loa;
                    }

                    if (loa == null && rf != null)
                        loa = GetRfLoa(service, rfLoaCache, rf.Id);

                    if (loa == null)
                        throw new InvalidPluginExecutionException(
                            $"Prioritization {pri.Id} has no LOA (book_lineofaccounting). " +
                            "Cannot resolve the debit LOA for this Turn-In Item.");
                }
                else
                {
                    loa = GetRfLoa(service, rfLoaCache, rf.Id);

                    if (loa == null)
                        throw new InvalidPluginExecutionException(
                            $"Requirement Funding {rf.Id} has no LOA (book_lineofaccounting). " +
                            "Cannot resolve the debit LOA for this Turn-In Item.");
                }

                // Resolve LOA Fund + PG once per unique LOA (these drive distribution grouping).
                if (!loaCache.TryGetValue(loa.Id, out var loaEntity))
                {
                    loaEntity = service.Retrieve(
                        EntityNames.FundingLine,
                        loa.Id,
                        new ColumnSet(
                            FundingLineAttributes.Fund, FundingLineAttributes.PG,
                            FundingLineAttributes.SAG, FundingLineAttributes.Category));
                    loaCache[loa.Id] = loaEntity;
                }

                var loaFund = loaEntity.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
                var loaPg = loaEntity.GetAttributeValue<EntityReference>(FundingLineAttributes.PG);

                list.Add(new TurnInItemRecord
                {
                    Prioritization = pri,
                    RequirementFunding = rf,
                    PrioritizationFunding = pf,
                    LOA = loa,
                    Amount = amount,
                    LOAFund = loaFund,
                    LOAPG = loaPg,
                    LOASAG = loaEntity.GetAttributeValue<EntityReference>(FundingLineAttributes.SAG),
                    LOACategory = loaEntity.GetAttributeValue<OptionSetValue>(FundingLineAttributes.Category)?.Value,
                    AFPAmount = NumericHelper.ToDecimal(e, TurnInItemsAttributes.AFPAmount) ?? 0m,
                    AllotmentAmount = NumericHelper.ToDecimal(e, TurnInItemsAttributes.AllotmentAmount) ?? 0m,
                });

                tracing.Trace(
                    $"Loaded TurnInItem: Pri={pri?.Id.ToString() ?? "(none)"}, " +
                    $"RF={rf?.Id.ToString() ?? "(none)"}, LOA={loa.Id}, " +
                    $"Fund={loaFund?.Id.ToString() ?? "(none)"}, " +
                    $"PG={loaPg?.Id.ToString() ?? "(none)"}, Amount={amount}");
            }

            return list;
        }

        private static EntityReference GetRfLoa(
            IOrganizationService service, Dictionary<Guid, EntityReference> cache, Guid rfId)
        {
            if (cache.TryGetValue(rfId, out var loa)) return loa;
            var rfEnt = service.Retrieve(
                EntityNames.RequirementFunding,
                rfId,
                new ColumnSet(RequirementFundingAttributes.LineOfAccounting));
            loa = rfEnt.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
            cache[rfId] = loa;
            return loa;
        }
    }
}