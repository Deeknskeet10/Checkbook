namespace Checkbook.Plugins.Constants
{
 /// <summary>
    /// Attribute schema names for book_itemizeddetails entity.
    /// Per-Prioritization copies of a Requirement's Requirement Details; their
    /// funding amounts roll up to the parent Prioritization.
    /// </summary>
    public static class ItemizedDetailsAttributes
    {
        public const string Id = "book_itemizeddetailsid";
        public const string Name = "book_name";
        public const string Prioritization = "book_prioritization";
        public const string RequirementItem = "book_requirementitem"; // lookup -> book_requirementdetails
        public const string FundCenter = "book_fundcenter";           // lookup -> book_fundcenter; blank = state level
        public const string RequestedAmount = "book_requestedamount"; // decimal
        public const string ValidatedAmount = "book_validatedamount"; // decimal
        public const string FundedAmount = "book_fundedamount";       // decimal
        public const string Quantity = "book_quantity";
        public const string StateCode = "statecode";
    }
}