using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Distributions.Helpers
{
    /// <summary>
    /// One Generate-Distributions bucket: a unique (Fund, PG, FundCenter, FiscalYear)
    /// tuple plus the funded total it represents. Built from either a Prioritization
    /// aggregation (Phase 2) or a Requirement-Funding aggregation (Phase 3) — the
    /// downstream decision logic is identical.
    /// </summary>
    public sealed class DistributionBucket
    {
        public Guid FundId { get; set; }
        public Guid PgId { get; set; }

        /// <summary>The "destination" FC — receives the credit side. Parent FC in Phase 2,
        /// resolved (parent-or-self) FC in Phase 3.</summary>
        public Guid FundCenterId { get; set; }

        public int FiscalYear { get; set; }

        /// <summary>Sum of book_newfundedamounttdp (Phase 2) or book_newfundedamount (Phase 3).</summary>
        public decimal TotalFunding { get; set; }
    }

    public sealed class BucketResult
    {
        public int DistributionsCreated;  // counts pairs as 2 (debit + credit)
        public int TurnInsCreated;
        public int Skipped;
    }

    /// <summary>
    /// Compares a bucket's <c>target</c> (TotalFunding × distributionpercentage / 100)
    /// against the sum of existing credit Distributions for that (Fund, FC, PG) and:
    ///   • Target &gt; existing  → create a debit/credit pair for the shortfall.
    ///   • Target &lt; existing  → create a Turn-In for the overage (unless an open one exists).
    ///   • Target == existing → no-op.
    ///
    /// Mirrors the per-iteration body of "Loop_through_Prioritizations" / "Loop_through_Requirements"
    /// in the legacy <c>Distribution-GenerateAFPDistributions</c> flow.
    /// </summary>
    public static class DistributionBucketProcessor
    {
        public static BucketResult Process(
            IOrganizationService service,
            ITracingService tracing,
            DistributionBucket bucket,
            EntityReference fundingEvent,
            Guid holdingFundCenterId,
            EntityReference owningBu)
        {
            var result = new BucketResult();

            var distPct = LookupDistributionPercentage(
                service, fundingEvent.Id, bucket.PgId, bucket.FundId);
            if (distPct == null)
            {
                tracing.Trace(
                    $"  No FundingDetails row for (FE={fundingEvent.Id}, PG={bucket.PgId}, " +
                    $"Fund={bucket.FundId}) — skipping bucket.");
                result.Skipped++;
                return result;
            }

            var target = bucket.TotalFunding * distPct.Value / 100m;
            var existing = SumExistingCreditDistributions(
                service, bucket.FundId, bucket.FundCenterId, bucket.PgId);

            tracing.Trace(
                $"  Bucket (Fund={bucket.FundId}, FC={bucket.FundCenterId}, PG={bucket.PgId}, " +
                $"FY={bucket.FiscalYear}): funded={bucket.TotalFunding:C}, pct={distPct:F2}, " +
                $"target={target:C}, existingCredits={existing:C}.");

            if (target > existing)
            {
                var amount = target - existing;
                CreateDistributionPair(
                    service, tracing, bucket, amount, fundingEvent, holdingFundCenterId, owningBu);
                result.DistributionsCreated += 2;
            }
            else if (existing > target)
            {
                if (OpenTurnInExists(service, bucket.FundId, bucket.FundCenterId, bucket.PgId))
                {
                    tracing.Trace("  Overage detected but an open Turn-In already exists — skipping.");
                }
                else
                {
                    var amount = existing - target;
                    CreateOverageTurnIn(
                        service, tracing, bucket, amount, owningBu);
                    result.TurnInsCreated++;
                }
            }

            return result;
        }

        private static decimal? LookupDistributionPercentage(
            IOrganizationService service, Guid fundingEventId, Guid pgId, Guid fundId)
        {
            var query = new QueryExpression(EntityNames.FundingDetails)
            {
                ColumnSet = new ColumnSet(FundingDetailsAttributes.DistributionPercentage),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingDetailsAttributes.FundingEvent, ConditionOperator.Equal, fundingEventId),
                        new ConditionExpression(FundingDetailsAttributes.PGSAG,       ConditionOperator.Equal, pgId),
                        new ConditionExpression(FundingDetailsAttributes.Fund,         ConditionOperator.Equal, fundId),
                    },
                },
                NoLock = true,
            };

            var fd = service.RetrieveMultiple(query).Entities.FirstOrDefault();
            if (fd == null) return null;

            var raw = fd.Contains(FundingDetailsAttributes.DistributionPercentage)
                ? fd[FundingDetailsAttributes.DistributionPercentage]
                : null;
            return NumericHelper.ToDecimal(raw, 0m);
        }

        private static decimal SumExistingCreditDistributions(
            IOrganizationService service, Guid fundId, Guid fundCenterId, Guid pgId)
        {
            // Cumulative across funding events — the legacy flow does not segment
            // by FundingEvent here. Fund alone pins fiscal year (each Fund record is
            // FY-specific), so a fund/fc/pg filter is already FY-scoped.
            var query = new QueryExpression(EntityNames.Distributions)
            {
                ColumnSet = new ColumnSet(DistributionsAttributes.Amount),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(DistributionsAttributes.Fund,                  ConditionOperator.Equal, fundId),
                        new ConditionExpression(DistributionsAttributes.FundCenter,            ConditionOperator.Equal, fundCenterId),
                        new ConditionExpression(DistributionsAttributes.PGSAG,                 ConditionOperator.Equal, pgId),
                        new ConditionExpression(DistributionsAttributes.DisbursementDirection, ConditionOperator.Equal, DisbursementDirectionValues.Credit),
                        new ConditionExpression(DistributionsAttributes.StateCode,             ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                PageInfo = new PagingInfo { Count = 5000, PageNumber = 1, ReturnTotalRecordCount = false },
                NoLock = true,
            };

            decimal total = 0m;
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                foreach (var d in page.Entities)
                    total += NumericHelper.ToDecimal(
                        d.Contains(DistributionsAttributes.Amount) ? d[DistributionsAttributes.Amount] : null,
                        0m);

                if (!page.MoreRecords) break;
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
            return total;
        }

        private static bool OpenTurnInExists(
            IOrganizationService service, Guid fundId, Guid fundCenterId, Guid pgId)
        {
            var query = new QueryExpression(EntityNames.Turnin)
            {
                ColumnSet = new ColumnSet(TurninAttributes.Id),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(TurninAttributes.Fund,        ConditionOperator.Equal, fundId),
                        new ConditionExpression(TurninAttributes.FundCenter,  ConditionOperator.Equal, fundCenterId),
                        new ConditionExpression(TurninAttributes.PG,          ConditionOperator.Equal, pgId),
                        new ConditionExpression(TurninAttributes.StateCode,   ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(TurninAttributes.BEApproved,  ConditionOperator.Equal, false),
                    },
                },
                NoLock = true,
            };
            return service.RetrieveMultiple(query).Entities.Count > 0;
        }

        private static void CreateDistributionPair(
            IOrganizationService service,
            ITracingService tracing,
            DistributionBucket bucket,
            decimal amount,
            EntityReference fundingEvent,
            Guid holdingFundCenterId,
            EntityReference owningBu)
        {
            // Debit side — funds leave the holding FC (A18 historically).
            var debit = new Entity(EntityNames.Distributions);
            debit[DistributionsAttributes.Amount]                = amount;
            debit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, bucket.FundId);
            debit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, holdingFundCenterId);
            debit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, bucket.PgId);
            debit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Debit);
            debit[DistributionsAttributes.FundingEvent]          = fundingEvent;
            debit[DistributionsAttributes.ManualEntry]           = false;
            if (owningBu != null)
                debit["owningbusinessunit"] = owningBu;

            var debitId = service.Create(debit);

            // Credit side — funds arrive at the bucket FC; linked back to the debit.
            var credit = new Entity(EntityNames.Distributions);
            credit[DistributionsAttributes.Amount]                = amount;
            credit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, bucket.FundId);
            credit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, bucket.FundCenterId);
            credit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, bucket.PgId);
            credit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Credit);
            credit[DistributionsAttributes.FundingEvent]          = fundingEvent;
            credit[DistributionsAttributes.DebitedDistribution]   = new EntityReference(EntityNames.Distributions, debitId);
            credit[DistributionsAttributes.ManualEntry]           = false;
            if (owningBu != null)
                credit["owningbusinessunit"] = owningBu;

            var creditId = service.Create(credit);

            tracing.Trace($"  → Created Debit {debitId} + Credit {creditId} for {amount:C}.");
        }

        private static void CreateOverageTurnIn(
            IOrganizationService service,
            ITracingService tracing,
            DistributionBucket bucket,
            decimal amount,
            EntityReference owningBu)
        {
            var turnIn = new Entity(EntityNames.Turnin);
            turnIn[TurninAttributes.Amount]     = amount;
            turnIn[TurninAttributes.FiscalYear] = bucket.FiscalYear;
            turnIn[TurninAttributes.Fund]       = new EntityReference(EntityNames.Fund, bucket.FundId);
            turnIn[TurninAttributes.FundCenter] = new EntityReference(EntityNames.FundCenter, bucket.FundCenterId);
            turnIn[TurninAttributes.PG]         = new EntityReference(EntityNames.PG, bucket.PgId);
            if (owningBu != null)
                turnIn["owningbusinessunit"] = owningBu;

            var id = service.Create(turnIn);
            tracing.Trace($"  → Created overage Turn-In {id} for {amount:C}.");
        }
    }
}
