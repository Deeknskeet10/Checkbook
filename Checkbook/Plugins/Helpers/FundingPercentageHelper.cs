using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Resolves the active Funding Event + distribution percentage for a given
    /// (Fund, PG/SAG, FundingType) at a point in time.
    ///
    /// Relies on the FundingEventValidator's non-overlap invariant: at any moment
    /// there is at most one active book_fundingevent of a given type whose
    /// [StartDate, EndDate] contains the as-of date. Defends against violations
    /// by throwing if more than one matching row is returned.
    /// </summary>
    public static class FundingPercentageHelper
    {
        public sealed class FundingResolution
        {
            public EntityReference FundingEvent { get; }
            public decimal Percentage { get; }

            public FundingResolution(EntityReference fundingEvent, decimal percentage)
            {
                FundingEvent = fundingEvent;
                Percentage = percentage;
            }
        }

        /// <summary>
        /// Returns the active (FundingEvent, percentage) pair, or null if no event
        /// of the given type is in effect for the supplied (Fund, PG/SAG) at asOf,
        /// or if the active event has no matching FundingDetails row.
        /// Throws if multiple active matches are found — that means the non-overlap
        /// invariant has been violated and Generate Distributions can no longer
        /// produce deterministic output.
        ///
        /// Pass a per-execution <paramref name="cache"/> to memoize across calls
        /// in the same plugin run (e.g. GenerateDistributions iterates many
        /// buckets that re-resolve identical Fund/PG/type tuples).
        /// </summary>
        public static FundingResolution Resolve(
            IOrganizationService service,
            ITracingService tracing,
            Guid fundId,
            Guid pgSagId,
            int fundingType,
            DateTime asOf,
            IDictionary<string, FundingResolution> cache = null)
        {
            if (service == null) throw new ArgumentNullException(nameof(service));
            if (fundId == Guid.Empty) throw new ArgumentException("fundId is empty.", nameof(fundId));
            if (pgSagId == Guid.Empty) throw new ArgumentException("pgSagId is empty.", nameof(pgSagId));

            var asOfDate = asOf.Date;

            string cacheKey = null;
            if (cache != null)
            {
                cacheKey = $"{fundId:N}|{pgSagId:N}|{fundingType}|{asOfDate:yyyyMMdd}";
                if (cache.TryGetValue(cacheKey, out var hit))
                {
                    tracing?.Trace(
                        $"FundingPercentageHelper: cache hit for {cacheKey} → " +
                        $"event={hit?.FundingEvent?.Id} pct={hit?.Percentage}.");
                    return hit;
                }
            }

            var query = new QueryExpression(EntityNames.FundingDetails)
            {
                ColumnSet = new ColumnSet(
                    FundingDetailsAttributes.FundingEvent,
                    FundingDetailsAttributes.DistributionPercentage),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingDetailsAttributes.Fund,      ConditionOperator.Equal, fundId),
                        new ConditionExpression(FundingDetailsAttributes.PGSAG,    ConditionOperator.Equal, pgSagId),
                        new ConditionExpression(FundingDetailsAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                TopCount = 2, // 2 so we can detect non-overlap violations
                NoLock = true,
            };

            var feLink = query.AddLink(
                EntityNames.FundingEvent,
                FundingDetailsAttributes.FundingEvent,
                FundingEventAttributes.Id,
                JoinOperator.Inner);
            feLink.EntityAlias = "fe";
            feLink.LinkCriteria = new FilterExpression(LogicalOperator.And)
            {
                Conditions =
                {
                    new ConditionExpression(FundingEventAttributes.FundingType, ConditionOperator.Equal, fundingType),
                    new ConditionExpression(FundingEventAttributes.StateCode,   ConditionOperator.Equal, StateCodeValues.Active),
                    new ConditionExpression(FundingEventAttributes.StartDate,   ConditionOperator.OnOrBefore, asOfDate),
                    new ConditionExpression(FundingEventAttributes.EndDate,     ConditionOperator.OnOrAfter,  asOfDate),
                },
            };

            var rows = service.RetrieveMultiple(query).Entities;
            if (rows.Count == 0)
            {
                tracing?.Trace(
                    $"FundingPercentageHelper: no active type={fundingType} event for " +
                    $"Fund={fundId}, PG/SAG={pgSagId} as of {asOfDate:yyyy-MM-dd}.");
                if (cacheKey != null) cache[cacheKey] = null;
                return null;
            }
            if (rows.Count > 1)
            {
                throw new InvalidPluginExecutionException(
                    $"FundingPercentageHelper: non-overlap invariant violated — found " +
                    $"{rows.Count}+ active type={fundingType} FundingDetails rows for " +
                    $"Fund={fundId}, PG/SAG={pgSagId} as of {asOfDate:yyyy-MM-dd}. " +
                    "FundingEventValidator should have prevented this.");
            }

            var fd = rows[0];
            var feRef = fd.GetAttributeValue<EntityReference>(FundingDetailsAttributes.FundingEvent);
            var pct = NumericHelper.ToDecimal(fd, FundingDetailsAttributes.DistributionPercentage) ?? 0m;

            tracing?.Trace(
                $"FundingPercentageHelper: type={fundingType} Fund={fundId} PG/SAG={pgSagId} " +
                $"asOf={asOfDate:yyyy-MM-dd} → event={feRef?.Id} pct={pct}.");

            var resolution = new FundingResolution(feRef, pct);
            if (cacheKey != null) cache[cacheKey] = resolution;
            return resolution;
        }
    }
}
