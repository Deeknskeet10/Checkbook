using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation recalculator that updates the associated LOA's TDP and
    /// TDP Remaining whenever a Funding Track is created/updated/deleted or
    /// when its LOA/ResourceAmount changes. On Update with a re-linked LOA
    /// both the old and new LOA are recalculated.
    ///
    /// Runs nested too (<see cref="LOATouchPropagator.RecalcWhenNested"/>) so
    /// Import from Excel/CSV Beginning-Balance loads (Depth 2) roll up.
    /// Still skips under a Decision's roll-up recalc or LOAGenerator's FT link,
    /// which recalc the LOA themselves.
    /// </summary>
    public sealed class FundingTrackTDPRecalculator : LOATouchPropagator
    {
        protected override string EntityName => EntityNames.FundingTrack;
        protected override string LoaAttribute => FundingTrackAttributes.LineOfAccounting;
        protected override bool RecalcWhenNested => true;
    }
}
