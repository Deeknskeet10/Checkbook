using System;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Holds the LOA resolution results: 
    /// - Debit LOAs grouped by LOA with total amount
    /// - Single credit LOA
    /// - Total turn-in amount
    /// </summary>
    public class TurnInLOAResolution
    {
        public Dictionary<EntityReference, decimal> DebitLOAs { get; } 
            = new Dictionary<EntityReference, decimal>(new EntityReferenceComparer());

        public EntityReference CreditLOA { get; set; }

        public decimal TotalAmount 
            => DebitLOAs.Values.Sum();
    }

    /// <summary>
    /// Compares EntityReference by logical name + ID.
    /// Required for dictionary key grouping of LOAs.
    /// </summary>
    internal class EntityReferenceComparer : IEqualityComparer<EntityReference>
    {
        public bool Equals(EntityReference x, EntityReference y)
        {
            if (x == null && y == null) return true;
            if (x == null || y == null) return false;

            return x.Id == y.Id &&
                   string.Equals(x.LogicalName, y.LogicalName, StringComparison.OrdinalIgnoreCase);
        }

        public int GetHashCode(EntityReference obj)
        {
            return (obj.LogicalName + obj.Id.ToString()).ToLower().GetHashCode();
        }
    }

    /// <summary>
    /// Resolves all LOAs needed to process a Turn-In.
    /// - Debit LOAs come from prioritizations via Turn-In items.
    /// - Credit LOA is resolved by finding the matching funding line based on:
    ///       Fund + PG/SAG + BOC (BASE) + DollarType (BASE) + MDEP (RISK)
    /// </summary>
    public static class TurnInLOAResolver
    {
        public static TurnInLOAResolution ResolveLOAs(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn,
            List<TurnInItemRecord> items)
        {
            tracing.Trace("TurnInLOAResolver: resolving LOAs...");

            var result = new TurnInLOAResolution();

            // --------------------------------------------------------------------
            // 1. Resolve debit LOAs from prioritizations
            // --------------------------------------------------------------------
            foreach (var item in items)
            {
                if (item.LOA == null)
                {
                    var sourceLabel = item.Prioritization != null
                        ? $"Prioritization {item.Prioritization.Id}"
                        : item.RequirementFunding != null
                            ? $"Requirement Funding {item.RequirementFunding.Id}"
                            : "(unknown source)";
                    throw new InvalidPluginExecutionException(
                        $"Turn-In Item for {sourceLabel} has no LOA.");
                }

                var loaRef = item.LOA;
                var amount = item.Amount;

                if (!result.DebitLOAs.ContainsKey(loaRef))
                    result.DebitLOAs[loaRef] = 0m;

                result.DebitLOAs[loaRef] += amount;

                tracing.Trace($"Added debit LOA {loaRef.Id} amount {amount}.");
            }

            // --------------------------------------------------------------------
            // 2. Resolve the credit LOA
            // --------------------------------------------------------------------
            tracing.Trace("Resolving credit LOA...");

            var fund = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.Fund);
            var pg = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.PG);

            if (fund == null)
                throw new InvalidPluginExecutionException("Turn-In is missing Fund (book_fund).");

            if (pg == null)
                throw new InvalidPluginExecutionException("Turn-In is missing PG/SAG (book_pg).");

            // Resolve BASE + BASE + RISK via name lookup values
            var bocBase = ResolveLookupValue(service, tracing, EntityNames.BOC, "BASE");
            var dtBase = ResolveLookupValue(service, tracing, EntityNames.DollarType, "BASE");
            var mdepRisk = ResolveLookupValue(service, tracing, EntityNames.MDEP, "RISK");

            // Query the funding line (LOA)
            var flQuery = new QueryExpression(EntityNames.FundingLine)
            {
                ColumnSet = new ColumnSet(
                    FundingLineAttributes.Id,
                    FundingLineAttributes.Fund,
                    FundingLineAttributes.SAG,
                    FundingLineAttributes.PG,
                    FundingLineAttributes.FundCenter) // keep extensibility
            };

            flQuery.Criteria.AddCondition(FundingLineAttributes.Fund, ConditionOperator.Equal, fund.Id);
            flQuery.Criteria.AddCondition(FundingLineAttributes.PG, ConditionOperator.Equal, pg.Id);

            flQuery.Criteria.AddCondition(FundingLineAttributes.BOC, ConditionOperator.Equal, bocBase.Id);
            flQuery.Criteria.AddCondition(FundingLineAttributes.DollarType, ConditionOperator.Equal, dtBase.Id);
            flQuery.Criteria.AddCondition(FundingLineAttributes.MDEP, ConditionOperator.Equal, mdepRisk.Id);

            var fl = service.RetrieveMultiple(flQuery).Entities.FirstOrDefault();
            if (fl == null)
                throw new InvalidPluginExecutionException(
                    "Unable to find a Credit LOA with Fund + PG + BASE + BASE + RISK.");

            result.CreditLOA = fl.ToEntityReference();

            tracing.Trace($"Resolved credit LOA: {result.CreditLOA.Id}");

            return result;
        }

        /// <summary>
        /// Finds a lookup entity by name ("BASE", "RISK", etc.)
        /// </summary>
        private static EntityReference ResolveLookupValue(
            IOrganizationService service,
            ITracingService tracing,
            string entityName,
            string expectedName)
        {
            tracing.Trace($"Lookup {entityName} for name '{expectedName}'...");

            var q = new QueryExpression(entityName)
            {
                ColumnSet = new ColumnSet("book_name")
            };

            q.Criteria.AddCondition("book_name", ConditionOperator.Equal, expectedName);

            var record = service.RetrieveMultiple(q).Entities.FirstOrDefault();
            if (record == null)
            {
                throw new InvalidPluginExecutionException(
                    $"Lookup value '{expectedName}' not found in {entityName}.");
            }

            return record.ToEntityReference();
        }
    }

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
                    TurnInItemsAttributes.RequirementFunding)
            };

            q.Criteria.AddCondition(TurnInItemsAttributes.Turnin, ConditionOperator.Equal, turnInId);

            var results = service.RetrieveMultiple(q).Entities;

            var list = new List<TurnInItemRecord>();
            var loaCache = new Dictionary<Guid, Entity>();
            var prioLoaCache = new Dictionary<Guid, EntityReference>();
            var rfLoaCache = new Dictionary<Guid, EntityReference>();

            foreach (var e in results)
            {
                var pri = e.GetAttributeValue<EntityReference>(TurnInItemsAttributes.Prioritization);
                var rf = e.GetAttributeValue<EntityReference>(TurnInItemsAttributes.RequirementFunding);

                // Decimal column. NumericHelper covers Money/Double/Decimal sources.
                decimal amount = NumericHelper.ToDecimal(e, TurnInItemsAttributes.Amount) ?? 0m;

                // At least one of Prio / RF must be present so we know the source.
                if (pri == null && rf == null)
                    throw new InvalidPluginExecutionException(
                        "Turn-In Item is missing both Prioritization and Requirement Funding — " +
                        "at least one source must be specified.");

                // Derive LOA from the source: Prio when present, otherwise RF.
                EntityReference loa;
                if (pri != null)
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

                    if (loa == null)
                        throw new InvalidPluginExecutionException(
                            $"Prioritization {pri.Id} has no LOA (book_lineofaccounting). " +
                            "Cannot resolve the debit LOA for this Turn-In Item.");
                }
                else
                {
                    if (!rfLoaCache.TryGetValue(rf.Id, out loa))
                    {
                        var rfEnt = service.Retrieve(
                            EntityNames.RequirementFunding,
                            rf.Id,
                            new ColumnSet(RequirementFundingAttributes.LineOfAccounting));
                        loa = rfEnt.GetAttributeValue<EntityReference>(
                            RequirementFundingAttributes.LineOfAccounting);
                        rfLoaCache[rf.Id] = loa;
                    }

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
                        new ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.PG));
                    loaCache[loa.Id] = loaEntity;
                }

                var loaFund = loaEntity.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
                var loaPg = loaEntity.GetAttributeValue<EntityReference>(FundingLineAttributes.PG);

                list.Add(new TurnInItemRecord
                {
                    Prioritization = pri,
                    RequirementFunding = rf,
                    LOA = loa,
                    Amount = amount,
                    LOAFund = loaFund,
                    LOAPG = loaPg,
                });

                tracing.Trace(
                    $"Loaded TurnInItem: Pri={pri?.Id.ToString() ?? "(none)"}, " +
                    $"RF={rf?.Id.ToString() ?? "(none)"}, LOA={loa.Id}, " +
                    $"Fund={loaFund?.Id.ToString() ?? "(none)"}, " +
                    $"PG={loaPg?.Id.ToString() ?? "(none)"}, Amount={amount}");
            }

            return list;
        }
    }
}