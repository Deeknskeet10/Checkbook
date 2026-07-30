using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.StateSwaps.Helpers
{
    /// <summary>
    /// Creates AFP and Allotment Distributions for a BE-approved State Swap.
    ///
    /// Model (per stakeholder): a swap is both states performing a Turn-In to
    /// A18, then A18 distributing the agreed amounts back out. Each flow
    /// direction therefore produces TWO debit/credit pairs per funding type:
    ///   1. "Turn-In" pair:      Debit @ giving-state FC → Credit @ holding FC (A18)
    ///   2. "Distribution" pair: Debit @ holding FC (A18) → Credit @ receiving-state FC
    /// Opposing directions are NOT netted — each routes through A18 on its own.
    /// A18 nets to zero per (Fund, PG, type); the giving FC nets −amount and the
    /// receiving FC +amount, matching the funded-TDP deltas the swap applies, so
    /// the GenerateDistributions reconcile sees balanced buckets afterward.
    ///
    /// Items are grouped by (giving state FC, receiving state FC, Fund, PG) and
    /// summed. State-level FCs are resolved by walking each Prio's FundCenter up
    /// the parent chain to the FC whose parent is the holding FC (same rule as
    /// the reconcile's bucket destinations). Per funding type, amount =
    /// Σ TDP × FundingDetails percentage; a type with no active FundingEvent is
    /// skipped (traced), matching TurnInDistributionCreator.
    ///
    /// Every row is linked to the swap via book_stateswap — the swap-related
    /// Distribution views key off this lookup — and the reconcile treats
    /// swap-linked rows as immutable.
    /// </summary>
    public static class SwapDistributionCreator
    {
        private const string HoldingFundCenterEnvVar = "book_DistributionHoldingFundCenter";

        public static void CreateDistributions(
            IOrganizationService service,
            ITracingService tracing,
            Guid swapId,
            IList<ResolvedSwapItem> items)
        {
            tracing.Trace("SwapDistributionCreator: creating AFP/Allotment distributions...");

            var holdingFundCenterId = EnvironmentVariableHelper.GetGuid(service, HoldingFundCenterEnvVar);
            var holdingFcRef = new EntityReference(EntityNames.FundCenter, holdingFundCenterId);
            var fcCache = new Dictionary<Guid, FundCenterMeta>();
            var swapRef = new EntityReference(EntityNames.StateSwap, swapId);
            var asOf = DateTime.UtcNow.Date;

            // Group directed flows by (giving state FC, receiving state FC, Fund, PG).
            var flows = new Dictionary<string, SwapFlow>();
            foreach (var item in items)
            {
                if (item.Fund == null || item.PG == null)
                {
                    throw new InvalidPluginExecutionException(
                        $"Swap Item {item.SwapItemId} is missing its derived Fund or PG — " +
                        "cannot create distributions.");
                }
                if (item.DebitFundCenter == null || item.CreditFundCenter == null)
                {
                    throw new InvalidPluginExecutionException(
                        $"Swap Item {item.SwapItemId} has a Prioritization without a Fund Center — " +
                        "cannot create distributions.");
                }
                if (item.Amount <= 0m) continue;

                var givingFc = FundCenterWalkHelper.ResolveStateFundCenter(
                    service, fcCache, tracing, item.DebitFundCenter.Id, holdingFundCenterId);
                var receivingFc = FundCenterWalkHelper.ResolveStateFundCenter(
                    service, fcCache, tracing, item.CreditFundCenter.Id, holdingFundCenterId);

                if (givingFc == receivingFc)
                {
                    tracing.Trace(
                        $"  Item {item.SwapItemId}: both sides resolve to state FC {givingFc} — " +
                        "net-zero at the Distribution level, skipping.");
                    continue;
                }

                var key = $"{givingFc}|{receivingFc}|{item.Fund.Id}|{item.PG.Id}";
                if (flows.TryGetValue(key, out var flow))
                {
                    flow.Amount += item.Amount;
                }
                else
                {
                    flows[key] = new SwapFlow
                    {
                        GivingFc    = new EntityReference(EntityNames.FundCenter, givingFc),
                        ReceivingFc = new EntityReference(EntityNames.FundCenter, receivingFc),
                        Fund        = item.Fund,
                        PG          = item.PG,
                        Amount      = item.Amount,
                    };
                }
            }

            tracing.Trace($"SwapDistributionCreator: {flows.Count} directed flow(s) after grouping.");

            var pctCache = new Dictionary<string, FundingPercentageHelper.FundingResolution>();
            var created = 0;
            foreach (var flow in flows.Values.OrderBy(f => f.GivingFc.Id).ThenBy(f => f.Fund.Id))
            {
                created += EmitFlow(service, tracing, swapRef, flow, holdingFcRef,
                                    FundingTypeValues.AFP, "AFP", asOf, pctCache);
                created += EmitFlow(service, tracing, swapRef, flow, holdingFcRef,
                                    FundingTypeValues.Allotment, "Allotment", asOf, pctCache);
            }

            tracing.Trace($"SwapDistributionCreator: {created} distribution row(s) created.");
        }

        private sealed class SwapFlow
        {
            public EntityReference GivingFc;
            public EntityReference ReceivingFc;
            public EntityReference Fund;
            public EntityReference PG;
            public decimal Amount;
        }

        private static int EmitFlow(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference swapRef,
            SwapFlow flow,
            EntityReference holdingFcRef,
            int fundingType,
            string typeName,
            DateTime asOf,
            IDictionary<string, FundingPercentageHelper.FundingResolution> pctCache)
        {
            var resolution = FundingPercentageHelper.Resolve(
                service, tracing, flow.Fund.Id, flow.PG.Id, fundingType, asOf, pctCache);
            if (resolution == null)
            {
                tracing.Trace(
                    $"  No active {typeName} FundingEvent for (Fund={flow.Fund.Id}, PG={flow.PG.Id}) " +
                    $"at {asOf:yyyy-MM-dd} — skipping {typeName} pairs for this flow.");
                return 0;
            }

            var amount = Math.Round(flow.Amount * resolution.Percentage / 100m, 2);
            if (amount <= 0m)
            {
                tracing.Trace($"  {typeName} amount rounds to ≤ 0 (TDP={flow.Amount:C}, pct={resolution.Percentage}) — skipping.");
                return 0;
            }

            // Pair 1 — the giving state's "turn-in" to A18.
            var turnInDebitId = CreateRow(service, flow, swapRef, resolution.FundingEvent, amount,
                flow.GivingFc, DisbursementDirectionValues.Debit,
                $"State Swap Turn-In {typeName} Debit", null);
            CreateRow(service, flow, swapRef, resolution.FundingEvent, amount,
                holdingFcRef, DisbursementDirectionValues.Credit,
                $"State Swap Turn-In {typeName} Credit", turnInDebitId);

            // Pair 2 — A18's distribution out to the receiving state.
            var distDebitId = CreateRow(service, flow, swapRef, resolution.FundingEvent, amount,
                holdingFcRef, DisbursementDirectionValues.Debit,
                $"State Swap Distribution {typeName} Debit", null);
            CreateRow(service, flow, swapRef, resolution.FundingEvent, amount,
                flow.ReceivingFc, DisbursementDirectionValues.Credit,
                $"State Swap Distribution {typeName} Credit", distDebitId);

            tracing.Trace(
                $"  → {typeName} {flow.GivingFc.Id} → A18 → {flow.ReceivingFc.Id}: " +
                $"{amount:C} (TDP={flow.Amount:C}, pct={resolution.Percentage}, " +
                $"Fund={flow.Fund.Id}, PG={flow.PG.Id}, FE={resolution.FundingEvent.Id}).");
            return 4;
        }

        private static Guid CreateRow(
            IOrganizationService service,
            SwapFlow flow,
            EntityReference swapRef,
            EntityReference fundingEvent,
            decimal amount,
            EntityReference fundCenter,
            int direction,
            string remarks,
            Guid? debitedDistributionId)
        {
            var row = new Entity(EntityNames.Distributions);
            row[DistributionsAttributes.Amount]                = amount;
            row[DistributionsAttributes.Fund]                  = flow.Fund;
            row[DistributionsAttributes.PGSAG]                 = flow.PG;
            row[DistributionsAttributes.FundCenter]            = fundCenter;
            row[DistributionsAttributes.FundingEvent]          = fundingEvent;
            row[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(direction);
            row[DistributionsAttributes.ManualEntry]           = false;
            row[DistributionsAttributes.Remarks]               = remarks;
            row[DistributionsAttributes.StateSwap]             = swapRef;
            if (debitedDistributionId.HasValue)
                row[DistributionsAttributes.DebitedDistribution] =
                    new EntityReference(EntityNames.Distributions, debitedDistributionId.Value);
            return service.Create(row);
        }
    }
}
