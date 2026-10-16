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

            // Retrieve throws when the row doesn't exist — never null.
            var loaEntity = service.Retrieve(EntityNames.FundingLine, loaId, columns);

            return new LOAInfo
            {
                Id = loaId,
                Name = loaEntity.GetAttributeValue<string>(FundingLineAttributes.Name) ?? loaId.ToString(),
                TotalTDP = NumericHelper.ToDecimal(loaEntity, FundingLineAttributes.TDP) ?? 0m,
                TDPRemaining = NumericHelper.ToDecimal(loaEntity, FundingLineAttributes.TDPRemaining) ?? 0m,
            };
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
                return AliasedValueHelper.GetDecimal(result.Entities[0], "totalTDP");
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
                return AliasedValueHelper.GetDecimal(result.Entities[0], "totalAmount");
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
            RecalculateOne(service, loaId, tracingService, enforceNonNegative);
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
            var idsToProcess = new HashSet<Guid>(loaIds);
            tracingService.Trace($"Batch recalculating TDP for {idsToProcess.Count} LOAs");

            foreach (var loaId in idsToProcess)
            {
                try
                {
                    RecalculateOne(service, loaId, tracingService, enforceNonNegative);
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
                    // One missing/locked LOA must not abort the whole recalc pass
                    // (the book_GenerateLOAs batch relies on this). Common cause: an
                    // upstream Create earlier in the batch failed, leaving an orphan
                    // id in the touched set.
                    var reason = (ex.InnerException?.Message ?? ex.Message ?? ex.GetType().Name).Trim();
                    tracingService.Trace($"LOA {loaId}: recalc FAILED — {reason}");
                }
            }

            tracingService.Trace("Batch recalculation complete");
        }

        /// <summary>
        /// TDP = Σ active Funding Track ResourceAmount + ledger net;
        /// Remaining = TDP − Σ active RF TDP. Guards, then writes both.
        /// </summary>
        private static void RecalculateOne(
            IOrganizationService service,
            Guid loaId,
            ITracingService tracingService,
            bool enforceNonNegative)
        {
            var totalFromTracks = GetFundingTrackTotal(service, loaId);
            var ledgerNet = GetLedgerNetAmount(service, loaId);
            var totalTDP = totalFromTracks + ledgerNet;

            var allocatedTDP = GetAllocatedTDP(service, loaId);
            // Can be negative if TDP was reduced below allocations.
            var tdpRemaining = totalTDP - allocatedTDP;

            // Reject any action that would push (or push further) into deficit.
            // Only read the pre-action remaining (the delta baseline) when we will
            // actually enforce — intermediate orchestrator recalcs skip this.
            if (enforceNonNegative)
                GuardNonNegativeRemaining(true, GetLOAInfo(service, loaId),
                    totalTDP, allocatedTDP, tdpRemaining, tracingService);

            var updateEntity = new Entity(EntityNames.FundingLine, loaId);
            updateEntity[FundingLineAttributes.TDP] = totalTDP;
            updateEntity[FundingLineAttributes.TDPRemaining] = tdpRemaining;
            service.Update(updateEntity);

            tracingService.Trace(
                $"LOA {loaId}: TDP={totalTDP} (tracks {totalFromTracks} + ledger {ledgerNet}), " +
                $"allocated={allocatedTDP}, Remaining={tdpRemaining}");
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
                if (!row.Contains("amount") || !row.Contains("direction")) continue;

                decimal amount = AliasedValueHelper.GetDecimal(row, "amount");
                var direction = AliasedValueHelper.GetInt(row, "direction", -1);

                if (direction == LedgerDirectionValues.Credited) credits = amount;
                else if (direction == LedgerDirectionValues.Debited) debits = amount;
            }
            return credits - debits;
        }
    }
}