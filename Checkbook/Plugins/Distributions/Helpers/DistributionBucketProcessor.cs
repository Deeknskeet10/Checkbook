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
    /// FundCenterId here is the *destination* FC (after parent/self resolution).
    /// OwningBusinessUnit is the dest FC's owning BU, resolved by the plugin during
    /// bucket construction so the processor doesn't have to look it up.
    /// </summary>
    public sealed class DistributionBucket
    {
        public Guid FundId { get; set; }
        public Guid PgId { get; set; }
        public Guid FundCenterId { get; set; }
        public int FiscalYear { get; set; }
        public decimal TotalFunding { get; set; }
        public EntityReference OwningBusinessUnit { get; set; }
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
    /// Processes a group of buckets that all share the same (Fund, PG). Each bucket in
    /// the group represents one destination FC's slice of the group's funding.
    ///
    /// For each destination, compares its <c>target</c> (TotalFunding × pct / 100)
    /// against the sum of existing TYPE-FILTERED credit Distributions at (Fund, dest FC, PG):
    ///   • target &gt; existing → shortfall; this destination gets a credit.
    ///                          Any lingering per-type overage on its open Sweep Turn-In
    ///                          is cleared.
    ///   • target &lt; existing → overage; per-destination Sweep Turn-In carries the
    ///                          per-type amount (one record per (Fund, FC, PG), both
    ///                          AFP and Allotment columns tracked independently).
    ///   • target == existing → if a Sweep Turn-In's per-type amount is non-zero, zero
    ///                          it out; deactivate if both type amounts hit 0.
    ///
    /// All shortfalls in the group are consolidated into ONE debit at the holding FC
    /// carrying the sum, and one credit per shortfall destination pointing at that
    /// shared debit via <c>book_debiteddistribution</c>.
    /// </summary>
    public static class DistributionBucketProcessor
    {
        public static BucketResult ProcessGroup(
            IOrganizationService service,
            ITracingService tracing,
            IList<DistributionBucket> groupBuckets,
            EntityReference fundingEvent,
            int fundingType,
            Guid holdingFundCenterId,
            EntityReference holdingOwningBu,
            IDictionary<string, FundingPercentageHelper.FundingResolution> pctCache = null)
        {
            var result = new BucketResult();
            if (groupBuckets == null || groupBuckets.Count == 0) return result;

            var fundId = groupBuckets[0].FundId;
            var pgId   = groupBuckets[0].PgId;

            var resolution = FundingPercentageHelper.Resolve(
                service, tracing, fundId, pgId, fundingType, DateTime.UtcNow.Date, pctCache);
            if (resolution == null || resolution.FundingEvent.Id != fundingEvent.Id)
            {
                tracing.Trace(
                    $"  No matching FundingDetails for (FE={fundingEvent.Id}, type={fundingType}, " +
                    $"Fund={fundId}, PG={pgId}) — skipping group ({groupBuckets.Count} destination(s)).");
                result.Skipped += groupBuckets.Count;
                return result;
            }

            var shortfalls = new List<(DistributionBucket bucket, decimal amount)>();

            foreach (var bucket in groupBuckets)
            {
                var target   = Math.Round(bucket.TotalFunding * resolution.Percentage / 100m, 2);
                var existing = SumExistingCreditDistributions(
                    service, fundId, bucket.FundCenterId, pgId, fundingType);

                tracing.Trace(
                    $"  Dest FC={bucket.FundCenterId} (FY={bucket.FiscalYear}, type={fundingType}): " +
                    $"funded={bucket.TotalFunding:C}, pct={resolution.Percentage}, " +
                    $"target={target:C}, existingCredits={existing:C}.");

                var openTurnIn = FindOpenSweepTurnIn(service, fundId, bucket.FundCenterId, pgId);

                if (target > existing)
                {
                    shortfalls.Add((bucket, target - existing));

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
                        CreateOverageTurnIn(service, tracing, bucket, overage, fundingType, bucket.OwningBusinessUnit);
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
                else // even
                {
                    if (openTurnIn != null && GetTypeAmount(openTurnIn, fundingType) > 0m)
                    {
                        if (ZeroTypeAmount(service, tracing, openTurnIn, fundingType))
                            result.TurnInsDeactivated++;
                        else
                            result.TurnInsUpdated++;
                    }
                }
            }

            if (shortfalls.Count > 0)
            {
                var totalDebit = shortfalls.Sum(s => s.amount);
                CreateConsolidatedDebitAndCredits(
                    service, tracing, fundId, pgId, shortfalls, totalDebit,
                    fundingEvent, holdingFundCenterId, holdingOwningBu);
                result.DistributionsCreated += 1 + shortfalls.Count;
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
        // One debit at the holding FC carrying the sum of all shortfall credits;
        // one credit per shortfall destination pointing at that shared debit.
        // Debit's owningbusinessunit is the holding FC's BU (since that's where
        // the debit lives); each credit's owningbusinessunit is its destination
        // FC's BU. All tagged with the active FundingEvent so book_fundingtype
        // resolves for each row.
        // -----------------------------------------------------------------
        private static void CreateConsolidatedDebitAndCredits(
            IOrganizationService service,
            ITracingService tracing,
            Guid fundId,
            Guid pgId,
            IList<(DistributionBucket bucket, decimal amount)> shortfalls,
            decimal totalDebit,
            EntityReference fundingEvent,
            Guid holdingFundCenterId,
            EntityReference holdingOwningBu)
        {
            var debit = new Entity(EntityNames.Distributions);
            debit[DistributionsAttributes.Amount]                = totalDebit;
            debit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, fundId);
            debit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, holdingFundCenterId);
            debit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, pgId);
            debit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Debit);
            debit[DistributionsAttributes.FundingEvent]          = fundingEvent;
            debit[DistributionsAttributes.ManualEntry]           = false;
            if (holdingOwningBu != null) debit["owningbusinessunit"] = holdingOwningBu;
            var debitId = service.Create(debit);
            var debitRef = new EntityReference(EntityNames.Distributions, debitId);

            tracing.Trace(
                $"  → Created consolidated Debit {debitId} at holding FC for {totalDebit:C} " +
                $"({shortfalls.Count} credit(s) to follow).");

            foreach (var s in shortfalls)
            {
                var credit = new Entity(EntityNames.Distributions);
                credit[DistributionsAttributes.Amount]                = s.amount;
                credit[DistributionsAttributes.Fund]                  = new EntityReference(EntityNames.Fund, fundId);
                credit[DistributionsAttributes.FundCenter]            = new EntityReference(EntityNames.FundCenter, s.bucket.FundCenterId);
                credit[DistributionsAttributes.PGSAG]                 = new EntityReference(EntityNames.PG, pgId);
                credit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Credit);
                credit[DistributionsAttributes.FundingEvent]          = fundingEvent;
                credit[DistributionsAttributes.DebitedDistribution]   = debitRef;
                credit[DistributionsAttributes.ManualEntry]           = false;
                if (s.bucket.OwningBusinessUnit != null) credit["owningbusinessunit"] = s.bucket.OwningBusinessUnit;
                var creditId = service.Create(credit);

                tracing.Trace($"    → Credit {creditId} to FC {s.bucket.FundCenterId} for {s.amount:C}.");
            }
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
            // book_fiscalyear is a picklist (goal_fiscalyear option set) — write as OptionSetValue, not raw int.
            turnIn[TurninAttributes.FiscalYear] = new OptionSetValue(bucket.FiscalYear);
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
