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
    /// Creates Distributions for an approved Turn-In.
    ///
    /// Design (per Phase-3 business rules):
    /// - DEBIT distributions: grouped by the source LOAs' (Fund, PG) tuples. One debit
    ///   Distribution per unique (Fund, PG) across the Turn-In items, summed.
    ///   FundCenter = the Turn-In's own book_fundcenter (the state-specific A18XX, e.g. A18MN).
    /// - CREDIT distribution: a single Distribution.
    ///   FundCenter = "A18" main — resolved as the active FundCenter with no parent.
    ///   Fund + PG = the Turn-In header's fund + pg.
    ///
    /// All amount columns are Decimal (book_newamount). No Money type used.
    /// </summary>
    public static class TurnInDistributionCreator
    {
        public static void CreateDistributions(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn,
            List<TurnInItemRecord> items,
            decimal headerAmount)
        {
            tracing.Trace("TurnInDistributionCreator: creating distributions...");

            if (headerAmount <= 0m)
                throw new InvalidPluginExecutionException("Distribution amount must be greater than zero.");

            var turnInFundCenter = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.FundCenter);
            if (turnInFundCenter == null)
                throw new InvalidPluginExecutionException(
                    "Turn-In is missing Fund Center (book_fundcenter). Cannot create debit distributions.");

            var turnInFund = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.Fund);
            var turnInPg = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.PG);
            if (turnInFund == null)
                throw new InvalidPluginExecutionException("Turn-In is missing Fund (book_fund).");
            if (turnInPg == null)
                throw new InvalidPluginExecutionException("Turn-In is missing PG (book_pg).");

            var turnInRef = turnIn.ToEntityReference();

            // -----------------------------------------------------------------
            // Build (Fund, PG) → sum-of-amounts for DEBIT distributions.
            // Multiple items may share the same (Fund, PG); we collapse them.
            // -----------------------------------------------------------------
            var debitGroups = new Dictionary<FundPgKey, decimal>();

            foreach (var item in items)
            {
                if (item.LOAFund == null || item.LOAPG == null)
                {
                    throw new InvalidPluginExecutionException(
                        $"Source LOA for a Turn-In Item is missing Fund or PG. " +
                        $"LOA={item.LOA?.Id.ToString() ?? "(null)"}. Cannot group Distributions.");
                }

                var key = new FundPgKey(item.LOAFund.Id, item.LOAPG.Id);
                if (!debitGroups.ContainsKey(key))
                    debitGroups[key] = 0m;
                debitGroups[key] += item.Amount;
            }

            tracing.Trace($"Debit distribution groups: {debitGroups.Count} unique (Fund, PG) pairs.");

            // -----------------------------------------------------------------
            // Resolve the CREDIT side fund center: the A18 root — defined here as
            // the single active FundCenter with no parent. If the env ever has
            // more than one parent-less active FC, ResolveRootFundCenter throws.
            // -----------------------------------------------------------------
            var creditFundCenter = ResolveRootFundCenter(service, tracing);

            // -----------------------------------------------------------------
            // Create DEBIT distributions (one per (Fund, PG) bucket).
            // -----------------------------------------------------------------
            foreach (var kvp in debitGroups)
            {
                var fundId = kvp.Key.FundId;
                var pgId = kvp.Key.PgId;
                var amount = kvp.Value;

                var debit = new Entity(EntityNames.Distributions);
                debit[DistributionsAttributes.Amount] = amount; // Decimal write
                debit[DistributionsAttributes.Fund] = new EntityReference(EntityNames.Fund, fundId);
                debit[DistributionsAttributes.PGSAG] = new EntityReference(EntityNames.PG, pgId);
                debit[DistributionsAttributes.FundCenter] = turnInFundCenter;
                debit[DistributionsAttributes.DisbursementDirection] =
                    new OptionSetValue(DisbursementDirectionValues.Debit);
                debit[DistributionsAttributes.Remarks] = "Turn-In Debit Distribution";
                debit[DistributionsAttributes.TurnIn] = turnInRef;

                var id = service.Create(debit);
                tracing.Trace(
                    $"Created DEBIT distribution {id}: Amount={amount:C}, " +
                    $"Fund={fundId}, PG={pgId}, FC={turnInFundCenter.Id}");
            }

            // -----------------------------------------------------------------
            // Create the single CREDIT distribution.
            // -----------------------------------------------------------------
            var credit = new Entity(EntityNames.Distributions);
            credit[DistributionsAttributes.Amount] = headerAmount; // Decimal write
            credit[DistributionsAttributes.Fund] = turnInFund;
            credit[DistributionsAttributes.PGSAG] = turnInPg;
            credit[DistributionsAttributes.FundCenter] = creditFundCenter;
            credit[DistributionsAttributes.DisbursementDirection] =
                new OptionSetValue(DisbursementDirectionValues.Credit);
            credit[DistributionsAttributes.Remarks] = "Turn-In Credit Distribution";
            credit[DistributionsAttributes.TurnIn] = turnInRef;

            var creditId = service.Create(credit);
            tracing.Trace(
                $"Created CREDIT distribution {creditId}: Amount={headerAmount:C}, " +
                $"Fund={turnInFund.Id}, PG={turnInPg.Id}, FC={creditFundCenter.Id} (A18 root)");

            tracing.Trace("TurnInDistributionCreator: all distributions created successfully.");
        }

        /// <summary>
        /// Resolves the "A18" root Fund Center — the active FundCenter with no parent.
        /// Per the Phase-3 design, this is treated as the single credit-side FC for
        /// Turn-Ins. Throws if zero or more-than-one parent-less FundCenters exist.
        /// </summary>
        private static EntityReference ResolveRootFundCenter(
            IOrganizationService service,
            ITracingService tracing)
        {
            var query = new QueryExpression(EntityNames.FundCenter)
            {
                ColumnSet = new ColumnSet(FundCenterAttributes.Name),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundCenterAttributes.ParentFundCenter, ConditionOperator.Null),
                        new ConditionExpression(FundCenterAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    }
                },
                TopCount = 2, // pull 2 so we can detect ambiguity
            };

            var roots = service.RetrieveMultiple(query).Entities;
            if (roots.Count == 0)
            {
                throw new InvalidPluginExecutionException(
                    "Could not resolve the root (A18 main) Fund Center: no active Fund Center " +
                    "exists with a null parent. Configure the root Fund Center before " +
                    "approving a Turn-In.");
            }
            if (roots.Count > 1)
            {
                var names = string.Join(", ", roots.Select(e => e.GetAttributeValue<string>(FundCenterAttributes.Name)));
                throw new InvalidPluginExecutionException(
                    $"Ambiguous root Fund Center: more than one active Fund Center has a null " +
                    $"parent ({names}). The Phase-3 design assumes a single root; collapse to one " +
                    $"or update ResolveRootFundCenter with a tighter rule.");
            }

            var root = roots[0];
            var name = root.GetAttributeValue<string>(FundCenterAttributes.Name);
            tracing.Trace($"Resolved root Fund Center: {root.Id} '{name}'");
            return root.ToEntityReference();
        }

        /// <summary>
        /// Composite key for (Fund, PG) grouping. EntityReference doesn't ship with
        /// a stable Equals/GetHashCode usable as a dictionary key, so use Guid pairs.
        /// </summary>
        private readonly struct FundPgKey : IEquatable<FundPgKey>
        {
            public Guid FundId { get; }
            public Guid PgId { get; }

            public FundPgKey(Guid fundId, Guid pgId)
            {
                FundId = fundId;
                PgId = pgId;
            }

            public bool Equals(FundPgKey other) => FundId == other.FundId && PgId == other.PgId;
            public override bool Equals(object obj) => obj is FundPgKey o && Equals(o);
            public override int GetHashCode() => FundId.GetHashCode() ^ (PgId.GetHashCode() << 1);
        }
    }
}
