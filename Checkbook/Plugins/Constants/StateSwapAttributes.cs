namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_stateswap entity.
    /// A State Swap records an agreed-upon fund exchange between two states.
    /// Owned by the initiating State's user; auto-shared with StateA + StateB
    /// role-teams. BE approval is always required; on BE approval, the swap
    /// orchestrator writes ledger entries (skipping same-LOA pairs as net-zero)
    /// and adjusts Prio.FundedAmount on both sides.
    /// </summary>
    public static class StateSwapAttributes
    {
        public const string Id = "book_stateswapid";
        public const string Name = "book_name";
        public const string StateA = "book_statea";
        public const string StateB = "book_stateb";
        public const string FiscalYear = "book_newfiscalyear";

        // Plugin-maintained totals (SwapRollupPlugin). Bucketed by the debit
        // Prio's state, not by the parent's StateA/StateB slots literally —
        // "sent by A" means Σ items whose debit Prio belongs to StateA.
        public const string TotalSentByA = "book_totalsentbya";
        public const string TotalSentByB = "book_totalsentbyb";
        // Two Options; true iff totals are equal and > 0.
        public const string IsBalanced = "book_isbalanced";

        // Approval flags. State A and State B approvals gate BE approval;
        // BE approval is the ledger-write trigger. Written by the PCF (and
        // enforced by SwapValidator).
        public const string StateAApproved = "book_stateaapproved";
        public const string StateAApprovedBy = "book_stateaapprovedby";
        public const string StateAApprovedOn = "book_stateaapprovedon";
        public const string StateBApproved = "book_statebapproved";
        public const string StateBApprovedBy = "book_statebapprovedby";
        public const string StateBApprovedOn = "book_statebapprovedon";
        public const string BEApproved = "book_beapproved";
        public const string BEApprovedBy = "book_beapprovedby";
        public const string BEApprovedOn = "book_beapprovedon";

        // Denial workflow. Any approver can deny; SwapDenialPlugin resets the
        // state approvals and preserves DenialReason as history until the
        // drafter resubmits.
        public const string Denied = "book_denied";
        public const string DenialReason = "book_denialreason";

        public const string Notes = "book_notes";
        public const string StateCode = "statecode";
    }
}
