namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_realignmentdetailincrease (FY27).
    /// Child of book_realignments: one row = one ItemizedDetail the NPM elects to
    /// INCREASE on the CREDIT side so that crediting into an Itemized Prioritization
    /// keeps the funding invariant (Σ ItemizedDetail.funded ≡ Prio total ≡ Σ PF.funded).
    ///
    /// The credit side mirrors the debit side (see
    /// <see cref="RealignmentDetailReductionAttributes"/>): a realignment raises the
    /// credit Prioritization's PF junction, which would push Σ PF above the Itemized
    /// Prio's detail-driven total (and trip PrioritizationFundingGuard's cap). The NPM
    /// picks which credit details take the funding, and the processor raises them
    /// BEFORE the credit PF upsert so the Prio total is already up. Increases are always
    /// allowed by the FundedAmountLock (only reductions are gated). Only used when the
    /// credit Prioritization is Itemized; Direct-mode credit has no details — the PF
    /// raise *is* the Prio-total raise. See
    /// docs/Prioritization-Funding-Reconciliation.md §5 and
    /// docs/Realignment-FY27-Redesign.md §9.8.
    /// </summary>
    public static class RealignmentDetailIncreaseAttributes
    {
        public const string EntityLogicalName = "book_realignmentdetailincrease";

        public const string Id = "book_realignmentdetailincreaseid";
        public const string Name = "book_name";
        public const string Realignment = "book_realignment";
        public const string ItemizedDetail = "book_itemizeddetail";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }
}
