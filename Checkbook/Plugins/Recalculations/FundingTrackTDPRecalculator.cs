using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation recalculator that updates the associated LOA's TDP and
    /// TDP Remaining whenever a Funding Track is created/updated/deleted or
    /// when its LOA/ResourceAmount changes. On Update with a re-linked LOA
    /// both the old and new LOA are recalculated.
    /// </summary>
    public sealed class FundingTrackTDPRecalculator : LOATouchPropagator
    {
        protected override string EntityName => EntityNames.FundingTrack;
        protected override string LoaAttribute => FundingTrackAttributes.LineOfAccounting;
    }
}
