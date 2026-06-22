using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Rejects any direct edit of <c>book_newtdp</c> on an LOA. LOA TDP is
    /// strictly derived from <c>Σ FundingTrack.ResourceAmount + Ledger net</c>
    /// and maintained by the LOA-touch propagators in this folder; a manual
    /// edit would silently drift out of sync with those sources until the
    /// next propagator run reset it.
    ///
    /// Defense-in-depth: the form should also lock <c>book_newtdp</c>
    /// read-only and field-level security should restrict the column's
    /// write privilege. This guard is the final fallback against
    /// WebAPI / Excel / admin edits that bypass the UI.
    /// </summary>
    public sealed class FundingLineTDPRemainingUpdater : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.FundingLine) return;
            if (context.MessageName != "Update") return;

            var target = GetTarget(context);
            if (!target.Contains(FundingLineAttributes.TDP)) return;

            throw new InvalidPluginExecutionException(
                "LOA TDP cannot be edited directly. It is derived from " +
                "Funding Track Resource Amounts and Ledger entries on this LOA. " +
                "If the value looks wrong, fix the underlying Funding Tracks or " +
                "Ledger rows — the recalculation plugins will update LOA TDP " +
                "automatically.");
        }
    }
}
