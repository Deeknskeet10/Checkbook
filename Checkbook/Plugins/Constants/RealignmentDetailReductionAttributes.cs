namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_realignmentdetailreduction (FY27).
    /// Child of book_realignments: one row = one ItemizedDetail the NPM elects to
    /// reduce so that an itemized-debit realignment keeps the funding invariant
    /// (Σ ItemizedDetail.funded ≡ Prio total ≡ Σ PrioritizationFunding.funded).
    ///
    /// Only used when the debit Prioritization is Itemized — the realignment pulls
    /// funding out of PF junctions, which would drop Σ PF below the Prio total; the
    /// NPM must reduce selected details by the same total before approval. The
    /// processor applies these reductions (as the authorized reducer, so the
    /// increase-only FundedAmountLock lets them through) in the same transaction as
    /// the PF moves. Direct-mode debit has no details and carries none.
    /// See docs/Prioritization-Funding-Reconciliation.md §5 and
    /// docs/Realignment-FY27-Redesign.md §9.8.
    /// </summary>
    public static class RealignmentDetailReductionAttributes
    {
        public const string EntityLogicalName = "book_realignmentdetailreduction";

        public const string Id = "book_realignmentdetailreductionid";
        public const string Name = "book_name";
        public const string Realignment = "book_realignment";
        public const string ItemizedDetail = "book_itemizeddetail";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }
}
