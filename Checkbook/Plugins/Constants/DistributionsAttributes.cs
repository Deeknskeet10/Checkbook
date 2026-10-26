namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_distributions entity.
    /// </summary>
    public static class DistributionsAttributes
    {
        public const string Id = "book_distributionsid";
        public const string Name = "book_name";
        // Legacy book_amount (Double) replaced by book_newamount (Decimal).
        // All reads/writes should use NumericHelper.ToDecimal for safety.
        public const string Amount = "book_newamount";
        public const string Fund = "book_fund";
        public const string FundCenter = "book_fundcenter";
        public const string FundingEvent = "book_fundingevent";
        public const string PGSAG = "book_newpgsag";
        public const string DisbursementDirection = "book_disbursementdirection";
        public const string DebitedDistribution = "book_debiteddistribution";
        public const string EntryDocumentNumber = "book_entrydocumentnumber";
        public const string ManualEntry = "book_manualentry";
        public const string Remarks = "book_remarks";
        public const string TurnIn = "book_turnin";
        public const string StateSwap = "book_stateswap";
        public const string Realignment = "book_realignment";
        public const string EnteredIntoGFEBS = "book_newenteredintogfebs";
        public const string StateCode = "statecode";

        /// <summary>
        /// Lookups that tie a row to the approval pipeline that wrote it (Turn-In,
        /// State Swap, Realignment). A row carrying ANY of them is pipeline-owned and
        /// immutable to the GenerateDistributions reconcile — both the bucket
        /// processor and Phase 4 cleanup must check every entry. Add new pipelines here.
        /// </summary>
        public static readonly System.Collections.Generic.IReadOnlyList<string> PipelineParentLinks =
            new[] { TurnIn, StateSwap, Realignment };
    }
}
