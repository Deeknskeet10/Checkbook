namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for the book_prioritizationfunding junction.
    /// One row per (Prioritization, Requirement Funding) allocation; introduced
    /// FY27+ to dedupe Prioritizations from per-RF to per-(Requirement, FY).
    /// </summary>
    public static class PrioritizationFundingAttributes
    {
        public const string Id = "book_prioritizationfundingid";
        public const string Name = "book_name";
        public const string Prioritization = "book_prioritization";
        public const string RequirementFunding = "book_requirementfunding";
        public const string FundedAmount = "book_fundedamount";
        public const string ValidatedAmount = "book_validatedamount";

        // ── Spend-plan classification (stamped, plugin-owned, read-only to users) ──
        // Set by PrioritizationFundingSpendPlanStamp on create and kept in sync
        // by the Requirement / RF cascades. Consumers (grid, rollup) read these
        // stamped values and must NEVER re-derive the mode from the live
        // Requirement flag — the PF is the point-in-time snapshot for its FY.

        /// <summary>Boolean mirror of the parent Requirement's book_national.</summary>
        public const string CentrallyManaged = "book_centrallymanaged";

        /// <summary>
        /// Choice — how this allocation is spend-planned. Values in
        /// <see cref="SpendPlanModeValues"/>. Authoritative for grid/rollup.
        /// </summary>
        public const string SpendPlanMode = "book_spendplanmode";

        /// <summary>
        /// Lookup → book_fundingline, stamped from the RF's LOA so Fund/SAG are
        /// one link away (PF → LOA → book_fund / book_sag) for the state rollup.
        /// </summary>
        public const string LineOfAccounting = "book_lineofaccounting";

        public const string StateCode = "statecode";
        public const string StatusCode = "statuscode";
    }

    /// <summary>
    /// book_prioritizationfunding.book_spendplanmode option values. A local
    /// option set; values match the small 0-based convention used elsewhere
    /// (see SpendPlanRowTypeValues). State-Rollup is the derived default —
    /// users never pick it; the stamp plugin sets it.
    /// </summary>
    public static class SpendPlanModeValues
    {
        public const int Breakout = 0;
        public const int StateRollup = 1;
        public const int Central = 2;
    }
}
