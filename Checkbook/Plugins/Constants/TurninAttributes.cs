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
        public const string Amount = "book_newamount";
        public const string FiscalYear = "book_fiscalyear";
        public const string Fund = "book_fund";
        public const string FundCenter = "book_fundcenter";
        public const string PG = "book_pg";
        public const string IdentifiedTurnInAmount = "book_identifiedturninamount";
        public const string StateApproved = "book_stateapproved";
        public const string BEApproved = "book_beapproved";
        public const string StateCode = "statecode";
    }
}
