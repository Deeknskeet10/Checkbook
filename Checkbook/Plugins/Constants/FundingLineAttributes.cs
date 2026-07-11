namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_fundingline (LOA) entity.
    /// </summary>
    public static class FundingLineAttributes
    {
        public const string Id = "book_fundinglineid";
        public const string Name = "book_name";
        public const string TDP = "book_newtdp";
        public const string TDPRemaining = "book_newtdpremaining";
        public const string Fund = "book_fund";
        public const string DisbursingOfficial = "book_disbursingofficial";
        public const string SAG = "book_sag";
        public const string PG = "book_pg";
        public const string MDEP = "book_mdep";
        public const string BOC = "book_newboc";
        public const string DollarType = "book_newdollartype";
        public const string Category = "book_category";
        public const string FiscalYear = "book_fiscalyear";
        public const string StateCode = "statecode";

        /// <summary>N:N relationship name between book_fundingline and book_ape.</summary>
        public const string APERelationship = "book_FundingLine_book_APE_book_APE";
    }
}
