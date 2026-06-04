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
    /// Funding mode values for book_prioritization.book_fundingmode.
    /// Direct = funding entered manually on the Prioritization; Itemized = funding
    /// rolled up from book_itemizeddetails children.
    /// </summary>
    public static class FundingModeValues
    {
        public const int Direct = 0;
        public const int Itemized = 1;
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
        public const int Credit = 0;
        public const int Debit = 1;
    }

    /// <summary>
    /// Approval status values for book_requirements.book_approvalstatus.
    /// Distinct from <see cref="ApprovalStatusValues"/> (which is Prioritization).
    /// </summary>
    public static class RequirementApprovalStatusValues
    {
        public const int StateInput = 0;
        public const int StateReview = 1;
        public const int StateReviewed = 2;
        public const int StateApproved = 3;
        public const int NPMReview = 4;
        public const int NPMValidated = 5;
        public const int RIValidated = 6;
        public const int BEApproved = 7;
    }

    /// <summary>
    /// Type values for book_requirements.book_type.
    /// </summary>
    public static class RequirementTypeValues
    {
        public const int State = 0;
        public const int TARC = 1;
        public const int PEC = 2;
        public const int WTC = 3;
        public const int ARNGExternal = 4;
        public const int DOMOPS = 5;
    }

    /// <summary>
    /// Type values for book_fundingevent.book_fundingtype (global option set book_fundingtype).
    /// Also flows through to book_requirementfunding.book_fundingtype as a formula column.
    /// </summary>
    public static class FundingTypeValues
    {
        public const int AFP = 0;
        public const int Allotment = 1;
    }

    /// <summary>
    /// Origin values for book_turnin.book_origin. Distinguishes a state-submitted
    /// Turn-In (Kind A — has items, awaits BE approval, real money returns on approval)
    /// from a sweep-created over-allocation tracker (Kind B — created by
    /// GenerateDistributions when existing credits exceed the current target; its
    /// amount decays as baseline catches up). The Distributions sweep only mutates
    /// or deactivates Sweep-origin records.
    /// Column must be created in the maker portal before this assembly is deployed.
    /// </summary>
    public static class TurnInOriginValues
    {
        public const int State = 0;
        public const int Sweep = 1;
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
