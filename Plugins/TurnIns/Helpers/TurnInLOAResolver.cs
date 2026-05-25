using System;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.LOAs.Helpers;

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
    ///
    /// Debit LOAs come from prioritizations / requirement fundings via Turn-In items.
    ///
    /// Credit LOA depends on the Turn-In's fiscal year (parsed from the Fund name's
    /// trailing 2 digits — same convention LOANameBuilder uses):
    ///   • FY &lt;= <see cref="LOANameBuilder.MdepInNameLastFy"/> (FY26):
    ///       Fund + PG + BOC(BASE) + DollarType(BASE) + MDEP(RISK)
    ///   • FY27+:
    ///       Fund + DisbursingOfficial(BE OPR, from env var <see cref="CreditOprEnvVar"/>)
    ///             + (PG | SAG-derived-from-PG) depending on Fund's APPN.
    /// </summary>
    public static class TurnInLOAResolver
    {
        /// <summary>Env-var schema name holding the credit-side OPR GUID for FY27+ turn-ins.</summary>
        public const string CreditOprEnvVar = "book_TurnInCreditOPR";

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

            // Read Fund once — name (for FY parse) and appropriation (for PG vs SAG).
            var fundRecord = service.Retrieve(
                EntityNames.Fund, fund.Id,
                new ColumnSet(FundAttributes.Name, FundAttributes.Appropriation));
            var fundName = fundRecord.GetAttributeValue<string>(FundAttributes.Name);
            var appnOs = fundRecord.GetAttributeValue<OptionSetValue>(FundAttributes.Appropriation);
            if (string.IsNullOrWhiteSpace(fundName) || appnOs == null)
                throw new InvalidPluginExecutionException(
                    $"Fund {fund.Id} is missing book_name or book_appropriation; cannot resolve credit LOA.");

            int fy;
            try { fy = LOANameBuilder.ParseFiscalYear(fundName); }
            catch (ArgumentException ex)
            {
                throw new InvalidPluginExecutionException(
                    $"Cannot determine fiscal year from Fund '{fundName}': {ex.Message}");
            }

            result.CreditLOA = fy <= LOANameBuilder.MdepInNameLastFy
                ? ResolveCreditLOA_FY26(service, tracing, fund, pg)
                : ResolveCreditLOA_FY27Plus(service, tracing, fund, pg, appnOs.Value);

            tracing.Trace($"Resolved credit LOA: {result.CreditLOA.Id} (FY{fy} branch).");

            return result;
        }

        /// <summary>
        /// FY26 credit LOA: Fund + PG + BOC(BASE) + DollarType(BASE) + MDEP(RISK).
        /// Preserved verbatim so in-flight FY26 turn-ins keep working.
        /// </summary>
        private static EntityReference ResolveCreditLOA_FY26(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference fund,
            EntityReference pg)
        {
            var bocBase  = ResolveLookupValue(service, tracing, EntityNames.BOC, "BASE");
            var dtBase   = ResolveLookupValue(service, tracing, EntityNames.DollarType, "BASE");
            var mdepRisk = ResolveLookupValue(service, tracing, EntityNames.MDEP, "RISK");

            var flQuery = new QueryExpression(EntityNames.FundingLine)
            {
                ColumnSet = new ColumnSet(
                    FundingLineAttributes.Id,
                    FundingLineAttributes.Fund,
                    FundingLineAttributes.SAG,
                    FundingLineAttributes.PG),
            };
            flQuery.Criteria.AddCondition(FundingLineAttributes.Fund,       ConditionOperator.Equal, fund.Id);
            flQuery.Criteria.AddCondition(FundingLineAttributes.PG,         ConditionOperator.Equal, pg.Id);
            flQuery.Criteria.AddCondition(FundingLineAttributes.BOC,        ConditionOperator.Equal, bocBase.Id);
            flQuery.Criteria.AddCondition(FundingLineAttributes.DollarType, ConditionOperator.Equal, dtBase.Id);
            flQuery.Criteria.AddCondition(FundingLineAttributes.MDEP,       ConditionOperator.Equal, mdepRisk.Id);

            var fl = service.RetrieveMultiple(flQuery).Entities.FirstOrDefault();
            if (fl == null)
                throw new InvalidPluginExecutionException(
                    "Unable to find a Credit LOA with Fund + PG + BASE + BASE + RISK.");
            return fl.ToEntityReference();
        }

        /// <summary>
        /// FY27+ credit LOA: Fund + DisbursingOfficial(env var BE OPR) + PG or SAG.
        /// PG vs SAG is chosen by the Fund's appropriation; for SAG-based APPNs the
        /// SAG is derived from the Turn-In's PG via SAG.book_pg.
        /// </summary>
        private static EntityReference ResolveCreditLOA_FY27Plus(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference fund,
            EntityReference pg,
            int appropriation)
        {
            var creditOprId = EnvironmentVariableHelper.GetGuid(service, CreditOprEnvVar);
            tracing.Trace($"FY27+ credit LOA: OPR={creditOprId} (from env var {CreditOprEnvVar}).");

            var flQuery = new QueryExpression(EntityNames.FundingLine)
            {
                ColumnSet = new ColumnSet(
                    FundingLineAttributes.Id,
                    FundingLineAttributes.Fund,
                    FundingLineAttributes.PG,
                    FundingLineAttributes.SAG),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingLineAttributes.Fund,               ConditionOperator.Equal, fund.Id),
                        new ConditionExpression(FundingLineAttributes.DisbursingOfficial, ConditionOperator.Equal, creditOprId),
                        new ConditionExpression(FundingLineAttributes.StateCode,          ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                NoLock = true,
            };

            if (AppropriationValues.RequiresPg(appropriation))
            {
                flQuery.Criteria.AddCondition(FundingLineAttributes.PG, ConditionOperator.Equal, pg.Id);
                tracing.Trace($"APPN {appropriation} uses PG; filtering on PG {pg.Id}.");
            }
            else
            {
                var sagRef = DeriveSagFromPg(service, tracing, pg);
                flQuery.Criteria.AddCondition(FundingLineAttributes.SAG, ConditionOperator.Equal, sagRef.Id);
                tracing.Trace($"APPN {appropriation} uses SAG; derived SAG {sagRef.Id} from PG {pg.Id}.");
            }

            var matches = service.RetrieveMultiple(flQuery).Entities;
            if (matches.Count == 0)
                throw new InvalidPluginExecutionException(
                    $"Unable to find a Credit LOA for FY27+ Turn-In: " +
                    $"Fund={fund.Id}, OPR={creditOprId}, " +
                    (AppropriationValues.RequiresPg(appropriation)
                        ? $"PG={pg.Id}"
                        : $"SAG derived from PG={pg.Id}") +
                    $". Verify the BE OPR's holding LOA exists, and that env var " +
                    $"'{CreditOprEnvVar}' points to the correct OPR record.");
            if (matches.Count > 1)
                throw new InvalidPluginExecutionException(
                    $"Multiple ({matches.Count}) Credit LOAs match the FY27+ filter — " +
                    "the BE OPR's holding LOA should be unique per (Fund, PG/SAG).");

            return matches[0].ToEntityReference();
        }

        /// <summary>
        /// Looks up the SAG whose <c>book_pg</c> = the Turn-In's PG. Used only for
        /// FY27+ on appropriations that key the LOA off SAG rather than PG. Throws
        /// if zero or more than one match — the resolver can't disambiguate.
        /// </summary>
        private static EntityReference DeriveSagFromPg(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference pg)
        {
            var query = new QueryExpression(EntityNames.SAG)
            {
                ColumnSet = new ColumnSet(SagAttributes.Id, SagAttributes.Name),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(SagAttributes.PG, ConditionOperator.Equal, pg.Id),
                    },
                },
                NoLock = true,
            };
            var sags = service.RetrieveMultiple(query).Entities;
            if (sags.Count == 0)
                throw new InvalidPluginExecutionException(
                    $"No SAG points to PG {pg.Id} via book_sag.book_pg; cannot derive SAG for credit LOA.");
            if (sags.Count > 1)
                throw new InvalidPluginExecutionException(
                    $"PG {pg.Id} has {sags.Count} SAGs pointing to it; SAG cannot be derived automatically. " +
                    "Add the SAG to the Turn-In explicitly or normalize the PG→SAG hierarchy.");
            return sags[0].ToEntityReference();
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