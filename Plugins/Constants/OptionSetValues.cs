namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// State code values for record status (system convention — same across all entities).
    /// </summary>
    public static class StateCodeValues
    {
        public const int Active = 0;
        public const int Inactive = 1;
    }

    /// <summary>
    /// Approval status values for book_prioritization.book_approvalstatus.
    /// </summary>
    public static class ApprovalStatusValues
    {
        public const int StateInput = 0;
        public const int FCReview = 1;
        public const int StateReview = 2;
        public const int StateApproved = 3;
        public const int NPMReview = 4;
    }

    /// <summary>
    /// Direction values for book_ledger.book_ledgerdirection.
    /// </summary>
    public static class LedgerDirectionValues
    {
        public const int Credited = 0;
        public const int Debited  = 1;
    }

    /// <summary>
    /// Type values for book_ledger.book_ledgertype.
    /// </summary>
    public static class LedgerTypeValues
    {
        public const int Distribution = 100000000;
        public const int Realignment = 100000001;
        public const int TurnIn = 100000002;
    }

    /// <summary>
    /// Direction values for book_distributions.book_disbursementdirection.
    /// </summary>
    public static class DisbursementDirectionValues
    {
        public const int Credit = 100000000;
        public const int Debit = 100000001;
    }

    /// <summary>
    /// Decision values for book_realignments.book_bedecision.
    /// NOTE: confirm values in the target env — most custom picklists in this solution
    /// start at 100000000, but BE Decision is documented as 0/1 here.
    /// </summary>
    public static class RealignmentBEDecisionValues
    {
        public const int Approved = 0;
        public const int Denied = 1;
    }
}
