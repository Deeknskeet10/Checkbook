namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_fund entity.
    /// </summary>
    public static class FundAttributes
    {
        public const string Id = "book_fundid";
        public const string Name = "book_name";
        public const string FundKey = "book_fundkey";
        public const string FundingCode = "book_fundingcode";
        public const string FiscalYear = "book_fiscalyear";
        public const string Appropriation = "book_appropriation";
        public const string BOC = "book_boc";
        public const string DollarType = "book_dollartypefundedprogram";

        /// <summary>
        /// Lookup to the book_fundedprogram table (FY27+ fund model). The
        /// "new" prefix is deliberate — the logical name book_fundedprogram
        /// is already taken by a legacy picklist on this entity.
        /// </summary>
        public const string FundedProgram = "book_newfundedprogram";

        public const string StateCode = "statecode";
    }
}
