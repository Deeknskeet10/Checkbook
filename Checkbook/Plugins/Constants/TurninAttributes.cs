namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_turnin entity.
    /// </summary>
    public static class TurninAttributes
    {
        public const string Id = "book_turninid";
        public const string Name = "book_name";
        // Legacy book_amount (Double) was replaced by book_newamount (Decimal).
        // All plugin reads/writes should use NumericHelper.ToDecimal for safety.
        // Semantically the TDP amount being returned (Kind A) or 0 (Kind B sweep
        // record — TDP is not changing on overage detection).
        public const string Amount = "book_newamount";
        // AFP / Allotment amounts that will flow back as Distributions on approval.
        // Kind A: auto-computed by TurnInAmountCalculator from Amount × current pcts.
        // Kind B: written by the GenerateDistributions sweep as the detected overage.
        // Both columns must be created in the maker portal.
        public const string AFPAmount = "book_afpamount";
        public const string AllotmentAmount = "book_allotmentamount";
        public const string FiscalYear = "book_fiscalyear";
        public const string Fund = "book_fund";
        public const string FundCenter = "book_fundcenter";
        public const string PG = "book_pg";
        public const string IdentifiedTurnInAmount = "book_identifiedturninamount";
        public const string StateApproved = "book_stateapproved";
        public const string BEApproved = "book_beapproved";
        // Distinguishes Kind A (State-submitted) from Kind B (sweep-created over-allocation
        // tracker). The Distributions sweep only mutates / deactivates Sweep-origin records.
        // Column must be created in the maker portal — option set values State=0, Sweep=1.
        public const string Origin = "book_origin";
        public const string StateCode = "statecode";
    }
}
