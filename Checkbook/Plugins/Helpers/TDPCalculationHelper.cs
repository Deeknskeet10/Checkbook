using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Base;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Result of a TDP validation check.
    /// </summary>
    public class ValidationResult
    {
        public bool IsValid { get; }
        public string ErrorMessage { get; }

        private ValidationResult(bool isValid, string errorMessage = null)
        {
            IsValid = isValid;
            ErrorMessage = errorMessage;
        }

        public static ValidationResult Success() => new ValidationResult(true);
        public static ValidationResult Failure(string message) => new ValidationResult(false, message);
    }

    /// <summary>
    /// LOA information retrieved from Dataverse.
    /// </summary>
    public class LOAInfo
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public decimal TotalTDP { get; set; }

        /// <summary>
        /// The LOA's last-committed <c>book_newtdpremaining</c> (TDP − allocated)
        /// as stored before the current action. The non-negative guard compares a
        /// freshly-computed remaining against this to block only actions that
        /// drive remaining below zero *and* below where it already sat — legacy
        /// negatives can still be corrected upward.
        /// </summary>
        public decimal TDPRemaining { get; set; }
    }

    /// <summary>
    /// Cache for LOA information within a single plugin execution context.
    /// Use a new instance per plugin execution to avoid stale data.
    /// </summary>
    public class LOACache
    {
        private readonly Dictionary<Guid, LOAInfo> _loaInfoCache = new Dictionary<Guid, LOAInfo>();
        private readonly Dictionary<Guid, decimal> _allocatedTDPCache = new Dictionary<Guid, decimal>();
        private readonly Dictionary<Guid, decimal> _fundingTrackTotalCache = new Dictionary<Guid, decimal>();

        /// <summary>
        /// Gets cached LOA info or retrieves and caches it.
        /// </summary>
        public LOAInfo GetLOAInfo(IOrganizationService service, Guid loaId)
        {
            if (_loaInfoCache.TryGetValue(loaId, out var cachedInfo))
                return cachedInfo;

            var info = TDPCalculationHelper.GetLOAInfo(service, loaId);
            if (info != null)
                _loaInfoCache[loaId] = info;

            return info;
        }

        /// <summary>
        /// Gets cached allocated TDP or retrieves and caches it.
        /// </summary>
        public decimal GetAllocatedTDP(IOrganizationService service, Guid loaId, Guid? excludeRecordId = null)
        {
            // For excludeRecordId scenarios, don't use cache as it varies per call
            if (excludeRecordId.HasValue)
                return TDPCalculationHelper.GetAllocatedTDP(service, loaId, excludeRecordId);

            if (_allocatedTDPCache.TryGetValue(loaId, out var cachedValue))
                return cachedValue;

            var allocated = TDPCalculationHelper.GetAllocatedTDP(service, loaId);
            _allocatedTDPCache[loaId] = allocated;
            return allocated;
        }

        /// <summary>
        /// Gets cached funding track total or retrieves and caches it.
        /// </summary>
        public decimal GetFundingTrackTotal(IOrganizationService service, Guid loaId)
        {
            if (_fundingTrackTotalCache.TryGetValue(loaId, out var cachedValue))
                return cachedValue;

            var total = TDPCalculationHelper.GetFundingTrackTotal(service, loaId);
            _fundingTrackTotalCache[loaId] = total;
            return total;
        }

        /// <summary>
        /// Invalidates cache for a specific LOA.
        /// Call this after updating an LOA's values.
        /// </summary>
        public void InvalidateLOA(Guid loaId)
        {
            _loaInfoCache.Remove(loaId);
            _allocatedTDPCache.Remove(loaId);
            _fundingTrackTotalCache.Remove(loaId);
        }

        /// <summary>
        /// Clears all cached data.
        /// </summary>
        public void Clear()
        {
            _loaInfoCache.Clear();
            _allocatedTDPCache.Clear();
            _fundingTrackTotalCache.Clear();
        }

        /// <summary>
        /// Pre-loads LOA info for multiple LOAs in a single query.
        /// Use this for bulk operations to reduce API calls.
        /// </summary>
        public void PreloadLOAInfo(IOrganizationService service, IEnumerable<Guid> loaIds)
        {
            var idsToLoad = new List<Guid>();
            foreach (var id in loaIds)
            {
                if (!_loaInfoCache.ContainsKey(id))
                    idsToLoad.Add(id);
            }

            if (idsToLoad.Count == 0)
                return;

            var loaInfos = TDPCalculationHelper.GetBatchLOAInfo(service, idsToLoad);
            foreach (var info in loaInfos)
            {
                _loaInfoCache[info.Id] = info;
            }
        }
    }

    /// <summary>
    /// Helper methods for TDP allocation calculations.
    /// </summary>
    public static class TDPCalculationHelper
    {
        /// <summary>
        /// Gets the LOA record information including total TDP (decimal).
        /// </summary>
        public static LOAInfo GetLOAInfo(IOrganizationService service, Guid loaId)
        {
            var columns = new ColumnSet(
                FundingLineAttributes.Name,
                FundingLineAttributes.TDP,          // renamed, decimal
                FundingLineAttributes.TDPRemaining  // stored remaining (delta-guard baseline)
            );

            var loaEntity = service.Retrieve(EntityNames.FundingLine, loaId, columns);
            if (loaEntity == null)
                return null;

            // Prefer strong decimal getter; fall back to raw conversion for resilience.
            decimal totalTdp = 0m;
            if (loaEntity.Attributes.Contains(FundingLineAttributes.TDP))
            {
                var raw = loaEntity[FundingLineAttributes.TDP];
                totalTdp = NumericHelper.ToDecimal(raw, 0m);
            }

            decimal remaining = 0m;
            if (loaEntity.Attributes.Contains(FundingLineAttributes.TDPRemaining))
                remaining = NumericHelper.ToDecimal(loaEntity[FundingLineAttributes.TDPRemaining], 0m);

            return new LOAInfo
            {
                Id = loaId,
                Name = loaEntity.GetAttributeValue<string>(FundingLineAttributes.Name) ?? loaId.ToString(),
                TotalTDP = totalTdp,
                TDPRemaining = remaining
            };
        }

        /// <summary>
        /// Gets LOA information for multiple LOAs in a single query.
        /// </summary>
        public static List<LOAInfo> GetBatchLOAInfo(IOrganizationService service, IEnumerable<Guid> loaIds)
        {
            var results = new List<LOAInfo>();
            var idList = new List<Guid>(loaIds);
            if (idList.Count == 0)
                return results;

            // Build condition for multiple IDs
            var conditions = new List<string>();
            foreach (var id in idList)
            {
                conditions.Add($"<value>{id}</value>");
            }

            var fetchXml = $@"
                <fetch>
                <entity name='{EntityNames.FundingLine}'>
                    <attribute name='{FundingLineAttributes.Id}' />
                    <attribute name='{FundingLineAttributes.Name}' />
                    <attribute name='{FundingLineAttributes.TDP}' />
                    <attribute name='{FundingLineAttributes.TDPRemaining}' />
                    <filter type='and'>
                    <condition attribute='{FundingLineAttributes.Id}' operator='in'>
                        {string.Join("\n", conditions)}
                    </condition>
                    </filter>
                </entity>
                </fetch>";

            var queryResult = service.RetrieveMultiple(new FetchExpression(fetchXml));
            foreach (var entity in queryResult.Entities)
            {
                decimal totalTdp = 0m;
                if (entity.Attributes.Contains(FundingLineAttributes.TDP))
                {
                    var raw = entity[FundingLineAttributes.TDP];
                    totalTdp = NumericHelper.ToDecimal(raw, 0m);
                }

                decimal remaining = 0m;
                if (entity.Attributes.Contains(FundingLineAttributes.TDPRemaining))
                    remaining = NumericHelper.ToDecimal(entity[FundingLineAttributes.TDPRemaining], 0m);

                results.Add(new LOAInfo
                {
                    Id = entity.Id,
                    Name = entity.GetAttributeValue<string>(FundingLineAttributes.Name) ?? entity.Id.ToString(),
                    TotalTDP = totalTdp,
                    TDPRemaining = remaining
                });
            }

            return results;
        }

        /// <summary>
        /// Gets the sum of TDP already allocated to other RequirementFunding records on the same LOA.
        /// </summary>
        public static decimal GetAllocatedTDP(IOrganizationService service, Guid loaId, Guid? excludeRecordId = null)
        {
            // Sum of decimal TDP on RequirementFunding
            var fetchXml = $@"
                <fetch aggregate='true'>
                <entity name='{EntityNames.RequirementFunding}'>
                    <attribute name='{RequirementFundingAttributes.TDP}' alias='totalTDP' aggregate='sum' />
                    <filter type='and'>
                    <condition attribute='{RequirementFundingAttributes.LineOfAccounting}' operator='eq' value='{loaId}' />
                    <condition attribute='{RequirementFundingAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}' />
                    {(excludeRecordId.HasValue ? $"<condition attribute='{RequirementFundingAttributes.Id}' operator='ne' value='{excludeRecordId.Value}' />" : "")}
                    </filter>
                </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetchXml));
            if (result.Entities.Count > 0)
            {
                var aliasedValue = result.Entities[0].GetAttributeValue<AliasedValue>("totalTDP");
                if (aliasedValue?.Value is decimal decValue)
                    return decValue;
                if (aliasedValue?.Value is double doubleVal)
                    return Convert.ToDecimal(doubleVal);
            }
            return 0m;
        }

        /// <summary>
        /// Validates that the TDP amount does not exceed the available LOA funds.
        /// </summary>
        public static ValidationResult ValidateTDPAllocation(
            IOrganizationService service,
            Guid loaId,
            decimal requestedTDP,
            Guid? currentRecordId = null)
        {
            // Get LOA information
            var loaInfo = GetLOAInfo(service, loaId);
            if (loaInfo == null)
            {
                return ValidationResult.Failure(
                    Validation.ValidationMessages.LOANotFound(loaId.ToString()));
            }

            // Get already allocated amount (excluding current record for updates)
            var alreadyAllocated = GetAllocatedTDP(service, loaId, currentRecordId);

            // Calculate available amount
            var available = loaInfo.TotalTDP - alreadyAllocated;

            // Validate
            if (requestedTDP > available)
            {
                return ValidationResult.Failure(
                    Validation.ValidationMessages.TDPExceedsAvailable(
                        loaInfo.Name,
                        requestedTDP,
                        available,
                        loaInfo.TotalTDP,
                        alreadyAllocated));
            }

            return ValidationResult.Success();
        }

        /// <summary>
        /// Validates that the Funded Amount does not exceed TDP.
        /// </summary>
        public static ValidationResult ValidateFundedAmountVsTDP(decimal fundedAmount, decimal tdp)
        {
            if (fundedAmount > tdp)
            {
                return ValidationResult.Failure(
                    Validation.ValidationMessages.FundedExceedsTDP(fundedAmount, tdp));
            }
            return ValidationResult.Success();
        }

        /// <summary>
        /// Gets the sum of Resource Amounts from all Funding Tracks for an LOA.
        /// </summary>
        public static decimal GetFundingTrackTotal(IOrganizationService service, Guid loaId)
        {
            // Sum of decimal ResourceAmount on FundingTrack
            var fetchXml = $@"
                <fetch aggregate='true'>
                <entity name='{EntityNames.FundingTrack}'>
                    <attribute name='{FundingTrackAttributes.ResourceAmount}' alias='totalAmount' aggregate='sum' />
                    <filter type='and'>
                    <condition attribute='{FundingTrackAttributes.LineOfAccounting}' operator='eq' value='{loaId}' />
                    <condition attribute='{FundingTrackAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}' />
                    </filter>
                </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetchXml));
            if (result.Entities.Count > 0)
            {
                var aliasedValue = result.Entities[0].GetAttributeValue<AliasedValue>("totalAmount");
                if (aliasedValue?.Value is decimal decValue)
                    return decValue;
                if (aliasedValue?.Value is double doubleVal)
                    return Convert.ToDecimal(doubleVal);
            }
            return 0m;
        }

        /// <summary>
        /// Rounding tolerance for the non-negative TDP Remaining guard. Aggregate
        /// FetchXml sums can leave sub-cent artifacts; without a tolerance a
        /// −0.0001 rounding wisp would spuriously block a legitimate action.
        /// </summary>
        private const decimal RemainingEpsilon = 0.005m;

        /// <summary>
        /// Enforces the invariant that an action may not drive an LOA's TDP
        /// Remaining negative. This is a <em>delta</em> guard: it blocks only when
        /// the newly-computed remaining is below zero <b>and</b> below the LOA's
        /// last-committed remaining — so a corrective edit that improves an
        /// already-negative LOA (e.g. −100 → −50) is still allowed, but any edit
        /// that worsens a deficit or newly creates one is rejected and rolls back
        /// the whole transaction.
        ///
        /// Callers running legitimate multi-step transients (a Realignment /
        /// State-Swap recalc issued after the ledger write but before the paired
        /// RF move) must pass <paramref name="enforce"/> = false for that
        /// intermediate call and enforce only on the final settling recalc. The
        /// bulk reconcile API passes false throughout — it reports reality rather
        /// than blocking on legacy negatives.
        /// </summary>
        private static void GuardNonNegativeRemaining(
            bool enforce,
            LOAInfo loaInfo,
            decimal newTdp,
            decimal allocated,
            decimal newRemaining,
            ITracingService tracing)
        {
            if (!enforce) return;

            bool wouldBeNegative = newRemaining < -RemainingEpsilon;
            bool worsening = newRemaining < loaInfo.TDPRemaining - RemainingEpsilon;
            if (!wouldBeNegative || !worsening)
                return;

            tracing.Trace(
                $"BLOCK: LOA '{loaInfo.Name}' TDP Remaining would fall to {newRemaining} " +
                $"(was {loaInfo.TDPRemaining}); TDP={newTdp}, allocated={allocated}.");

            throw new InvalidPluginExecutionException(
                Validation.ValidationMessages.TDPRemainingWouldGoNegative(
                    loaInfo.Name, newTdp, allocated, newRemaining));
        }

        /// <summary>
        /// Recalculates and updates TDP and TDP Remaining on an LOA.
        /// TDP = Sum of Funding Track ResourceAmount + Ledger net.
        /// TDP Remaining = TDP - Sum of Requirement Funding TDPs.
        /// </summary>
        /// <param name="enforceNonNegative">
        /// When true (default), blocks the action if it would drive TDP Remaining
        /// negative and worse than its current value (see
        /// <see cref="GuardNonNegativeRemaining"/>). Pass false for the
        /// intermediate recalc of a multi-step orchestration and for bulk
        /// reconcile passes.
        /// </param>
        public static void RecalculateLOATDP(
            IOrganizationService service,
            Guid loaId,
            ITracingService tracingService,
            bool enforceNonNegative = true)
        {
            tracingService.Trace($"Recalculating TDP for LOA: {loaId}");

            // Calculate TDP from Funding Tracks (decimal)
            var totalTDPFromTracks = GetFundingTrackTotal(service, loaId);
            tracingService.Trace($"Total TDP from Funding Tracks: {totalTDPFromTracks}");

            // Include Ledger net (credits - debits) to get true LOA TDP
            var ledgerNet = GetLedgerNetAmount(service, loaId);
            tracingService.Trace($"Ledger net for LOA: {ledgerNet}");

            var totalTDP = totalTDPFromTracks + ledgerNet;
            tracingService.Trace($"Computed LOA TDP (Tracks + Ledger): {totalTDP}");

            // Calculate allocated TDP from Requirement Fundings
            var allocatedTDP = GetAllocatedTDP(service, loaId);
            tracingService.Trace($"Allocated TDP from Requirement Fundings: {allocatedTDP}");

            // Calculate remaining (can be negative if TDP reduced below allocations)
            var tdpRemaining = totalTDP - allocatedTDP;
            tracingService.Trace($"TDP Remaining: {tdpRemaining}");

            // Reject any action that would push (or push further) into deficit.
            // Only read the pre-action remaining (the delta baseline) when we will
            // actually enforce — intermediate orchestrator recalcs skip this.
            if (enforceNonNegative)
            {
                var loaInfo = GetLOAInfo(service, loaId)
                              ?? new LOAInfo { Id = loaId, Name = loaId.ToString() };
                GuardNonNegativeRemaining(true, loaInfo, totalTDP, allocatedTDP, tdpRemaining, tracingService);
            }

            // Update the LOA record (decimal writes)
            var updateEntity = new Entity(EntityNames.FundingLine, loaId);
            updateEntity[FundingLineAttributes.TDP] = totalTDP;
            updateEntity[FundingLineAttributes.TDPRemaining] = tdpRemaining;

            service.Update(updateEntity);
            tracingService.Trace("LOA TDP values updated successfully");
        }

        /// <summary>
        /// Batch recalculates TDP and TDP Remaining for multiple LOAs.
        /// </summary>
        /// <param name="enforceNonNegative">
        /// When true (default), a computed TDP Remaining that would drop below
        /// zero and below the LOA's current value aborts the whole pass (the
        /// guard's <see cref="InvalidPluginExecutionException"/> is re-thrown, not
        /// swallowed). Real-time propagators leave this true; the bulk reconcile
        /// API passes false so it reports the true value on legacy-negative LOAs
        /// instead of blocking.
        /// </param>
        public static void BatchRecalculateLOATDP(
            IOrganizationService service,
            IEnumerable<Guid> loaIds,
            ITracingService tracingService,
            bool enforceNonNegative = true)
            {
                var cache = new LOACache();
                var idsToProcess = new HashSet<Guid>(loaIds);

                tracingService.Trace($"Batch recalculating TDP for {idsToProcess.Count} LOAs");

                foreach (var loaId in idsToProcess)
                {
                    tracingService.Trace($"Processing LOA: {loaId}");

                    try
                    {
                        var totalFromTracks = cache.GetFundingTrackTotal(service, loaId);
                        var ledgerNet = GetLedgerNetAmount(service, loaId);
                        var totalTDP = totalFromTracks + ledgerNet;

                        var allocatedTDP = TDPCalculationHelper.GetAllocatedTDP(service, loaId);
                        var tdpRemaining = totalTDP - allocatedTDP;

                        if (enforceNonNegative)
                        {
                            var loaInfo = cache.GetLOAInfo(service, loaId)
                                          ?? new LOAInfo { Id = loaId, Name = loaId.ToString() };
                            GuardNonNegativeRemaining(true, loaInfo, totalTDP, allocatedTDP, tdpRemaining, tracingService);
                        }

                        var updateEntity = new Entity(EntityNames.FundingLine, loaId);
                        updateEntity[FundingLineAttributes.TDP] = totalTDP;
                        updateEntity[FundingLineAttributes.TDPRemaining] = tdpRemaining;

                        service.Update(updateEntity);
                        tracingService.Trace($"LOA {loaId}: TDP={totalTDP}, Remaining={tdpRemaining}");
                    }
                    catch (InvalidPluginExecutionException)
                    {
                        // The non-negative guard fired. This is a deliberate
                        // rejection of the originating action — let it propagate so
                        // the platform rolls the transaction back. Do NOT swallow.
                        throw;
                    }
                    catch (Exception ex)
                    {
                        // One missing/locked LOA must not abort the whole recalc pass.
                        // Common cause: an upstream Create earlier in this transaction
                        // was rolled back, leaving an orphan id in the touched set.
                        var reason = (ex.InnerException?.Message ?? ex.Message ?? ex.GetType().Name).Trim();
                        tracingService.Trace($"LOA {loaId}: recalc FAILED — {reason}");
                    }
                }

                tracingService.Trace("Batch recalculation complete");
            }
        /// <summary>
        /// Returns the net ledger impact for an LOA: sum(Credited) - sum(Debited).
        /// Single FetchXml aggregate grouped by direction — one row per direction.
        /// </summary>
        public static decimal GetLedgerNetAmount(IOrganizationService service, Guid loaId)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                <entity name='{EntityNames.Ledger}'>
                    <attribute name='{LedgerAttributes.Amount}' alias='amount' aggregate='sum' />
                    <attribute name='{LedgerAttributes.LedgerDirection}' alias='direction' groupby='true' />
                    <filter type='and'>
                    <condition attribute='{LedgerAttributes.LineOfAccounting}' operator='eq' value='{loaId}' />
                    <condition attribute='{LedgerAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}' />
                    </filter>
                </entity>
                </fetch>";

            decimal credits = 0m, debits = 0m;
            foreach (var row in service.RetrieveMultiple(new FetchExpression(fetch)).Entities)
            {
                var amountAliased = row.GetAttributeValue<AliasedValue>("amount");
                var directionAliased = row.GetAttributeValue<AliasedValue>("direction");
                if (amountAliased == null || directionAliased == null) continue;

                decimal amount = NumericHelper.ToDecimal(amountAliased.Value, 0m);
                var direction = (directionAliased.Value as OptionSetValue)?.Value;

                if (direction == LedgerDirectionValues.Credited) credits = amount;
                else if (direction == LedgerDirectionValues.Debited) debits = amount;
            }
            return credits - debits;
        }
    }
}