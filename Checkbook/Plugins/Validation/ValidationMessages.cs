using System;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// User-facing validation error message templates. Only add a member here
    /// when a plugin actually throws it — unused templates rot.
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

        #endregion

        #region Prioritization Funding / Approval Messages

        /// <summary>
        /// Error when funding is applied to a Prioritization that has not reached
        /// NPM Review. Funding may only be held by a Prioritization in NPM Review;
        /// below that stage it would be invisible to the RF funded roll-up and
        /// surface as a phantom TDP gap on the parent Requirement Funding.
        /// </summary>
        public const string FundingRequiresNPMReview =
            "Funding can only be applied to a Prioritization that is in NPM Review. " +
            "Advance this Prioritization to NPM Review before funding it.";

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
    }
}
