namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_ledger entity.
    /// </summary>
    public static class LedgerAttributes
    {
        public const string Id = "book_ledgerid";
        public const string Name = "book_name";
        public const string Amount = "book_newamount";
        public const string LineOfAccounting = "book_lineofaccounting";
        public const string LedgerType = "book_ledgertype";
        public const string TransactionDate = "book_transactiondate";
        public const string LedgerDirection = "book_ledgerdirection";
        public const string Realignment = "book_realignment";
        public const string TurnIn = "book_turnin";
        public const string StateSwap = "book_stateswap";
        public const string RelatedEntry = "book_relatedentry";
        public const string StateCode = "statecode";
    }
}
