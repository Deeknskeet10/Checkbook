using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.LOAs.Helpers;

namespace Checkbook.Plugins.LOAs
{
    /// <summary>
    /// Pre-Operation Create + Update plugin on <c>book_fundingline</c>. Owns the
    /// roles previously handled by the <c>LineofAccounting-Initialization</c>
    /// XAML workflow (which is retired):
    ///
    /// • <b>Create</b>: writes <c>book_name</c>, copies <c>book_fiscalyear</c>
    ///   from the Fund, and inherits <c>owningbusinessunit</c> from the
    ///   Disbursing Official's BU.
    /// • <b>Update</b>: when a grain field (OPR/Fund/BOC/DT/PG/SAG/MDEP) changes,
    ///   re-resolves and rewrites <c>book_name</c> + <c>book_fiscalyear</c>.
    ///   BU is intentionally left alone on Update — owningbusinessunit is not a
    ///   directly-updatable field; reassigning the LOA owner is the proper path.
    ///
    /// Runs on every LOA write (FT pipeline, admin form, bulk API), so the
    /// naming + BU rules apply uniformly. Combined with the alternate key on
    /// <c>book_name</c>, this is the sole uniqueness guard for FY27+ LOAs:
    /// any duplicate-grain Create OR rename Update gets rejected by Dataverse
    /// on the unique index.
    ///
    /// Update step must register a PreImage named "PreImage" containing all
    /// seven grain fields plus <c>book_name</c>/<c>book_fiscalyear</c>.
    /// </summary>
    public class LOANameSetter : PluginBase
    {
        private static readonly string[] GrainFields = new[]
        {
            FundingLineAttributes.DisbursingOfficial,
            FundingLineAttributes.Fund,
            FundingLineAttributes.BOC,
            FundingLineAttributes.DollarType,
            FundingLineAttributes.PG,
            FundingLineAttributes.SAG,
            FundingLineAttributes.MDEP,
        };

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.FundingLine ||
                context.Stage != 20 || // PreOperation
                (context.MessageName != "Create" && context.MessageName != "Update"))
            {
                tracing.Trace($"Skipping — Entity={context.PrimaryEntityName}, " +
                              $"Message={context.MessageName}, Stage={context.Stage}.");
                return;
            }

            var target = GetTarget(context);
            var isUpdate = context.MessageName == "Update";

            Entity preImage = null;
            if (isUpdate)
            {
                preImage = TryGetPreImage(context);
                if (preImage == null)
                {
                    tracing.Trace("Update with no PreImage registered; cannot diff grain. Skipping.");
                    return;
                }
                if (!HasAnyAttributeChanged(target, GrainFields))
                {
                    tracing.Trace("No grain field changed; nothing to do.");
                    return;
                }
            }

            // Resolve grain from the effective LOA shape. For Update, merge target
            // over pre-image so the resolver sees every grain field; for Create the
            // target carries everything itself.
            var effective = isUpdate ? GetMergedEntity(target, preImage) : target;

            var ftShape = new Entity(EntityNames.FundingTrack);
            CopyRef(effective, FundingLineAttributes.DisbursingOfficial, ftShape, FundingTrackAttributes.DisbursingOfficial);
            CopyRef(effective, FundingLineAttributes.Fund,               ftShape, FundingTrackAttributes.Fund);
            CopyRef(effective, FundingLineAttributes.BOC,                ftShape, FundingTrackAttributes.BOC);
            CopyRef(effective, FundingLineAttributes.DollarType,         ftShape, FundingTrackAttributes.DollarType);
            CopyRef(effective, FundingLineAttributes.PG,                 ftShape, FundingTrackAttributes.PG);
            CopyRef(effective, FundingLineAttributes.SAG,                ftShape, FundingTrackAttributes.SAG);
            CopyRef(effective, FundingLineAttributes.MDEP,               ftShape, FundingTrackAttributes.MDEP);

            var grain = LOAResolver.Resolve(service, ftShape, tracing);
            if (grain == null)
            {
                // LOAResolver already traced the reason. Don't block the write —
                // the alt key won't reject an LOA with a null/blank name; a human
                // can fix it after. PreOp validators would throw here for a hard guard.
                tracing.Trace("Grain unresolved; leaving fields unchanged.");
                return;
            }

            target[FundingLineAttributes.Name] = grain.CanonicalName;
            if (grain.FiscalYear != null)
                target[FundingLineAttributes.FiscalYear] = grain.FiscalYear;

            tracing.Trace($"LOA name set to '{grain.CanonicalName}' " +
                          $"(FY={grain.FiscalYear?.Value}, APPN={grain.Appropriation}).");

            if (!isUpdate)
            {
                // Inherit owningbusinessunit from the Disbursing Official's BU so the
                // LOA lands in the state/USPFO BU that owns the OPR record. Overrides
                // whatever the caller (FT pipeline, form, bulk API) put on the target.
                // Create-only — see header for why Update doesn't touch BU.
                var oprBu = ResolveOprBusinessUnit(service, grain.OPR, tracing);
                if (oprBu != null)
                {
                    target["owningbusinessunit"] = oprBu;
                    tracing.Trace($"LOA BU set to {oprBu.Id} (inherited from OPR {grain.OPR.Id}).");
                }
            }
        }

        private static EntityReference ResolveOprBusinessUnit(
            IOrganizationService service,
            EntityReference opr,
            ITracingService tracing)
        {
            if (opr == null)
            {
                tracing.Trace("No Disbursing Official on target; leaving owningbusinessunit to Dataverse default.");
                return null;
            }
            var oprRecord = service.Retrieve(opr.LogicalName, opr.Id, new ColumnSet("owningbusinessunit"));
            var bu = oprRecord.GetAttributeValue<EntityReference>("owningbusinessunit");
            if (bu == null)
                tracing.Trace($"OPR {opr.Id} has no owningbusinessunit; leaving LOA BU unset.");
            return bu;
        }

        private static void CopyRef(Entity source, string sourceAttr, Entity dest, string destAttr)
        {
            var value = source.GetAttributeValue<EntityReference>(sourceAttr);
            if (value != null) dest[destAttr] = value;
        }
    }
}
