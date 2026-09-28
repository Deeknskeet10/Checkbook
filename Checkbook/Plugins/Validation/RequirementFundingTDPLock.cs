using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct reductions of
    /// <c>book_requirementfunding.book_newtdp</c> (TDP) when the admin toggle
    /// <c>book_LockManualFundedEdits</c> is on. Increases and no-op saves are
    /// always allowed. Shared rules live in <see cref="FundedAmountLockBase"/>.
    ///
    /// RF TDP is a top-down number (allocated to the RF from its LOA); it is
    /// never rolled up from child Prioritizations, so there are no roll-up
    /// source ancestors to authorize beyond the four funding tools the base
    /// already recognises. Turn-Ins and Realignments move TDP between RFs/LOAs
    /// and run with their orchestrator Update in the ancestor chain, so those
    /// reductions still go through; only a manual form / bulk / Web API edit
    /// (no authorized parent) is blocked.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_requirementfunding
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first,
    ///             before RequirementFundingTDPValidator)
    ///   • Filtering attributes: book_newtdp
    ///   • Pre-Image "PreImage" — columns: book_newtdp
    /// </summary>
    public class RequirementFundingTDPLock : FundedAmountLockBase
    {
        protected override string EntityName => EntityNames.RequirementFunding;
        protected override string LockedAttribute => RequirementFundingAttributes.TDP;
        protected override string FieldLabel => "TDP";
    }
}
