using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation updater that recalculates the LOA's TDP / TDP Remaining
    /// whenever a Requirement Funding's TDP or LOA changes (and on Create/Delete).
    /// </summary>
    /// <remarks>
    /// The Update step is currently registered without a pre-image, so an
    /// RF re-linked to a different LOA only recalculates the new LOA. If
    /// stale TDP Remaining on the old LOA ever surfaces in practice, add a
    /// PreImage on <c>book_lineofaccounting</c> to the Update step and the
    /// base class will pick up both LOAs automatically.
    /// </remarks>
    public sealed class RequirementFundingTDPRemainingUpdater : LOATouchPropagator
    {
        protected override string EntityName => EntityNames.RequirementFunding;
        protected override string LoaAttribute => RequirementFundingAttributes.LineOfAccounting;
    }
}
