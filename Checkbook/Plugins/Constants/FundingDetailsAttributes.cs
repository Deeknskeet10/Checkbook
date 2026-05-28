namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_fundingdetails entity.
    /// One row per (FundingEvent, PG/SAG, Fund) carrying the distribution percentage
    /// that drives Generate Distributions.
    /// </summary>
    public static class FundingDetailsAttributes
    {
        public const string Id = "book_fundingdetailsid";
        public const string Name = "book_name";
        public const string FundingEvent = "book_fundingevent";
        public const string PGSAG = "book_pgsag";
        public const string Fund = "book_fund";
        public const string DistributionPercentage = "book_distributionpercentage";
        public const string StateCode = "statecode";
    }
}
