using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct reductions of
    /// <c>book_itemizeddetails.book_fundedamount</c> — the per-detail funded the NPM
    /// enters, which is the authoritative funded total for an Itemized Prioritization
    /// (Σ details → Prio total; see docs/Prioritization-Funding-Reconciliation.md) —
    /// when the admin toggle <c>book_LockManualFundedEdits</c> is on. Increases and
    /// no-op saves are always allowed. Shared rules live in
    /// <see cref="FundedAmountLockBase"/>.
    ///
    /// Closes the gap where detail funded could be reduced directly even with the
    /// toggle on. The detail funded is a leaf (nothing rolls up into it — the itemized
    /// roll-up reads it and writes the Prio, never the reverse), so no extra authorized
    /// ancestors are needed: the base already lets Turn-Ins, Realignments, State Swaps,
    /// and the Distribution generator through by walking the parent chain.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_itemizeddetails
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first,
    ///             before PrioritizationItemizedRollup)
    ///   • Filtering attributes: book_fundedamount
    ///   • Pre-Image "PreImage" — columns: book_fundedamount
    /// </summary>
    public class ItemizedDetailFundedAmountLock : FundedAmountLockBase
    {
        protected override string EntityName => EntityNames.ItemizedDetails;
        protected override string LockedAttribute => ItemizedDetailsAttributes.FundedAmount;
        protected override string FieldLabel => "Itemized Detail Funded Amount";
    }
}
