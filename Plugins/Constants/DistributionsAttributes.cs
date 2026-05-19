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
        public const string StateCode = "statecode";
    }
}
