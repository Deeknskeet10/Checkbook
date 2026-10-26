using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct reductions of
    /// <c>book_requirementfunding.book_newfundedamount</c> (Funded Amount) when
    /// the admin toggle <c>book_LockManualFundedEdits</c> is on. Increases and
    /// no-op saves are always allowed. Shared rules live in
    /// <see cref="FundedAmountLockBase"/>.
    ///
    /// TDP is deliberately NOT locked: it may move up or down freely, because
    /// lowering TDP only shrinks Withholding (TDP − Funded). The floor is
    /// enforced by <see cref="RequirementFundingTDPValidator"/> (Funded ≤ TDP),
    /// so TDP can drop only as far as the available Withholding allows.
    ///
    /// Beyond the four funding tools, Funded Amount is legitimately recomputed
    /// by the roll-ups that call <c>FundingRollupHelper.RecalculateRFFunded</c>:
    /// <c>PrioritizationRollupToRequirementFunding</c> /
    /// <c>PrioritizationSingleRfAutoAllocate</c> (Prioritization rows),
    /// <c>PrioritizationFundingRollup</c> (FY27 junction rows), and
    /// <c>RequirementDetailFundingRollup</c> (RD funding rows). Writes with those
    /// entities in the ancestor chain are allowed, so a pull-back or a deleted
    /// child row still lowers the roll-up under the lock. Manual reductions at
    /// those sources are blocked by their own guards.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_requirementfunding
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first,
    ///             before RequirementFundingTDPValidator)
    ///   • Filtering attributes: book_newfundedamount
    ///   • Pre-Image "PreImage" — columns: book_newfundedamount
    /// </summary>
    public class RequirementFundingFundedAmountLock : FundedAmountLockBase
    {
        protected override string EntityName => EntityNames.RequirementFunding;
        protected override string LockedAttribute => RequirementFundingAttributes.FundedAmount;
        protected override string FieldLabel => "Funded Amount";

        protected override bool IsAuthorizedAncestor(string message, string entityName)
        {
            return base.IsAuthorizedAncestor(message, entityName) ||
                   IsRollupSourceWrite(message, entityName, EntityNames.Prioritization) ||
                   IsRollupSourceWrite(message, entityName, EntityNames.PrioritizationFunding) ||
                   IsRollupSourceWrite(message, entityName, EntityNames.RequirementDetailFunding) ||
                   // PrioritizationItemizedRollup re-rolls a legacy Prio's direct RF.
                   IsRollupSourceWrite(message, entityName, EntityNames.ItemizedDetails);
        }
    }
}
