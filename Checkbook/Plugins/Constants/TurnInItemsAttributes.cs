namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_turninitems entity.
    /// Child line items on a Turn-In: which Prioritization (or RF) is being turned in,
    /// for how much. LOA is not stored on the item — it is derived from the linked
    /// Prioritization or Requirement Funding at load time.
    /// </summary>
    public static class TurnInItemsAttributes
    {
        public const string Id = "book_turninitemsid";
        public const string Name = "book_name";
        // Decimal column. Replaces the previously-referenced "book_amounttaken"
        // which does NOT exist in this env.
        public const string Amount = "book_newturninamount";
        public const string Turnin = "book_turnin";
        public const string Prioritization = "book_prioritization";
        public const string RequirementFunding = "book_requirementfunding";
        public const string StateCode = "statecode";
    }
}
