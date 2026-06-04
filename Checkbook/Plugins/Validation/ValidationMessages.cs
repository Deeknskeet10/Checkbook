using System;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// User-facing validation error message templates.
    /// </summary>
    public static class ValidationMessages
    {
        #region TDP Validation Messages

        /// <summary>
        /// Error message when TDP allocation exceeds LOA available funds.
        /// </summary>
        public static string TDPExceedsAvailable(
            string loaName,
            decimal requested,
            decimal available,
            decimal loaTotal,
            decimal alreadyAllocated)
        {
            return $"TDP allocation exceeds available funds on LOA '{loaName}'.\n" +
                   $"Requested: {requested:C}\n" +
                   $"Available: {available:C}\n" +
                   $"LOA Total TDP: {loaTotal:C}\n" +
                   $"Already Allocated: {alreadyAllocated:C}";
        }

        /// <summary>
        /// Error message when Funded Amount exceeds TDP.
        /// </summary>
        public static string FundedExceedsTDP(decimal fundedAmount, decimal tdp)
        {
            return $"Funded Amount ({fundedAmount:C}) cannot exceed TDP ({tdp:C}).";
        }

        /// <summary>
        /// Error message when TDP is set without a Line of Accounting.
        /// </summary>
        public const string TDPRequiresLOA =
            "A Line of Accounting must be selected when TDP amount is greater than zero.";

        /// <summary>
        /// Error message when LOA record cannot be found.
        /// </summary>
        public static string LOANotFound(string loaId)
        {
            return $"The specified Line of Accounting ({loaId}) could not be found.";
        }

        /// <summary>
        /// Error message when TDP amount is negative.
        /// </summary>
        public static string NegativeTDP(decimal tdp)
        {
            return $"TDP amount ({tdp:C}) cannot be negative.";
        }

        /// <summary>
        /// Error message when Funded Amount is negative.
        /// </summary>
        public static string NegativeFundedAmount(decimal fundedAmount)
        {
            return $"Funded Amount ({fundedAmount:C}) cannot be negative.";
        }

        /// <summary>
        /// Warning message when LOA utilization is high.
        /// </summary>
        public static string HighLOAUtilization(string loaName, decimal percentage)
        {
            return $"Warning: LOA '{loaName}' is at {percentage:P0} utilization.";
        }

        #endregion

        #region Priority Validation Messages

        /// <summary>
        /// Error message when priority is not unique within scope.
        /// </summary>
        public static string DuplicatePriority(int priority, string fiscalYear, string fundCenter)
        {
            return $"Priority {priority} is already assigned to another record for FY {fiscalYear} in Fund Center '{fundCenter}'.\n" +
                   "Each priority must be unique within a Fiscal Year and Fund Center.";
        }

        /// <summary>
        /// Error message when priority is missing.
        /// </summary>
        public const string PriorityRequired =
            "A State Priority must be assigned before saving.";

        /// <summary>
        /// Error message when priority is out of valid range.
        /// </summary>
        public static string PriorityOutOfRange(int priority, int min, int max)
        {
            return $"Priority {priority} is out of valid range ({min}-{max}).";
        }

        /// <summary>
        /// Error message when priority is zero or negative.
        /// </summary>
        public static string InvalidPriorityValue(int priority)
        {
            return $"Priority must be a positive number. Received: {priority}";
        }

        #endregion

        #region Spend Plan Validation Messages

        /// <summary>
        /// Error message when monthly totals exceed budget.
        /// </summary>
        public static string SpendPlanExceedsBudget(decimal monthlyTotal, decimal budget)
        {
            return $"Monthly spend plan total ({monthlyTotal:C}) exceeds available budget ({budget:C}).";
        }

        /// <summary>
        /// Error message when spend plan has negative monthly amount.
        /// </summary>
        public static string NegativeMonthlyAmount(string month, decimal amount)
        {
            return $"Monthly amount for {month} ({amount:C}) cannot be negative.";
        }

        /// <summary>
        /// Error message when spend plan is missing required reference.
        /// </summary>
        public const string SpendPlanRequiresPrioritization =
            "Spend Plan must be associated with a Prioritization or Unfunded Request.";

        /// <summary>
        /// Error message when spend plan total doesn't match sum of months.
        /// </summary>
        public static string SpendPlanTotalMismatch(decimal calculatedTotal, decimal providedTotal)
        {
            return $"Sum of monthly amounts ({calculatedTotal:C}) does not match the provided total ({providedTotal:C}).";
        }

        #endregion

        #region Distribution Validation Messages

        /// <summary>
        /// Error message when Funding Event is required but missing.
        /// </summary>
        public const string DistributionRequiresFundingEvent =
            "A Funding Event must be selected for this Distribution.";

        /// <summary>
        /// Error message when PG/SAG is required but missing.
        /// </summary>
        public const string DistributionRequiresPGSAG =
            "A PG/SAG must be selected for this Distribution.";

        /// <summary>
        /// Error message when Distribution amount is invalid.
        /// </summary>
        public static string InvalidDistributionAmount(decimal amount)
        {
            return $"Distribution amount ({amount:C}) must be greater than zero.";
        }

        /// <summary>
        /// Error message when Fund is required but missing.
        /// </summary>
        public const string DistributionRequiresFund =
            "A Fund must be selected for this Distribution.";

        /// <summary>
        /// Error message when Fund Center is required but missing.
        /// </summary>
        public const string DistributionRequiresFundCenter =
            "A Fund Center must be selected for this Distribution.";

        #endregion

        #region Realignment Validation Messages

        /// <summary>
        /// Error message when realignment amount exceeds available funds.
        /// </summary>
        public static string RealignmentExceedsAvailable(decimal amount, decimal available, string loaName)
        {
            return $"Realignment amount ({amount:C}) exceeds available funds ({available:C}) on LOA '{loaName}'.";
        }

        /// <summary>
        /// Error message when realignment is missing required LOA references.
        /// </summary>
        public const string RealignmentRequiresLOAs =
            "Both Credited and Debited Lines of Accounting must be selected.";

        /// <summary>
        /// Error message when realignment amount is invalid.
        /// </summary>
        public static string InvalidRealignmentAmount(decimal amount)
        {
            return $"Realignment amount ({amount:C}) must be greater than zero.";
        }

        /// <summary>
        /// Error message when credited and debited LOAs are the same.
        /// </summary>
        public const string RealignmentSameLOA =
            "Credited and Debited Lines of Accounting cannot be the same.";

        #endregion

        #region Funding Event / Funding Detail Validation Messages

        /// <summary>
        /// Error when two active Funding Events of the same type would overlap in time.
        /// </summary>
        public static string OverlappingFundingEvents(string typeName, string thisName, string otherName)
        {
            return $"Funding Event '{thisName}' overlaps another active {typeName} event '{otherName}'. " +
                   $"Two {typeName} events may not be in effect at the same time.";
        }

        /// <summary>
        /// Error when, at some point in time, the active Allotment percentage for a
        /// given (Fund, PG/SAG) would exceed the active AFP percentage.
        /// </summary>
        public static string AllotmentExceedsAFP(
            string fundName, string pgName, DateTime onDate,
            decimal allotmentPct, decimal afpPct)
        {
            return $"Allotment ({allotmentPct}%) would exceed AFP ({afpPct}%) for " +
                   $"Fund '{fundName}', PG/SAG '{pgName}' on {onDate:yyyy-MM-dd}. " +
                   $"Allotment must never exceed AFP.";
        }

        #endregion

        #region Turn-In Validation Messages

        /// <summary>
        /// Error message when turn-in amount exceeds available.
        /// </summary>
        public static string TurnInExceedsAvailable(decimal amount, decimal available)
        {
            return $"Turn-in amount ({amount:C}) exceeds available funds ({available:C}).";
        }

        /// <summary>
        /// Error message when turn-in amount is invalid.
        /// </summary>
        public static string InvalidTurnInAmount(decimal amount)
        {
            return $"Turn-in amount ({amount:C}) must be greater than zero.";
        }

        /// <summary>
        /// Error message when turn-in is missing required fields.
        /// </summary>
        public const string TurnInRequiresFundCenter =
            "A Fund Center must be selected for this Turn-in.";

        #endregion

        #region Balance Validation Messages

        /// <summary>
        /// Error message when balance doesn't match expected value.
        /// </summary>
        public static string BalanceMismatch(decimal expected, decimal actual)
        {
            return $"Balance mismatch detected. Expected: {expected:C}, Actual: {actual:C}";
        }

        /// <summary>
        /// Error message when balance goes negative.
        /// </summary>
        public static string NegativeBalance(string entityName, decimal balance)
        {
            return $"{entityName} would have a negative balance ({balance:C}). Operation not allowed.";
        }

        #endregion

        #region Name Generation Messages

        /// <summary>
        /// Error message when name generation fails due to missing required field.
        /// </summary>
        public static string NameGenerationMissingField(string entityName, string fieldName)
        {
            return $"Cannot generate name for {entityName}: Required field '{fieldName}' is missing.";
        }

        /// <summary>
        /// Error message when name exceeds maximum length.
        /// </summary>
        public static string NameExceedsMaxLength(int maxLength, int actualLength)
        {
            return $"Generated name exceeds maximum length of {maxLength} characters (actual: {actualLength}).";
        }

        #endregion

        #region General Validation Messages

        /// <summary>
        /// Error message when a required lookup field is missing.
        /// </summary>
        public static string RequiredLookupMissing(string fieldDisplayName)
        {
            return $"The field '{fieldDisplayName}' is required and must be selected.";
        }

        /// <summary>
        /// Error message when a required field is missing.
        /// </summary>
        public static string RequiredFieldMissing(string fieldDisplayName)
        {
            return $"The field '{fieldDisplayName}' is required.";
        }

        /// <summary>
        /// Error message when record is not found.
        /// </summary>
        public static string RecordNotFound(string entityName, string recordId)
        {
            return $"The {entityName} record ({recordId}) could not be found.";
        }

        /// <summary>
        /// Error message when operation is not allowed due to record state.
        /// </summary>
        public static string OperationNotAllowedInState(string operation, string currentState)
        {
            return $"Cannot perform '{operation}' when record is in '{currentState}' status.";
        }

        /// <summary>
        /// Error message for invalid state transition.
        /// </summary>
        public static string InvalidStateTransition(string fromState, string toState)
        {
            return $"Cannot transition from '{fromState}' to '{toState}'. This state change is not allowed.";
        }

        #endregion
    }
}
