using System;
using System.Collections.Generic;
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
    /// aggregation (Phase 2) or a Requirement-Funding aggregation (Phase 3).
    /// </summary>
    public sealed class DistributionBucket
    {
        public Guid FundId { get; set; }
        public Guid PgId { get; set; }
        public Guid FundCenterId { get; set; }
        public int FiscalYear { get; set; }
        public decimal TotalFunding { get; set; }
    }

    public sealed class BucketResult
    {
        public int DistributionsCreated;  // counts pairs as 2 (debit + credit)
        public int TurnInsCreated;
        public int TurnInsUpdated;
        public int TurnInsDeactivated;
        public int Skipped;
    }

    /// <summary>
    /// Compares a bucket's <c>target</c> (TotalFunding × distributionpercentage / 100)
    /// against the sum of existing TYPE-FILTERED credit Distributions for that
    /// (Fund, FC, PG) and:
    ///   • target &gt; existing  → create a debit/credit pair for the shortfall;
    ///                            also deactivate any open Sweep Turn-In on this
    ///                            bucket's per-type amount column (baseline caught up).
    ///   • target &lt; existing  → record/refresh the overage on a Kind B Sweep
    ///                            Turn-In's per-type amount column. One Sweep Turn-In
    ///                            per (Fund, FC, PG), carrying both AFP and Allotment
    ///                            amounts independently.
    ///   • target == existing → if a Sweep Turn-In's per-type amount is non-zero,
    ///                            zero it out. Deactivate if both type amounts hit 0.
    /// </summary>
    public static class DistributionBucketProcessor
    {
        public static BucketResult Process(
            IOrganizationService service,
            ITracingService tracing,
            DistributionBucket bucket,
            EntityReference fundingEvent,
            int fundingType,
            Guid holdingFundCenterId,
            EntityReference owningBu,
            IDictionary<string, FundingPercentageHelper.FundingResolution> pctCache = null)
        {
            var result = new BucketResult();

            var resolution = FundingPercentageHelper.Resolve(
                service, tracing, bucket.FundId, bucket.PgId, fundingType, DateTime.UtcNow.Date, pctCache);
            if (resolution == null || resolution.FundingEvent.Id != fundingEvent.Id)
            {
                tracing.Trace(
                    $"  No matching FundingDetails for (FE={fundingEvent.Id}, type={fundingType}, " +
                    $"Fund={bucket.FundId}, PG={bucket.PgId}) — skipping bucket.");
                result.Skipped++;
                return result;
            }

            var target   = Math.Round(bucket.TotalFunding * resolution.Percentage / 100m, 2);
            var existing = SumExistingCreditDistributions(
                service, bucket.FundId, bucket.FundCenterId, bucket.PgId, fundingType);

            tracing.Trace(
                $"  Bucket (Fund={bucket.FundId}, FC={bucket.FundCenterId}, PG={bucket.PgId}, " +
                $"FY={bucket.FiscalYear}, type={fundingType}): funded={bucket.TotalFunding:C}, " +
                $"pct={resolution.Percentage}, target={target:C}, existingCredits={existing:C}.");

            // Find an open Sweep Turn-In for this bucket (any type — one record carries both).
            var openTurnIn = FindOpenSweepTurnIn(service, bucket.FundId, bucket.FundCenterId, bucket.PgId);

            if (target > existing)
            {
                var amount = target - existing;
                CreateDistributionPair(
                    service, tracing, bucket, amount, fundingEvent, holdingFundCenterId, owningBu);
                result.DistributionsCreated += 2;

                // Baseline now meets or exceeds existing for THIS type — clear any
                // lingering overage on the open Sweep Turn-In's matching column.
                if (openTurnIn != null && GetTypeAmount(openTurnIn, fundingType) > 0m)
                {
                    if (ZeroTypeAmount(service, tracing, openTurnIn, fundingType))
                        result.TurnInsDeactivated++;
                    else
                        result.TurnInsUpdated++;
                }
            }
            else if (existing > target)
            {
                var overage = existing - target;
                if (openTurnIn == null)
                {
                    CreateOverageTurnIn(service, tracing, bucket, overage, fundingType, owningBu);
                    result.TurnInsCreated++;
                }
                else
                {
                    var currentAmount = GetTypeAmount(openTurnIn, fundingType);
                    if (currentAmount != overage)
                    {
                        UpdateTypeAmount(service, tracing, openTurnIn, fundingType, overage);
                        result.TurnInsUpdated++;
                    }
                }
            }
            else // existing == target
            {
                if (openTurnIn != null && GetTypeAmount(openTurnIn, fundingType) > 0m)
                {
                    if (ZeroTypeAmount(service, tracing, openTurnIn, fundingType))
                        result.TurnInsDeactivated++;
                    else
                        result.TurnInsUpdated++;
                }
            }

            return result;
        }

        // -----------------------------------------------------------------
        // Existing credits — filtered by FundingType via link-entity on
        // book_fundingevent. Distributions whose FundingEvent is missing or
        // of a different type are excluded.
        // -----------------------------------------------------------------
        private static decimal SumExistingCreditDistributions(
            IOrganizationService service, Guid fundId, Guid fundCenterId, Guid pgId, int fundingType)
        {
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

            var feLink = query.AddLink(
                EntityNames.FundingEvent,
                DistributionsAttributes.FundingEvent,
                FundingEventAttributes.Id,
                JoinOperator.Inner);
            feLink.LinkCriteria = new FilterExpression(LogicalOperator.And)
            {
                Conditions =
                {
                    new ConditionExpression(FundingEventAttributes.FundingType, ConditionOperator.Equal, fundingType),
                },
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

        // -----------------------------------------------------------------
        // Open Kind B (Sweep) Turn-In lookup — one per (Fund, FC, PG), regardless
        // of type. AFP and Allotment overages live on separate columns of the
        // same record.
        // -----------------------------------------------------------------
        private static Entity FindOpenSweepTurnIn(
            IOrganizationService service, Guid fundId, Guid fundCenterId, Guid pgId)
        {
            var query = new QueryExpression(EntityNames.Turnin)
            {
                ColumnSet = new ColumnSet(
                    TurninAttributes.Id,
                    TurninAttributes.AFPAmount,
                    TurninAttributes.AllotmentAmount),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(TurninAttributes.Fund,        ConditionOperator.Equal, fundId),
                        new ConditionExpression(TurninAttributes.FundCenter,  ConditionOperator.Equal, fundCenterId),
                        new ConditionExpression(TurninAttributes.PG,          ConditionOperator.Equal, pgId),
                        new ConditionExpression(TurninAttributes.StateCode,   ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(TurninAttributes.Origin,      ConditionOperator.Equal, TurnInOriginValues.Sweep),
                        new ConditionExpression(TurninAttributes.BEApproved,  ConditionOperator.Equal, false),
                    },
                },
                NoLock = true,
            };
            return service.RetrieveMultiple(query).Entities.FirstOrDefault();
        }

        private static decimal GetTypeAmount(Entity turnIn, int fundingType)
        {
            var attr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AFPAmount
                : TurninAttributes.AllotmentAmount;
            return NumericHelper.ToDecimal(turnIn, attr) ?? 0m;
        }

        private static void UpdateTypeAmount(
            IOrganizationService service, ITracingService tracing,
            Entity turnIn, int fundingType, decimal newAmount)
        {
            var attr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AFPAmount
                : TurninAttributes.AllotmentAmount;
            service.Update(new Entity(EntityNames.Turnin, turnIn.Id) { [attr] = newAmount });
            // Update local copy so subsequent reads in this Process call see the new value.
            turnIn[attr] = newAmount;
            tracing.Trace($"  → Updated Sweep Turn-In {turnIn.Id} {attr} = {newAmount:C}.");
        }

        /// <summary>
        /// Zero the named-type column. If both type amounts are then 0, deactivate
        /// the Turn-In and return true; else return false.
        /// </summary>
        private static bool ZeroTypeAmount(
            IOrganizationService service, ITracingService tracing,
            Entity turnIn, int fundingType)
        {
            var attr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AFPAmount
                : TurninAttributes.AllotmentAmount;

            var otherAttr = fundingType == FundingTypeValues.AFP
                ? TurninAttributes.AllotmentAmount
                : TurninAttributes.AFPAmount;
            var otherAmount = NumericHelper.ToDecimal(turnIn, otherAttr) ?? 0m;

            if (otherAmount <= 0m)
            {
                // Both sides done — deactivate.
                service.Update(new Entity(EntityNames.Turnin, turnIn.Id)
                {
                    [attr] = 0m,
                    ["statecode"] = new OptionSetValue(StateCodeValues.Inactive),
                    ["statuscode"] = new OptionSetValue(2),
                });
                turnIn[attr] = 0m;
                tracing.Trace($"  → Deactivated Sweep Turn-In {turnIn.Id} (both type amounts cleared).");
                return true;
            }

            service.Update(new Entity(EntityNames.Turnin, turnIn.Id) { [attr] = 0m });
            turnIn[attr] = 0m;
            tracing.Trace($"  → Zeroed Sweep Turn-In {turnIn.Id} {attr} (other type still > 0).");
            return false;
        }

        // -----------------------------------------------------------------
        // Forward distribution: debit at holding FC, credit at bucket FC,
        // both tagged with the active FundingEvent (so book_fundingtype resolves).
        // -----------------------------------------------------------------
        private static void CreateDistributionPair(
            IOrganizationService service,
            ITracingService tracing,
            DistributionBucket bucket,
            decimal amount,
            EntityReference fundingEvent,
            Guid holdingFundCenterId,
            EntityReference owningBu)
        {
            var debit = new Entity(EntityNames.Distributions);
            debit[DistributionsAttributes.Amount]                = amount;
            debit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, bucket.FundId);
            debit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, holdingFundCenterId);
            debit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, bucket.PgId);
            debit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Debit);
            debit[DistributionsAttributes.FundingEvent]          = fundingEvent;
            debit[DistributionsAttributes.ManualEntry]           = false;
            if (owningBu != null) debit["owningbusinessunit"] = owningBu;
            var debitId = service.Create(debit);

            var credit = new Entity(EntityNames.Distributions);
            credit[DistributionsAttributes.Amount]                = amount;
            credit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, bucket.FundId);
            credit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, bucket.FundCenterId);
            credit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, bucket.PgId);
            credit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Credit);
            credit[DistributionsAttributes.FundingEvent]          = fundingEvent;
            credit[DistributionsAttributes.DebitedDistribution]   = new EntityReference(EntityNames.Distributions, debitId);
            credit[DistributionsAttributes.ManualEntry]           = false;
            if (owningBu != null) credit["owningbusinessunit"] = owningBu;
            var creditId = service.Create(credit);

            tracing.Trace($"  → Created Debit {debitId} + Credit {creditId} for {amount:C}.");
        }

        // -----------------------------------------------------------------
        // New Sweep Turn-In for an overage: Origin = Sweep, header Amount
        // (semantically TDP-amount) = 0, the type-specific column carries
        // the detected overage. The complementary column starts at 0.
        // -----------------------------------------------------------------
        private static void CreateOverageTurnIn(
            IOrganizationService service,
            ITracingService tracing,
            DistributionBucket bucket,
            decimal amount,
            int fundingType,
            EntityReference owningBu)
        {
            var turnIn = new Entity(EntityNames.Turnin);
            turnIn[TurninAttributes.Amount]     = 0m; // no TDP change
            turnIn[TurninAttributes.FiscalYear] = bucket.FiscalYear;
            turnIn[TurninAttributes.Fund]       = new EntityReference(EntityNames.Fund, bucket.FundId);
            turnIn[TurninAttributes.FundCenter] = new EntityReference(EntityNames.FundCenter, bucket.FundCenterId);
            turnIn[TurninAttributes.PG]         = new EntityReference(EntityNames.PG, bucket.PgId);
            turnIn[TurninAttributes.Origin]     = new OptionSetValue(TurnInOriginValues.Sweep);
            turnIn[TurninAttributes.AFPAmount]       = fundingType == FundingTypeValues.AFP       ? amount : 0m;
            turnIn[TurninAttributes.AllotmentAmount] = fundingType == FundingTypeValues.Allotment ? amount : 0m;
            if (owningBu != null) turnIn["owningbusinessunit"] = owningBu;

            var id = service.Create(turnIn);
            var typeName = fundingType == FundingTypeValues.AFP ? "AFP" : "Allotment";
            tracing.Trace($"  → Created Sweep Turn-In {id} ({typeName} overage {amount:C}).");
        }
    }
}
