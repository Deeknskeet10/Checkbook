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
    /// - Credit LOAs grouped by LOA with total amount (usually one — the RISK / BE OPR
    ///   centralization LOA — but the FY26 RISK-missing fallback produces a per-source
    ///   credit map mirroring DebitLOAs, so funds remain on the originating LOA)
    /// - Total turn-in amount
    /// </summary>
    public class TurnInLOAResolution
    {
        public Dictionary<EntityReference, decimal> DebitLOAs { get; }
            = new Dictionary<EntityReference, decimal>(new EntityReferenceComparer());

        public Dictionary<EntityReference, decimal> CreditLOAs { get; }
            = new Dictionary<EntityReference, decimal>(new EntityReferenceComparer());

        public decimal TotalAmount
            => DebitLOAs.Values.Sum();
    }

    /// <summary>
    /// Resolves all LOAs needed to process a Turn-In.
    ///
    /// Debit LOAs come from prioritizations / requirement fundings via Turn-In items.
    ///
    /// Credit LOA depends on the Turn-In's fiscal year (parsed from the Fund name's
    /// trailing 2 digits — same convention LOANameBuilder uses):
    ///   • FY &lt;= <see cref="LOANameBuilder.LegacyGrainLastFy"/> (FY26):
    ///       Fund + PG + BOC(BASE) + DollarType(BASE) + MDEP(RISK)
    ///   • FY27+:
    ///       Fund + DisbursingOfficial(BE OPR, from env var <see cref="CreditOprEnvVar"/>)
    ///             + (PG | SAG-derived-from-PG) depending on Fund's APPN.
    /// </summary>
    public static class TurnInLOAResolver
    {
        /// <summary>Env-var schema name holding the credit-side OPR GUID for FY27+ turn-ins.</summary>
        public const string CreditOprEnvVar = EnvironmentVariableKeys.TurnInCreditOpr;

        public static TurnInLOAResolution ResolveLOAsForHeader(
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

            if (fy <= LOANameBuilder.LegacyGrainLastFy)
            {
                var risk = TryResolveCreditLoaLegacy(service, tracing, fund, pg);
                if (risk != null)
                {
                    result.CreditLOAs[risk] = result.TotalAmount;
                    tracing.Trace($"Resolved credit LOA: {risk.Id} (FY{fy} RISK branch).");
                }
                else
                {
                    // RISK LOA missing — funds stay on each source LOA. The would-be
                    // debit + credit pair for each LOA would net to zero, so we skip
                    // ledger creation entirely (signaled by an empty CreditLOAs map).
                    // RF TDP/Funded still drops via the item updaters, so the source
                    // LOA's TDP Remaining grows by the turned-in amount — which is
                    // the desired effect of leaving the funds in place.
                    tracing.Trace(
                        $"FY{fy}: RISK credit LOA not found — funds remain on source LOAs; " +
                        "no ledger entries will be created for this Turn-In.");
                }
            }
            else
            {
                var creditLoa = ResolveHeaderCreditLoa(
                    service, tracing, fund, pg, appnOs.Value, SingleCategoryOrNull(items));
                result.CreditLOAs[creditLoa] = result.TotalAmount;
                tracing.Trace($"Resolved credit LOA: {creditLoa.Id} (FY{fy} BE OPR branch).");
            }

            return result;
        }

        /// <summary>
        /// FY27+ item-based Turn-In: the header carries no Fund/PG (a Turn-In may span
        /// several Fund/SAGs), so the credit LOA is resolved PER DEBIT LOA — the BE OPR
        /// holding LOA (env var <see cref="CreditOprEnvVar"/>, the ARNG OPR) with the same
        /// Fund and the same PG or SAG (by the Fund's appropriation). Funds go back to the
        /// ARNG LOA they came from.
        /// </summary>
        public static TurnInLOAResolution ResolveLOAsForItems(
            IOrganizationService service,
            ITracingService tracing,
            List<TurnInItemRecord> items)
        {
            var result = new TurnInLOAResolution();
            var creditOprId = EnvironmentVariableHelper.GetGuid(service, CreditOprEnvVar);
            var creditByDebit = new Dictionary<Guid, EntityReference>();

            foreach (var item in items)
            {
                if (item.LOA == null)
                    throw new InvalidPluginExecutionException("A Turn-In Item has no LOA.");

                if (!result.DebitLOAs.ContainsKey(item.LOA)) result.DebitLOAs[item.LOA] = 0m;
                result.DebitLOAs[item.LOA] += item.Amount;

                if (!creditByDebit.TryGetValue(item.LOA.Id, out var credit))
                {
                    credit = ResolveCreditLOAForDebit(service, tracing, item, creditOprId);
                    creditByDebit[item.LOA.Id] = credit;
                }

                if (!result.CreditLOAs.ContainsKey(credit)) result.CreditLOAs[credit] = 0m;
                result.CreditLOAs[credit] += item.Amount;
            }

            return result;
        }

        private static EntityReference ResolveCreditLOAForDebit(
            IOrganizationService service,
            ITracingService tracing,
            TurnInItemRecord item,
            Guid creditOprId)
        {
            if (item.LOAFund == null)
                throw new InvalidPluginExecutionException(
                    $"LOA {item.LOA.Id} has no Fund; cannot resolve the ARNG LOA to return funds to.");

            var fundRecord = service.Retrieve(
                EntityNames.Fund, item.LOAFund.Id, new ColumnSet(FundAttributes.Appropriation));
            var appn = fundRecord.GetAttributeValue<OptionSetValue>(FundAttributes.Appropriation);
            if (appn == null)
                throw new InvalidPluginExecutionException(
                    $"Fund {item.LOAFund.Id} has no appropriation; cannot resolve the ARNG LOA to return funds to.");

            bool byPg = AppropriationValues.RequiresPg(appn.Value);
            var key = byPg ? item.LOAPG : item.LOASAG;
            if (key == null)
                throw new InvalidPluginExecutionException(
                    $"LOA {item.LOA.Id} has no {(byPg ? "PG" : "SAG")}; cannot resolve the ARNG LOA to return funds to.");

            var q = new QueryExpression(EntityNames.FundingLine)
            {
                ColumnSet = new ColumnSet(FundingLineAttributes.Name),
                NoLock = true,
            };
            q.Criteria.AddCondition(FundingLineAttributes.Fund, ConditionOperator.Equal, item.LOAFund.Id);
            q.Criteria.AddCondition(FundingLineAttributes.DisbursingOfficial, ConditionOperator.Equal, creditOprId);
            q.Criteria.AddCondition(byPg ? FundingLineAttributes.PG : FundingLineAttributes.SAG, ConditionOperator.Equal, key.Id);
            q.Criteria.AddCondition(FundingLineAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);
            // Category is part of the FY27 LOA grain (DO-Fund-PG-FP-Category); without it two
            // ARNG LOAs differing only by Category are ambiguous. Funded Program rides on Fund.
            AddCategoryCondition(q, item.LOACategory);

            var matches = service.RetrieveMultiple(q).Entities;
            if (matches.Count == 0)
                throw new InvalidPluginExecutionException(
                    $"No ARNG LOA found to return funds to for LOA {item.LOA.Id} " +
                    $"(Fund={item.LOAFund.Id}, OPR={creditOprId}, {(byPg ? "PG" : "SAG")}={key.Id}). " +
                    $"Verify the ARNG holding LOA exists and env var '{CreditOprEnvVar}' points to the ARNG OPR.");
            if (matches.Count > 1)
                throw new InvalidPluginExecutionException(
                    $"Multiple ({matches.Count}) ARNG LOAs match Fund={item.LOAFund.Id}, " +
                    $"{(byPg ? "PG" : "SAG")}={key.Id}, Category={item.LOACategory?.ToString() ?? "(none)"} — " +
                    "the holding LOA should be unique per (Fund, PG/SAG, Category).");

            tracing.Trace($"FY27 credit LOA for debit LOA {item.LOA.Id}: {matches[0].Id}.");
            return matches[0].ToEntityReference();
        }

        /// <summary>
        /// FY26 credit LOA: Fund + PG + BOC(BASE) + DollarType(BASE) + MDEP(RISK).
        /// Returns null when no such LOA exists so the caller can fall back to
        /// crediting each item's source LOA in place.
        /// </summary>
        private static EntityReference TryResolveCreditLoaLegacy(
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
            return fl?.ToEntityReference();
        }

        /// <summary>
        /// FY27+ credit LOA: Fund + DisbursingOfficial(env var BE OPR) + PG or SAG.
        /// PG vs SAG is chosen by the Fund's appropriation; for SAG-based APPNs the
        /// SAG is derived from the Turn-In's PG via SAG.book_pg.
        /// </summary>
        private static EntityReference ResolveHeaderCreditLoa(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference fund,
            EntityReference pg,
            int appropriation,
            int? category)
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

            // Header path (Sweep Turn-Ins carry no items): Category is only known when every
            // item's debit LOA agrees on it; otherwise rely on (Fund, OPR, PG/SAG) uniqueness.
            if (category.HasValue)
                flQuery.Criteria.AddCondition(FundingLineAttributes.Category, ConditionOperator.Equal, category.Value);

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

        private static void AddCategoryCondition(QueryExpression q, int? category)
        {
            if (category.HasValue)
                q.Criteria.AddCondition(FundingLineAttributes.Category, ConditionOperator.Equal, category.Value);
            else
                q.Criteria.AddCondition(FundingLineAttributes.Category, ConditionOperator.Null);
        }

        private static int? SingleCategoryOrNull(List<TurnInItemRecord> items)
        {
            var categories = items.Select(i => i.LOACategory).Where(c => c.HasValue).Distinct().ToList();
            return categories.Count == 1 ? categories[0] : null;
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
}