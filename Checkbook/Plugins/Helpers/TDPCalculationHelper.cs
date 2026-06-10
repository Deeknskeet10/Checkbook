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
                FundingLineAttributes.TDP // renamed, decimal
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

            return new LOAInfo
            {
                Id = loaId,
                Name = loaEntity.GetAttributeValue<string>(FundingLineAttributes.Name) ?? loaId.ToString(),
                TotalTDP = totalTdp
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

                results.Add(new LOAInfo
                {
                    Id = entity.Id,
                    Name = entity.GetAttributeValue<string>(FundingLineAttributes.Name) ?? entity.Id.ToString(),
                    TotalTDP = totalTdp
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
        /// Recalculates and updates TDP and TDP Remaining on an LOA.
        /// TDP = Sum of Funding Track ResourceAmount
        /// TDP Remaining = TDP - Sum of Requirement Funding NewTDPs
        /// </summary>
        public static void RecalculateLOATDP(
            IOrganizationService service,
            Guid loaId,
            ITracingService tracingService)
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
        public static void BatchRecalculateLOATDP(
            IOrganizationService service,
            IEnumerable<Guid> loaIds,
            ITracingService tracingService)
            {
                var cache = new LOACache();
                var idsToProcess = new HashSet<Guid>(loaIds);

                tracingService.Trace($"Batch recalculating TDP for {idsToProcess.Count} LOAs");

                cache.PreloadLOAInfo(service, idsToProcess);

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

                        var updateEntity = new Entity(EntityNames.FundingLine, loaId);
                        updateEntity[FundingLineAttributes.TDP] = totalTDP;
                        updateEntity[FundingLineAttributes.TDPRemaining] = tdpRemaining;

                        service.Update(updateEntity);
                        tracingService.Trace($"LOA {loaId}: TDP={totalTDP}, Remaining={tdpRemaining}");
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
                // Returns the net ledger impact for an LOA: sum(Credited) - sum(Debited).
        public static decimal GetLedgerNetAmount(IOrganizationService service, Guid loaId)
        {
            // Sum of credits (ledgerdirection = Credited)
            var creditsFetch = $@"
                <fetch aggregate='true'>
                <entity name='{EntityNames.Ledger}'>
                    <attribute name='{LedgerAttributes.Amount}' alias='credits' aggregate='sum' />
                    <filter type='and'>
                    <condition attribute='{LedgerAttributes.LineOfAccounting}' operator='eq' value='{loaId}' />
                    <condition attribute='{LedgerAttributes.LedgerDirection}' operator='eq' value='{LedgerDirectionValues.Credited}' />
                    <condition attribute='{LedgerAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}' />
                    </filter>
                </entity>
                </fetch>";

            var creditsResult = service.RetrieveMultiple(new FetchExpression(creditsFetch));
            var creditAliased = creditsResult.Entities.Count > 0
                ? creditsResult.Entities[0].GetAttributeValue<AliasedValue>("credits")
                : null;
            var credits = 0m;
            if (creditAliased?.Value is decimal cDec) credits = cDec;
            else if (creditAliased?.Value is double cDbl) credits = Convert.ToDecimal(cDbl);

            // Sum of debits (ledgerdirection = Debited)
            var debitsFetch = $@"
                <fetch aggregate='true'>
                <entity name='{EntityNames.Ledger}'>
                    <attribute name='{LedgerAttributes.Amount}' alias='debits' aggregate='sum' />
                    <filter type='and'>
                    <condition attribute='{LedgerAttributes.LineOfAccounting}' operator='eq' value='{loaId}' />
                    <condition attribute='{LedgerAttributes.LedgerDirection}' operator='eq' value='{LedgerDirectionValues.Debited}' />
                    <condition attribute='{LedgerAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}' />
                    </filter>
                </entity>
                </fetch>";

            var debitsResult = service.RetrieveMultiple(new FetchExpression(debitsFetch));
            var debitAliased = debitsResult.Entities.Count > 0
                ? debitsResult.Entities[0].GetAttributeValue<AliasedValue>("debits")
                : null;
            var debits = 0m;
            if (debitAliased?.Value is decimal dDec) debits = dDec;
            else if (debitAliased?.Value is double dDbl) debits = Convert.ToDecimal(dDbl);

            return credits - debits;
        }
    }
}