using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct reductions of
    /// <c>book_prioritization.book_newfundedamounttdp</c> (Funded Amount (TDP))
    /// when the admin toggle <c>book_LockManualFundedEdits</c> is on.
    /// Shared rules live in <see cref="FundedAmountLockBase"/>.
    ///
    /// Beyond the four funding tools, the field is legitimately recomputed by
    /// <c>PrioritizationFundingRollup</c> (Prioritization Funding rows) and
    /// <c>PrioritizationItemizedRollup</c> (Itemized Details rows) — writes
    /// with those entities in the ancestor chain are allowed, so deleting a
    /// funding or item row still lowers the roll-up under the lock.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_prioritization
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first)
    ///   • Filtering attributes: book_newfundedamounttdp
    ///   • Pre-Image "PreImage" — columns: book_newfundedamounttdp
    /// </summary>
    public class PrioritizationFundedAmountLock : FundedAmountLockBase
    {
        protected override string EntityName => EntityNames.Prioritization;
        protected override string LockedAttribute => PrioritizationAttributes.FundedAmountTDP;
        protected override string FieldLabel => "Funded Amount (TDP)";

        protected override bool IsAuthorizedAncestor(string message, string entityName)
        {
            return base.IsAuthorizedAncestor(message, entityName) ||
                   IsRollupSourceWrite(message, entityName, EntityNames.PrioritizationFunding) ||
                   IsRollupSourceWrite(message, entityName, EntityNames.ItemizedDetails);
        }
    }
}
