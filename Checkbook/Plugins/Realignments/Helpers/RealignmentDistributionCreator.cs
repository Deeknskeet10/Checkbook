using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Realignments.Helpers
{
    /// <summary>
    /// Creates AFP and Allotment Distributions for an approved Realignment whose
    /// debit and credit LOAs do NOT share the same Fund AND SAG/PG
    /// (book_samefundandsag == false). Same-Fund-and-SAG realignments move
    /// fungible money within one bucket and need no Distribution rebalancing.
    ///
    /// Model (per stakeholder): the debited state returns the debited Fund to A18,
    /// then A18 issues the desired credited Fund back out — "send the funds back
    /// to A18 so we can swap them out and send the desired funds back to the
    /// state." Each direction therefore produces one debit/credit pair per active
    /// funding type:
    ///   1. "Turn-In" pair (debit LOA's Fund/PG):
    ///        Debit @ debited-state FC → Credit @ holding FC (A18)
    ///   2. "Distribution" pair (credit LOA's Fund/PG):
    ///        Debit @ holding FC (A18) → Credit @ credited-state FC
    /// The two pairs deliberately carry DIFFERENT Fund/PG (that difference is the
    /// whole reason we route through A18) and each resolves its own FundingEvent
    /// and distribution percentage, so A18 absorbs the debited Fund and emits the
    /// credited Fund rather than netting to zero.
    ///
    /// State-level FCs are resolved by walking the debit/credit anchor FC
    /// (the Prioritization's or Requirement Funding's book_fundcenter) up the
    /// parent chain to the FC whose parent is the holding FC (A18) — the same rule
    /// the GenerateDistributions reconcile and SwapDistributionCreator use.
    /// Per type, amount = realignment amount × FundingDetails percentage; a type
    /// with no active FundingEvent for a side's Fund/PG is skipped (traced),
    /// matching SwapDistributionCreator / TurnInDistributionCreator.
    ///
    /// Every row is linked to the realignment via book_realignment — the
    /// realignment-related Distribution views key off this lookup and the
    /// reconcile treats realignment-linked rows as immutable.
    /// </summary>
    public static class RealignmentDistributionCreator
    {
        private const string HoldingFundCenterEnvVar = "book_DistributionHoldingFundCenter";

        public static void CreateDistributions(
            IOrganizationService service,
            ITracingService tracing,
            Guid realignmentId,
            EntityReference debitAnchorFundCenter,
            EntityReference creditAnchorFundCenter,
            EntityReference debitLoa,
            EntityReference creditLoa,
            decimal amount)
        {
            tracing.Trace("RealignmentDistributionCreator: creating AFP/Allotment distributions...");

            if (amount <= 0m)
            {
                tracing.Trace("  Realignment amount ≤ 0 — no Distributions to create.");
                return;
            }
            if (debitLoa == null || creditLoa == null)
            {
                throw new InvalidPluginExecutionException(
                    "Realignment is missing Debited or Credited LOA — cannot create distributions.");
            }
            if (debitAnchorFundCenter == null || creditAnchorFundCenter == null)
            {
                throw new InvalidPluginExecutionException(
                    "Realignment debit/credit anchor (Prioritization or Requirement Funding) has no " +
                    "Fund Center — cannot resolve the state Fund Center for distributions.");
            }

            var holdingFundCenterId = EnvironmentVariableHelper.GetGuid(service, HoldingFundCenterEnvVar);
            var holdingFcRef = new EntityReference(EntityNames.FundCenter, holdingFundCenterId);
            var fcCache = new Dictionary<Guid, FundCenterMeta>();
            var realignmentRef = new EntityReference(EntityNames.Realignments, realignmentId);
            var asOf = DateTime.UtcNow.Date;

            // Resolve each side's Fund + PG/SAG from its LOA (FundingLine).
            var debitLoaRow = service.Retrieve(EntityNames.FundingLine, debitLoa.Id,
                new Microsoft.Xrm.Sdk.Query.ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.PG));
            var creditLoaRow = service.Retrieve(EntityNames.FundingLine, creditLoa.Id,
                new Microsoft.Xrm.Sdk.Query.ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.PG));

            var debitFund = debitLoaRow.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
            var debitPg = debitLoaRow.GetAttributeValue<EntityReference>(FundingLineAttributes.PG);
            var creditFund = creditLoaRow.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
            var creditPg = creditLoaRow.GetAttributeValue<EntityReference>(FundingLineAttributes.PG);

            if (debitFund == null || debitPg == null || creditFund == null || creditPg == null)
            {
                throw new InvalidPluginExecutionException(
                    "Realignment debit/credit LOA is missing Fund or PG — cannot create distributions.");
            }

            // Walk each anchor FC up to its state-level FC (parent = holding FC).
            var debitStateFcId = FundCenterWalkHelper.ResolveStateFundCenter(
                service, fcCache, tracing, debitAnchorFundCenter.Id, holdingFundCenterId);
            var creditStateFcId = FundCenterWalkHelper.ResolveStateFundCenter(
                service, fcCache, tracing, creditAnchorFundCenter.Id, holdingFundCenterId);

            var debitStateFc = new EntityReference(EntityNames.FundCenter, debitStateFcId);
            var creditStateFc = new EntityReference(EntityNames.FundCenter, creditStateFcId);

            tracing.Trace(
                $"  Debited state FC={debitStateFcId} (Fund={debitFund.Id}, PG={debitPg.Id}); " +
                $"Credited state FC={creditStateFcId} (Fund={creditFund.Id}, PG={creditPg.Id}); " +
                $"amount={amount:C}.");

            var pctCache = new Dictionary<string, FundingPercentageHelper.FundingResolution>();
            var created = 0;
            created += EmitType(service, tracing, realignmentRef, holdingFcRef, amount, asOf, pctCache,
                debitStateFc, debitFund, debitPg, creditStateFc, creditFund, creditPg,
                FundingTypeValues.AFP, "AFP");
            created += EmitType(service, tracing, realignmentRef, holdingFcRef, amount, asOf, pctCache,
                debitStateFc, debitFund, debitPg, creditStateFc, creditFund, creditPg,
                FundingTypeValues.Allotment, "Allotment");

            tracing.Trace($"RealignmentDistributionCreator: {created} distribution row(s) created.");
        }

        private static int EmitType(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference realignmentRef,
            EntityReference holdingFcRef,
            decimal amount,
            DateTime asOf,
            IDictionary<string, FundingPercentageHelper.FundingResolution> pctCache,
            EntityReference debitStateFc,
            EntityReference debitFund,
            EntityReference debitPg,
            EntityReference creditStateFc,
            EntityReference creditFund,
            EntityReference creditPg,
            int fundingType,
            string typeName)
        {
            var created = 0;

            // Pair 1 — the debited state returns the debited Fund to A18.
            var debitRes = FundingPercentageHelper.Resolve(
                service, tracing, debitFund.Id, debitPg.Id, fundingType, asOf, pctCache);
            if (debitRes == null)
            {
                tracing.Trace(
                    $"  No active {typeName} FundingEvent for debit side " +
                    $"(Fund={debitFund.Id}, PG={debitPg.Id}) at {asOf:yyyy-MM-dd} — skipping Turn-In pair.");
            }
            else
            {
                var turnInAmount = Math.Round(amount * debitRes.Percentage / 100m, 2);
                if (turnInAmount <= 0m)
                {
                    tracing.Trace($"  {typeName} Turn-In amount rounds to ≤ 0 (amount={amount:C}, pct={debitRes.Percentage}) — skipping.");
                }
                else
                {
                    var turnInDebitId = CreateRow(service, realignmentRef, debitFund, debitPg,
                        debitRes.FundingEvent, turnInAmount, debitStateFc,
                        DisbursementDirectionValues.Debit, $"Realignment Turn-In {typeName} Debit", null);
                    CreateRow(service, realignmentRef, debitFund, debitPg,
                        debitRes.FundingEvent, turnInAmount, holdingFcRef,
                        DisbursementDirectionValues.Credit, $"Realignment Turn-In {typeName} Credit", turnInDebitId);
                    created += 2;
                    tracing.Trace(
                        $"  → {typeName} Turn-In {debitStateFc.Id} → A18: {turnInAmount:C} " +
                        $"(pct={debitRes.Percentage}, Fund={debitFund.Id}, PG={debitPg.Id}, FE={debitRes.FundingEvent.Id}).");
                }
            }

            // Pair 2 — A18 issues the desired credited Fund out to the credited state.
            var creditRes = FundingPercentageHelper.Resolve(
                service, tracing, creditFund.Id, creditPg.Id, fundingType, asOf, pctCache);
            if (creditRes == null)
            {
                tracing.Trace(
                    $"  No active {typeName} FundingEvent for credit side " +
                    $"(Fund={creditFund.Id}, PG={creditPg.Id}) at {asOf:yyyy-MM-dd} — skipping Distribution pair.");
            }
            else
            {
                var distAmount = Math.Round(amount * creditRes.Percentage / 100m, 2);
                if (distAmount <= 0m)
                {
                    tracing.Trace($"  {typeName} Distribution amount rounds to ≤ 0 (amount={amount:C}, pct={creditRes.Percentage}) — skipping.");
                }
                else
                {
                    var distDebitId = CreateRow(service, realignmentRef, creditFund, creditPg,
                        creditRes.FundingEvent, distAmount, holdingFcRef,
                        DisbursementDirectionValues.Debit, $"Realignment Distribution {typeName} Debit", null);
                    CreateRow(service, realignmentRef, creditFund, creditPg,
                        creditRes.FundingEvent, distAmount, creditStateFc,
                        DisbursementDirectionValues.Credit, $"Realignment Distribution {typeName} Credit", distDebitId);
                    created += 2;
                    tracing.Trace(
                        $"  → {typeName} Distribution A18 → {creditStateFc.Id}: {distAmount:C} " +
                        $"(pct={creditRes.Percentage}, Fund={creditFund.Id}, PG={creditPg.Id}, FE={creditRes.FundingEvent.Id}).");
                }
            }

            return created;
        }

        private static Guid CreateRow(
            IOrganizationService service,
            EntityReference realignmentRef,
            EntityReference fund,
            EntityReference pg,
            EntityReference fundingEvent,
            decimal amount,
            EntityReference fundCenter,
            int direction,
            string remarks,
            Guid? debitedDistributionId)
        {
            var row = new Entity(EntityNames.Distributions);
            row[DistributionsAttributes.Amount]                = amount;
            row[DistributionsAttributes.Fund]                  = fund;
            row[DistributionsAttributes.PGSAG]                 = pg;
            row[DistributionsAttributes.FundCenter]            = fundCenter;
            row[DistributionsAttributes.FundingEvent]          = fundingEvent;
            row[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(direction);
            row[DistributionsAttributes.ManualEntry]           = false;
            row[DistributionsAttributes.Remarks]               = remarks;
            row[DistributionsAttributes.Realignment]           = realignmentRef;
            if (debitedDistributionId.HasValue)
                row[DistributionsAttributes.DebitedDistribution] =
                    new EntityReference(EntityNames.Distributions, debitedDistributionId.Value);
            return service.Create(row);
        }
    }
}
