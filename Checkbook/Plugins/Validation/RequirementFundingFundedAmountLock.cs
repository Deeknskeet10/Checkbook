using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct reductions of
    /// <c>book_requirementfunding.book_newfundedamount</c> (Funded Amount)
    /// when the admin toggle <c>book_LockManualFundedEdits</c> is on.
    /// Shared rules live in <see cref="FundedAmountLockBase"/>.
    ///
    /// Beyond the four funding tools, the field is legitimately recomputed by
    /// <c>PrioritizationRollupToRequirementFunding</c> (Prioritization rows)
    /// and <c>RequirementDetailFundingRollup</c> (RD funding junction rows) —
    /// writes with those entities in the ancestor chain are allowed, so
    /// deleting a Prioritization or an RD funding row still lowers the
    /// roll-up under the lock.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_requirementfunding
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first)
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
                   IsRollupSourceWrite(message, entityName, EntityNames.RequirementDetailFunding);
        }
    }
}
