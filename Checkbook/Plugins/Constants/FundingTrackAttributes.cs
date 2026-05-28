namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_fundingtrack entity.
    /// </summary>
    public static class FundingTrackAttributes
    {
        public const string Id = "book_fundingtrackid";
        public const string Name = "book_name";
        public const string ResourceAmount = "book_newresourceamount";
        public const string LineOfAccounting = "book_lineofaccountingloa";
        public const string DecisionTotal = "book_newdecisiontotal";

        // Grain fields — drive LOA find-or-create.
        public const string DisbursingOfficial = "book_disbursingofficial";
        public const string Fund = "book_fund";
        public const string BOC = "book_boc";
        public const string DollarType = "book_dollartype";
        public const string PG = "book_pg";
        public const string SAG = "book_sag";
        public const string MDEP = "book_mdep";
        public const string APE = "book_ape";

        public const string StateCode = "statecode";
    }
}
