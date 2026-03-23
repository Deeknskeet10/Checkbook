using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using ARNGCheckbook.Plugins.Constants;

namespace ARNGCheckbook.Plugins.Validation
{
    /// <summary>
    /// Plugin that validates Prioritization records.
    ///
    /// Validation Rules:
    /// 1. Priority must be a positive integer
    /// 2. Priority must be unique within the same State + FY + Fund Center
    ///
    /// This replaces multiple XAML workflows:
    /// - Prioritization-LinkRecords
    /// - Prioritization-RequirePriority
    /// - Prioritization-RequestedvsFunded
    ///
    /// Registration:
    /// - Message: Create, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_statepriority, book_state, book_newfiscalyear, book_fundcenter
    ///
    /// - Message: Update, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_statepriority, book_state, book_newfiscalyear, book_fundcenter
    ///   Pre-Image: book_statepriority, book_state, book_newfiscalyear, book_fundcenter
    /// </summary>
    public class PrioritizationValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            // Verify we're on the correct entity
            if (context.PrimaryEntityName != EntityNames.Prioritization)
            {
                tracingService.Trace($"Skipping - not a {EntityNames.Prioritization} record");
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

            // Get effective values
            var priority = GetEffectiveInt(target, preImage, PrioritizationAttributes.StatePriority);
            var stateRef = GetEffectiveEntityReference(target, preImage, PrioritizationAttributes.State);
            var fiscalYear = GetEffectiveString(target, preImage, PrioritizationAttributes.FiscalYear);
            var fundCenterRef = GetEffectiveEntityReference(target, preImage, PrioritizationAttributes.FundCenter);

            tracingService.Trace($"Validating - Priority: {priority}, State: {stateRef?.Id}, FY: {fiscalYear}, FC: {fundCenterRef?.Id}");

            // Validation 1: Priority must be positive (if set)
            if (priority.HasValue)
            {
                if (priority.Value <= 0)
                {
                    tracingService.Trace($"Validation failed: Invalid priority value ({priority.Value})");
                    throw new InvalidPluginExecutionException(
                        ValidationMessages.InvalidPriorityValue(priority.Value));
                }

                // Validation 2: Priority uniqueness within scope
                // Only validate if priority is changing or this is a create
                bool shouldValidateUniqueness = !isUpdate ||
                    HasAnyAttributeChanged(target,
                        PrioritizationAttributes.StatePriority,
                        PrioritizationAttributes.State,
                        PrioritizationAttributes.FiscalYear,
                        PrioritizationAttributes.FundCenter);

                if (shouldValidateUniqueness && stateRef != null && !string.IsNullOrEmpty(fiscalYear) && fundCenterRef != null)
                {
                    Guid? excludeRecordId = isUpdate ? context.PrimaryEntityId : (Guid?)null;

                    bool isDuplicate = CheckDuplicatePriority(
                        service,
                        stateRef.Id,
                        fiscalYear,
                        fundCenterRef.Id,
                        priority.Value,
                        excludeRecordId,
                        tracingService);

                    if (isDuplicate)
                    {
                        // Get Fund Center name for error message
                        var fcName = GetFundCenterName(service, fundCenterRef.Id);

                        tracingService.Trace($"Validation failed: Duplicate priority {priority.Value}");
                        throw new InvalidPluginExecutionException(
                            ValidationMessages.DuplicatePriority(priority.Value, fiscalYear, fcName));
                    }
                }
            }

            tracingService.Trace("Prioritization validation passed");
        }

        /// <summary>
        /// Checks if the given priority already exists for another record
        /// within the same State, FY, and Fund Center scope.
        /// </summary>
        private bool CheckDuplicatePriority(
            IOrganizationService service,
            Guid stateId,
            string fiscalYear,
            Guid fundCenterId,
            int priority,
            Guid? excludeRecordId,
            ITracingService tracingService)
        {
            var fetchXml = $@"
                <fetch top='1'>
                    <entity name='{EntityNames.Prioritization}'>
                        <attribute name='{PrioritizationAttributes.Id}' />
                        <filter type='and'>
                            <condition attribute='{PrioritizationAttributes.State}' operator='eq' value='{stateId}' />
                            <condition attribute='{PrioritizationAttributes.FiscalYear}' operator='eq' value='{fiscalYear}' />
                            <condition attribute='{PrioritizationAttributes.FundCenter}' operator='eq' value='{fundCenterId}' />
                            <condition attribute='{PrioritizationAttributes.StatePriority}' operator='eq' value='{priority}' />
                            <condition attribute='{PrioritizationAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}' />
                            {(excludeRecordId.HasValue ? $"<condition attribute='{PrioritizationAttributes.Id}' operator='ne' value='{excludeRecordId.Value}' />" : "")}
                        </filter>
                    </entity>
                </fetch>";

            tracingService.Trace("Checking for duplicate priorities...");
            var result = service.RetrieveMultiple(new FetchExpression(fetchXml));

            var hasDuplicate = result.Entities.Count > 0;
            tracingService.Trace($"Duplicate found: {hasDuplicate}");

            return hasDuplicate;
        }

        /// <summary>
        /// Gets the Fund Center name for error messages.
        /// </summary>
        private string GetFundCenterName(IOrganizationService service, Guid fundCenterId)
        {
            try
            {
                var entity = service.Retrieve(EntityNames.FundCenter, fundCenterId, new ColumnSet("book_name"));
                return entity.GetAttributeValue<string>("book_name") ?? fundCenterId.ToString();
            }
            catch
            {
                return fundCenterId.ToString();
            }
        }
    }
}
