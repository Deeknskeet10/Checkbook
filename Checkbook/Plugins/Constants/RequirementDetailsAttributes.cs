namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_requirementdetails entity.
    /// Items an NPM adds to a Requirement; the source for Itemized Details.
    /// </summary>
    public static class RequirementDetailsAttributes
    {
        public const string Id = "book_requirementdetailsid";
        public const string Name = "book_name";
        public const string Requirement = "book_requirement";
        public const string Item = "book_item";
        public const string Category = "book_category";
        public const string QuantityType = "book_quantitytype";
        public const string TDC = "book_tdc";
        public const string StateCode = "statecode";
    }
}