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
        public const string StateCode = "statecode";
    }
}
