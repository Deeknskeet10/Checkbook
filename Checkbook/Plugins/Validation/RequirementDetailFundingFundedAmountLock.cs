using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct reductions of
    /// <c>book_requirementdetailfunding.book_fundedamount</c> (the RD↔RF
    /// direct-funding junction, the no-Prio analog of
    /// <c>book_prioritizationfunding</c>) when the admin toggle
    /// <c>book_LockManualFundedEdits</c> is on. Increases and no-op saves are
    /// always allowed. Shared rules live in <see cref="FundedAmountLockBase"/>.
    ///
    /// Closes the gap where an RD funding row could be lowered by hand and the
    /// reduction would flow into RF Funded via <c>RequirementDetailFundingRollup</c>
    /// — <see cref="RequirementFundingFundedAmountLock"/> authorizes this entity as
    /// a roll-up ancestor, so the reduction has to be blocked here, at the source.
    /// The junction amount is a leaf (nothing rolls up into it), so only the base
    /// authorized ancestors apply: Turn-Ins, Realignments, State Swaps, and the
    /// Distribution generator.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_requirementdetailfunding
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first,
    ///             before RequirementDetailFundingGuard)
    ///   • Filtering attributes: book_fundedamount
    ///   • Pre-Image "PreImage" — columns: book_fundedamount
    /// </summary>
    public class RequirementDetailFundingFundedAmountLock : FundedAmountLockBase
    {
        protected override string EntityName => EntityNames.RequirementDetailFunding;
        protected override string LockedAttribute => RequirementDetailFundingAttributes.FundedAmount;
        protected override string FieldLabel => "Requirement Detail Funded Amount";
    }
}
