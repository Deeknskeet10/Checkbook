using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct reductions of
    /// <c>book_prioritizationfunding.book_fundedamount</c> (the FY27 Prioritization
    /// Funding junction allocation) when the admin toggle
    /// <c>book_LockManualFundedEdits</c> is on. Increases and no-op saves are
    /// always allowed. Shared rules live in <see cref="FundedAmountLockBase"/>.
    ///
    /// Why this guard exists alongside <see cref="PrioritizationFundedAmountLock"/>:
    /// for FY27+, a Prioritization's funding physically lives on these junction
    /// rows (edited through the PrioritizationFundingGrid), and it rolls UP to
    /// <c>book_prioritization.book_newfundedamounttdp</c>. The Prio-level lock
    /// authorizes <c>book_prioritizationfunding</c> as a roll-up ancestor, so it
    /// cannot see a manual reduction made directly on the junction — that edit
    /// has to be blocked here, at the source.
    ///
    /// The junction amount is a leaf (nothing rolls up into it), so no extra
    /// roll-up ancestors are authorized: the base already lets Turn-Ins,
    /// Realignments, State Swaps, and the Distribution generator through by
    /// walking the parent chain. Pull-back cleanup deactivates junction rows
    /// (a statecode change, not a book_fundedamount write), so it never trips
    /// this filter.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_prioritizationfunding
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first,
    ///             before PrioritizationFundingGuard)
    ///   • Filtering attributes: book_fundedamount
    ///   • Pre-Image "PreImage" — columns: book_fundedamount
    /// </summary>
    public class PrioritizationFundingFundedAmountLock : FundedAmountLockBase
    {
        protected override string EntityName => EntityNames.PrioritizationFunding;
        protected override string LockedAttribute => PrioritizationFundingAttributes.FundedAmount;
        protected override string FieldLabel => "Funded Amount";
    }
}
