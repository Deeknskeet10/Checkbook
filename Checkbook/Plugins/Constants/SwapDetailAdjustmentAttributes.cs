namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_swapdetailreduction (FY27).
    /// Child of book_stateswap: one row = one Itemized Detail on an itemized Prioritization
    /// the swap debits, reduced so that Σ details still equals the Prio total once its PF
    /// legs leave. Prio-level and PF-agnostic: per debited itemized Prio, Σ reductions on
    /// its details == Σ legs out of it. Keyed to the swap (not the item) because one Prio
    /// may feed several legs. See docs/StateSwap-FY27-Redesign.md §4.
    /// </summary>
    public static class SwapDetailReductionAttributes
    {
        public const string EntityLogicalName = "book_swapdetailreduction";

        public const string Id = "book_swapdetailreductionid";
        public const string Name = "book_name";
        public const string StateSwap = "book_stateswap";
        public const string ItemizedDetail = "book_itemizeddetail";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_swapdetailincrease (FY27).
    /// Credit-side mirror of <see cref="SwapDetailReductionAttributes"/>: per credited
    /// itemized Prio, Σ increases on its details == Σ legs into it. Raised before the
    /// credit PF so the Σ PF ≤ Prio-total cap holds. See docs/StateSwap-FY27-Redesign.md §6.
    /// </summary>
    public static class SwapDetailIncreaseAttributes
    {
        public const string EntityLogicalName = "book_swapdetailincrease";

        public const string Id = "book_swapdetailincreaseid";
        public const string Name = "book_name";
        public const string StateSwap = "book_stateswap";
        public const string ItemizedDetail = "book_itemizeddetail";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }
}
