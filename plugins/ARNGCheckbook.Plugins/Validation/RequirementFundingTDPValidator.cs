using System;
using Microsoft.Xrm.Sdk;
using ARNGCheckbook.Plugins.Constants;
using ARNGCheckbook.Plugins.Helpers;

namespace ARNGCheckbook.Plugins.Validation
{
    /// <summary>
    /// Plugin that validates TDP allocation rules on RequirementFunding records.
    ///
    /// Validation Rules:
    /// 1. TDP amount cannot be negative
    /// 2. Funded Amount cannot be negative
    /// 3. Funded Amount cannot exceed TDP on the same record
    /// 4. TDP cannot exceed remaining available TDP on the associated Line of Accounting
    ///
    /// Registration:
    /// - Message: Create, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_tdp, book_lineofaccounting, book_fundedamount
    ///
    /// - Message: Update, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_tdp, book_lineofaccounting, book_fundedamount
    ///   Pre-Image: book_tdp, book_lineofaccounting, book_fundedamount
    /// </summary>
    public class RequirementFundingTDPValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            // Verify we're on the correct entity
            if (context.PrimaryEntityName != EntityNames.RequirementFunding)
            {
                tracingService.Trace($"Skipping - not a {EntityNames.RequirementFunding} record");
                return;
            }

            // Only handle Create and Update messages
            if (context.MessageName != "Create" && context.MessageName != "Update")
            {
                tracingService.Trace($"Skipping - message {context.MessageName} not handled");
                return;
            }

            var target = GetTarget(context);
            var isUpdate = context.MessageName == "Update";

            // For updates, get the pre-image to merge with target
            Entity preImage = null;
            if (isUpdate)
            {
                preImage = TryGetPreImage(context);
                if (preImage == null)
                {
                    tracingService.Trace("Warning: Pre-image not available for Update");
                }
            }

            // Get effective values (from target if changed, otherwise from pre-image)
            var tdp = GetEffectiveDecimal(target, preImage, RequirementFundingAttributes.TDP);
            var fundedAmount = GetEffectiveDecimal(target, preImage, RequirementFundingAttributes.FundedAmount);
            var loaRef = GetEffectiveEntityReference(target, preImage, RequirementFundingAttributes.LineOfAccounting);

            tracingService.Trace($"Effective values - TDP: {tdp}, FundedAmount: {fundedAmount}, LOA: {loaRef?.Id}");

            // Validation 1: TDP cannot be negative
            if (tdp < 0)
            {
                tracingService.Trace($"Validation failed: Negative TDP ({tdp})");
                throw new InvalidPluginExecutionException(ValidationMessages.NegativeTDP(tdp));
            }

            // Validation 2: Funded Amount cannot be negative
            if (fundedAmount < 0)
            {
                tracingService.Trace($"Validation failed: Negative Funded Amount ({fundedAmount})");
                throw new InvalidPluginExecutionException(ValidationMessages.NegativeFundedAmount(fundedAmount));
            }

            // Validation 3: Funded Amount <= TDP
            if (fundedAmount > 0 || tdp > 0)
            {
                var fundedVsTdpResult = TDPCalculationHelper.ValidateFundedAmountVsTDP(fundedAmount, tdp);
                if (!fundedVsTdpResult.IsValid)
                {
                    tracingService.Trace($"Validation failed: {fundedVsTdpResult.ErrorMessage}");
                    throw new InvalidPluginExecutionException(fundedVsTdpResult.ErrorMessage);
                }
            }

            // Validation 4: TDP <= LOA Available
            // Only validate if TDP > 0
            if (tdp > 0)
            {
                // TDP requires LOA
                if (loaRef == null)
                {
                    tracingService.Trace("Validation failed: TDP set without LOA");
                    throw new InvalidPluginExecutionException(ValidationMessages.TDPRequiresLOA);
                }

                // Check if TDP or LOA changed (for updates, only validate if relevant fields changed)
                bool shouldValidateLOA = !isUpdate ||
                    HasAnyAttributeChanged(target,
                        RequirementFundingAttributes.TDP,
                        RequirementFundingAttributes.LineOfAccounting);

                if (shouldValidateLOA)
                {
                    // For updates, pass the current record ID to exclude from allocation sum
                    Guid? excludeRecordId = isUpdate ? context.PrimaryEntityId : (Guid?)null;

                    var tdpAllocationResult = TDPCalculationHelper.ValidateTDPAllocation(
                        service,
                        loaRef.Id,
                        tdp,
                        excludeRecordId);

                    if (!tdpAllocationResult.IsValid)
                    {
                        tracingService.Trace($"Validation failed: {tdpAllocationResult.ErrorMessage}");
                        throw new InvalidPluginExecutionException(tdpAllocationResult.ErrorMessage);
                    }
                }
            }

            tracingService.Trace("All validations passed");
        }
    }
}
