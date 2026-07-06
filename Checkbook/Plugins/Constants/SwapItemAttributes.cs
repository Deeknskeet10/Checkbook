namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_swapitem entity.
    /// Paired-row child of book_stateswap: one row = one exchange leg, with
    /// a debit Prio (giving state) and credit Prio (receiving state). Per-row
    /// Fund/PG must match across both Prios. Fund/PG/DebitState are denormalized
    /// onto the row by SwapItemDerivedFieldsPlugin so the parent roll-up and
    /// filtered lookups don't need to traverse the Prio each time.
    /// LOA is NOT stored on the item — it is resolved from the Prio at
    /// BE-approval time by SwapLOAResolver, matching the Turn-In pattern.
    /// </summary>
    public static class SwapItemAttributes
    {
        public const string Id = "book_swapitemid";
        public const string Name = "book_name";
        public const string StateSwap = "book_stateswap";
        public const string DebitPrioritization = "book_debitprioritization";
        public const string CreditPrioritization = "book_creditprioritization";
        // Named "book_newamount" to align with LedgerAttributes.Amount and
        // TurnIn's book_newamount convention.
        public const string Amount = "book_newamount";

        // Plugin-derived denormalizations from the debit Prio.
        public const string Fund = "book_fund";
        public const string PG = "book_pg";
        public const string DebitState = "book_debitstate";

        public const string StateCode = "statecode";
    }
}
