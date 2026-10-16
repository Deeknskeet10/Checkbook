using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Creates AFP and Allotment Distributions for an approved Turn-In.
    ///
    /// AFP and Allotment are the only ledger types that flow through book_distributions.
    /// TDP isn't a Distribution — it moves via LedgerCreator and the RF / Prio /
    /// LOA updates in the orchestrator.
    ///
    /// For each non-zero amount, emits one debit/credit pair (via <see cref="DistributionWriter"/>):
    ///   • Debit  FC = the Turn-In's FundCenter walked up to state level (e.g. A18MN)
    ///   • Credit FC = the A18 holding FC (env var book_DistributionHoldingFundCenter —
    ///     the same FC the GenerateDistributions reconcile nets against)
    ///   • Fund + PG = the Turn-In header's Fund + PG (legacy / Sweep) or the items'
    ///     LOA Fund + PG (item-based)
    /// Both sides carry book_fundingevent so the formula column book_fundingtype resolves.
    /// </summary>
    public static class TurnInDistributionCreator
    {
        /// <summary>
        /// Header-based Turn-In (legacy FY26 and Sweep): reads pre-computed
        /// book_afpamount / book_allotmentamount off the header (set by
        /// TurnInAmountCalculator, or by GenerateDistributions for Sweeps).
        /// </summary>
        public static void CreateDistributions(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn)
        {
            tracing.Trace("TurnInDistributionCreator: creating AFP/Allotment distributions...");

            var turnInFundCenter = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.FundCenter);
            var turnInFund       = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.Fund);
            var turnInPg         = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.PG);
            if (turnInFundCenter == null || turnInFund == null || turnInPg == null)
            {
                throw new InvalidPluginExecutionException(
                    "Turn-In is missing FundCenter / Fund / PG — cannot create distributions.");
            }

            var afpAmount   = NumericHelper.ToDecimal(turnIn, TurninAttributes.AFPAmount) ?? 0m;
            var allotAmount = NumericHelper.ToDecimal(turnIn, TurninAttributes.AllotmentAmount) ?? 0m;

            if (afpAmount <= 0m && allotAmount <= 0m)
            {
                tracing.Trace("Both AFP and Allotment amounts ≤ 0 — no Distributions to create.");
                return;
            }

            var anchors = ResolveAnchors(service, tracing, turnInFundCenter);
            var turnInRef = turnIn.ToEntityReference();
            var asOf = DateTime.UtcNow.Date;

            int created = 0;
            if (afpAmount > 0m)
                created += EmitPair(service, tracing, turnInRef, turnInFund, turnInPg, anchors,
                                    FundingTypeValues.AFP, "AFP", afpAmount, asOf);
            if (allotAmount > 0m)
                created += EmitPair(service, tracing, turnInRef, turnInFund, turnInPg, anchors,
                                    FundingTypeValues.Allotment, "Allotment", allotAmount, asOf);

            tracing.Trace($"TurnInDistributionCreator: {created} distribution row(s) created.");
        }

        /// <summary>
        /// Item-based Turn-In: the header has no Fund/PG, and one Turn-In may span several
        /// Fund/SAGs. Items are grouped by their LOA's (Fund, PG); each group emits one AFP and
        /// one Allotment pair sized from the items' own book_afpamount / book_allotmentamount
        /// (TurnInItemAmountCalculator). Same FC anchors as the header path.
        /// </summary>
        public static void CreateDistributionsByItems(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn,
            List<TurnInItemRecord> items)
        {
            var turnInFundCenter = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.FundCenter);
            if (turnInFundCenter == null)
                throw new InvalidPluginExecutionException(
                    "Turn-In is missing its Fund Center — cannot create distributions.");

            var groups = items
                .Where(i => i.LOAFund != null && i.LOAPG != null)
                .GroupBy(i => new { Fund = i.LOAFund.Id, Pg = i.LOAPG.Id })
                .Select(g => new
                {
                    Fund = g.First().LOAFund,
                    Pg = g.First().LOAPG,
                    Afp = g.Sum(i => i.AFPAmount),
                    Allot = g.Sum(i => i.AllotmentAmount),
                })
                .Where(g => g.Afp > 0m || g.Allot > 0m)
                .ToList();

            if (groups.Count == 0)
            {
                tracing.Trace("No item carries AFP/Allotment — no Distributions to create.");
                return;
            }

            var anchors = ResolveAnchors(service, tracing, turnInFundCenter);
            var turnInRef = turnIn.ToEntityReference();
            var asOf = DateTime.UtcNow.Date;

            int created = 0;
            foreach (var g in groups)
            {
                if (g.Afp > 0m)
                    created += EmitPair(service, tracing, turnInRef, g.Fund, g.Pg, anchors,
                                        FundingTypeValues.AFP, "AFP", g.Afp, asOf);
                if (g.Allot > 0m)
                    created += EmitPair(service, tracing, turnInRef, g.Fund, g.Pg, anchors,
                                        FundingTypeValues.Allotment, "Allotment", g.Allot, asOf);
            }

            tracing.Trace($"TurnInDistributionCreator (items): {created} distribution row(s) across {groups.Count} Fund/PG group(s).");
        }

        private sealed class Anchors
        {
            public EntityReference StateFc;
            public EntityReference HoldingFc;
        }

        private static Anchors ResolveAnchors(
            IOrganizationService service, ITracingService tracing, EntityReference turnInFundCenter)
        {
            var holdingFc = DistributionWriter.GetHoldingFundCenter(service);
            var stateFcId = FundCenterWalkHelper.ResolveStateFundCenter(
                service, new Dictionary<Guid, FundCenterMeta>(), tracing, turnInFundCenter.Id, holdingFc.Id);
            tracing.Trace($"Turn-In FC {turnInFundCenter.Id} → state FC {stateFcId}; holding FC {holdingFc.Id}.");
            return new Anchors
            {
                StateFc = new EntityReference(EntityNames.FundCenter, stateFcId),
                HoldingFc = holdingFc,
            };
        }

        private static int EmitPair(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference turnInRef,
            EntityReference fundRef,
            EntityReference pgRef,
            Anchors anchors,
            int fundingType,
            string typeName,
            decimal amount,
            DateTime asOf)
        {
            var resolution = FundingPercentageHelper.Resolve(
                service, tracing, fundRef.Id, pgRef.Id, fundingType, asOf);
            if (resolution == null)
            {
                tracing.Trace(
                    $"  {typeName} amount = {amount:C} but no active {typeName} FundingEvent for " +
                    $"(Fund={fundRef.Id}, PG={pgRef.Id}) at {asOf:yyyy-MM-dd}. Skipping pair — " +
                    $"the column should not have been populated without an active event.");
                return 0;
            }

            var created = DistributionWriter.CreatePair(
                service, DistributionsAttributes.TurnIn, turnInRef, fundRef, pgRef,
                resolution.FundingEvent, amount, anchors.StateFc, anchors.HoldingFc,
                $"Turn-In {typeName} Debit", $"Turn-In {typeName} Credit");

            tracing.Trace(
                $"  → {typeName} pair Amount={amount:C} Fund={fundRef.Id} PG={pgRef.Id} " +
                $"FE={resolution.FundingEvent.Id}");
            return created;
        }
    }
}
