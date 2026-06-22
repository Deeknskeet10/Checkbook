namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for the book_requirementdetailfunding junction.
    /// One row per (Requirement Detail, Requirement Funding) allocation —
    /// the no-Prio direct-funding analog of book_prioritizationfunding.
    /// </summary>
    public static class RequirementDetailFundingAttributes
    {
        public const string Id = "book_requirementdetailfundingid";
        public const string Name = "book_name";
        public const string RequirementDetail = "book_requirementdetail";
        public const string RequirementFunding = "book_requirementfunding";
        public const string FundedAmount = "book_fundedamount";
        public const string ValidatedAmount = "book_validatedamount";
        public const string StateCode = "statecode";
    }
}
