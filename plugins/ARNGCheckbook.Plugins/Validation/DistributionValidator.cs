using System;
using Microsoft.Xrm.Sdk;
using ARNGCheckbook.Plugins.Constants;

namespace ARNGCheckbook.Plugins.Validation
{
    /// <summary>
    /// Plugin that validates Distribution records.
    ///
    /// Validation Rules:
    /// 1. Funding Event is required (when not a manual entry)
    /// 2. PG/SAG is required
    /// 3. Fund is required
    /// 4. Fund Center is required
    /// 5. Amount must be valid (not zero for non-manual entries)
    ///
    /// Replaces:
    /// - Distributions-RequireFundingEvent workflow
    /// - Distributions-RequirePGSAG workflow
    ///
    /// Registration:
    /// - Message: Create, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_fundingevent, book_newpgsag, book_fund, book_fundcenter, book_amount
    ///
    /// - Message: Update, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_fundingevent, book_newpgsag, book_fund, book_fundcenter, book_amount
    ///   Pre-Image: All filtered attributes plus book_manualentry
    /// </summary>
    public class DistributionValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            // Verify we're on the correct entity
            if (context.PrimaryEntityName != EntityNames.Distributions)
            {
                tracingService.Trace($"Skipping - not a {EntityNames.Distributions} record");
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

            // For updates, get the pre-image
            Entity preImage = null;
            if (isUpdate)
            {
                preImage = TryGetPreImage(context);
            }

            // Check if this is a manual entry (manual entries may have relaxed validation)
            var isManualEntry = false;
            if (target.Contains(DistributionsAttributes.ManualEntry))
            {
                isManualEntry = target.GetAttributeValue<bool>(DistributionsAttributes.ManualEntry);
            }
            else if (preImage != null && preImage.Contains(DistributionsAttributes.ManualEntry))
            {
                isManualEntry = preImage.GetAttributeValue<bool>(DistributionsAttributes.ManualEntry);
            }

            tracingService.Trace($"Is manual entry: {isManualEntry}");

            // Get effective values
            var fundingEventRef = GetEffectiveEntityReference(target, preImage, DistributionsAttributes.FundingEvent);
            var pgsagRef = GetEffectiveEntityReference(target, preImage, DistributionsAttributes.PGSAG);
            var fundRef = GetEffectiveEntityReference(target, preImage, DistributionsAttributes.Fund);
            var fundCenterRef = GetEffectiveEntityReference(target, preImage, DistributionsAttributes.FundCenter);

            // Get amount (it's a float/double in the entity, not Money)
            double? amount = null;
            if (target.Contains(DistributionsAttributes.Amount))
            {
                amount = target.GetAttributeValue<double?>(DistributionsAttributes.Amount);
            }
            else if (preImage != null && preImage.Contains(DistributionsAttributes.Amount))
            {
                amount = preImage.GetAttributeValue<double?>(DistributionsAttributes.Amount);
            }

            tracingService.Trace($"Validating - FundingEvent: {fundingEventRef?.Id}, PGSAG: {pgsagRef?.Id}, Fund: {fundRef?.Id}, FC: {fundCenterRef?.Id}");

            // Validation 1: Fund is required
            if (fundRef == null)
            {
                tracingService.Trace("Validation failed: Fund is required");
                throw new InvalidPluginExecutionException(ValidationMessages.DistributionRequiresFund);
            }

            // Validation 2: Fund Center is required
            if (fundCenterRef == null)
            {
                tracingService.Trace("Validation failed: Fund Center is required");
                throw new InvalidPluginExecutionException(ValidationMessages.DistributionRequiresFundCenter);
            }

            // Validation 3: PG/SAG is required
            if (pgsagRef == null)
            {
                tracingService.Trace("Validation failed: PG/SAG is required");
                throw new InvalidPluginExecutionException(ValidationMessages.DistributionRequiresPGSAG);
            }

            // Validation 4: Funding Event is required (for non-manual entries)
            if (!isManualEntry && fundingEventRef == null)
            {
                tracingService.Trace("Validation failed: Funding Event is required for non-manual entries");
                throw new InvalidPluginExecutionException(ValidationMessages.DistributionRequiresFundingEvent);
            }

            // Validation 5: Amount validation (for non-manual entries)
            if (!isManualEntry && (!amount.HasValue || amount.Value == 0))
            {
                tracingService.Trace("Validation failed: Amount is required for non-manual entries");
                throw new InvalidPluginExecutionException(
                    ValidationMessages.InvalidDistributionAmount((decimal)(amount ?? 0)));
            }

            tracingService.Trace("Distribution validation passed");
        }
    }
}
