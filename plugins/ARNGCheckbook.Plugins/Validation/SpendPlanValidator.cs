using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using ARNGCheckbook.Plugins.Constants;

namespace ARNGCheckbook.Plugins.Validation
{
    /// <summary>
    /// Plugin that validates Spend Plan records.
    ///
    /// Validation Rules:
    /// 1. No monthly amount can be negative
    /// 2. Sum of monthly amounts must equal the total (with precision tolerance)
    /// 3. Sum of monthly amounts cannot exceed available budget
    ///
    /// Registration:
    /// - Message: Create, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_total, book_january through book_december
    ///
    /// - Message: Update, Stage: Pre-Operation (20)
    ///   Filtering Attributes: book_total, book_january through book_december
    ///   Pre-Image: All monthly fields and book_total
    /// </summary>
    public class SpendPlanValidator : PluginBase
    {
        // Tolerance for currency comparison (handles floating point precision)
        private const decimal Tolerance = 0.01m;

        // Month field names in order
        private static readonly (string FieldName, string DisplayName)[] MonthFields = new[]
        {
            (SpendPlanAttributes.October, "October"),
            (SpendPlanAttributes.November, "November"),
            (SpendPlanAttributes.December, "December"),
            (SpendPlanAttributes.January, "January"),
            (SpendPlanAttributes.February, "February"),
            (SpendPlanAttributes.March, "March"),
            (SpendPlanAttributes.April, "April"),
            (SpendPlanAttributes.May, "May"),
            (SpendPlanAttributes.June, "June"),
            (SpendPlanAttributes.July, "July"),
            (SpendPlanAttributes.August, "August"),
            (SpendPlanAttributes.September, "September")
        };

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            // Verify we're on the correct entity
            if (context.PrimaryEntityName != EntityNames.SpendPlan)
            {
                tracingService.Trace($"Skipping - not a {EntityNames.SpendPlan} record");
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

            // Check if any relevant fields changed (for updates)
            if (isUpdate && !HasRelevantFieldsChanged(target))
            {
                tracingService.Trace("No relevant fields changed, skipping validation");
                return;
            }

            // Get budget total
            var budgetTotal = GetEffectiveMoney(target, preImage, SpendPlanAttributes.Total);
            tracingService.Trace($"Budget total: {budgetTotal}");

            // Validate each month and calculate sum
            decimal monthlySum = 0m;
            var monthlyValues = new Dictionary<string, decimal>();

            foreach (var (fieldName, displayName) in MonthFields)
            {
                var monthValue = GetEffectiveMoney(target, preImage, fieldName);
                monthlyValues[displayName] = monthValue;

                // Validation 1: No negative monthly amounts
                if (monthValue < 0)
                {
                    tracingService.Trace($"Validation failed: Negative amount in {displayName} ({monthValue})");
                    throw new InvalidPluginExecutionException(
                        ValidationMessages.NegativeMonthlyAmount(displayName, monthValue));
                }

                monthlySum += monthValue;
            }

            tracingService.Trace($"Monthly sum: {monthlySum}");

            // Validation 2: Sum must match total (with tolerance)
            // Only validate if a total is set
            if (budgetTotal > 0)
            {
                var difference = Math.Abs(monthlySum - budgetTotal);
                if (difference > Tolerance)
                {
                    tracingService.Trace($"Validation failed: Sum mismatch - Monthly: {monthlySum}, Total: {budgetTotal}, Diff: {difference}");
                    throw new InvalidPluginExecutionException(
                        ValidationMessages.SpendPlanTotalMismatch(monthlySum, budgetTotal));
                }
            }

            // Validation 3: Monthly sum cannot exceed available amount (if set)
            var availableAmount = GetEffectiveMoney(target, preImage, SpendPlanAttributes.AvailableAmount);
            if (availableAmount > 0 && monthlySum > availableAmount)
            {
                tracingService.Trace($"Validation failed: Sum {monthlySum} exceeds available {availableAmount}");
                throw new InvalidPluginExecutionException(
                    ValidationMessages.SpendPlanExceedsBudget(monthlySum, availableAmount));
            }

            // Auto-calculate and set SpendPlanTotal if not set
            // This helps keep the calculated total in sync
            if (!target.Contains(SpendPlanAttributes.SpendPlanTotal))
            {
                target[SpendPlanAttributes.SpendPlanTotal] = new Money(monthlySum);
                tracingService.Trace($"Auto-set SpendPlanTotal to {monthlySum}");
            }

            tracingService.Trace("Spend Plan validation passed");
        }

        /// <summary>
        /// Checks if any of the monthly fields or total field changed.
        /// </summary>
        private bool HasRelevantFieldsChanged(Entity target)
        {
            // Check total field
            if (target.Contains(SpendPlanAttributes.Total) ||
                target.Contains(SpendPlanAttributes.AvailableAmount))
            {
                return true;
            }

            // Check all monthly fields
            foreach (var (fieldName, _) in MonthFields)
            {
                if (target.Contains(fieldName))
                    return true;
            }

            return false;
        }
    }
}
