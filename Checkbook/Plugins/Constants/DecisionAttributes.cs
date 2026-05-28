namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_decision entity.
    /// Note: book_fundingline column actually targets book_fundingtrack (misleading
    /// schema name from a historical rename). Decimal amount lives on book_decisionamount.
    /// </summary>
    public static class DecisionAttributes
    {
        public const string DecisionId = "book_decisionid";
        public const string FundingTrack = "book_fundingline";
        public const string Amount = "book_decisionamount";
    }
}
