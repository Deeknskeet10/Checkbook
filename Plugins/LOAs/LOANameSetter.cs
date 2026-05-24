using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.LOAs.Helpers;

namespace Checkbook.Plugins.LOAs
{
    /// <summary>
    /// Pre-Operation Create plugin on <c>book_fundingline</c>. Writes the canonical
    /// <c>book_name</c> + copies <c>book_fiscalyear</c> from the related Fund — the
    /// roles previously owned by the <c>LineofAccounting-Initialization</c> XAML
    /// workflow.
    ///
    /// Combined with the alternate key on <c>book_name</c>, this is the sole
    /// uniqueness guard for FY27+ LOAs: any duplicate-grain Create gets rejected
    /// by Dataverse on the unique index.
    /// </summary>
    public class LOANameSetter : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.FundingLine ||
                context.MessageName != "Create" ||
                context.Stage != 20) // PreOperation
            {
                tracing.Trace($"Skipping — Entity={context.PrimaryEntityName}, " +
                              $"Message={context.MessageName}, Stage={context.Stage}.");
                return;
            }

            var target = GetTarget(context);

            // Resolve grain from the LOA target itself: it carries the same lookups
            // a Funding Track does (OPR/Fund/BOC/DT/PG/SAG/MDEP). Build a synthetic
            // FT-shaped entity so we can reuse LOAResolver.
            var ftShape = new Entity(EntityNames.FundingTrack);
            CopyRef(target, FundingLineAttributes.DisbursingOfficial, ftShape, FundingTrackAttributes.DisbursingOfficial);
            CopyRef(target, FundingLineAttributes.Fund,               ftShape, FundingTrackAttributes.Fund);
            CopyRef(target, FundingLineAttributes.BOC,                ftShape, FundingTrackAttributes.BOC);
            CopyRef(target, FundingLineAttributes.DollarType,         ftShape, FundingTrackAttributes.DollarType);
            CopyRef(target, FundingLineAttributes.PG,                 ftShape, FundingTrackAttributes.PG);
            CopyRef(target, FundingLineAttributes.SAG,                ftShape, FundingTrackAttributes.SAG);
            CopyRef(target, FundingLineAttributes.MDEP,               ftShape, FundingTrackAttributes.MDEP);

            var grain = LOAResolver.Resolve(service, ftShape, tracing);
            if (grain == null)
            {
                // LOAResolver already traced the reason. Don't block the create —
                // the alt key won't reject an LOA with a null/blank name, but a
                // human can fix it after. PreOp validators would throw here if
                // we wanted a hard guard.
                tracing.Trace("Grain unresolved; leaving book_name unset.");
                return;
            }

            target[FundingLineAttributes.Name] = grain.CanonicalName;
            if (grain.FiscalYear != null)
                target[FundingLineAttributes.FiscalYear] = grain.FiscalYear;

            tracing.Trace($"LOA name set to '{grain.CanonicalName}' " +
                          $"(FY={grain.FiscalYear?.Value}, APPN={grain.Appropriation}).");
        }

        private static void CopyRef(Entity source, string sourceAttr, Entity dest, string destAttr)
        {
            var value = source.GetAttributeValue<EntityReference>(sourceAttr);
            if (value != null) dest[destAttr] = value;
        }
    }
}
