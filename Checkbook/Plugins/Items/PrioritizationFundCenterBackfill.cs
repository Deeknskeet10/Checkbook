using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// On Prioritization Create, if the linked Requirement is centrally managed
    /// (book_national = 1), authoritatively set Prio.book_fundcenter to the
    /// Requirement's own FC. The destination Fund Center for centrally managed
    /// work is identified on the Requirement; users do not pick it on the
    /// Prioritization. Maintenance of FC after creation (when the Requirement's
    /// FC or national flag changes) is handled by RequirementFundCenterCascade.
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, book_prioritization, Create (no filter).
    /// </remarks>
    public class PrioritizationFundCenterBackfill : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization)
                return;
            if (context.MessageName != "Create")
                return;
            if (context.Stage != 20)
            {
                tracing.Trace("Not pre-operation stage; skipping.");
                return;
            }

            var target = GetTarget(context);

            var rfRef = target.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding);
            if (rfRef == null)
            {
                tracing.Trace("No Requirement Funding on new Prioritization; skipping FC backfill.");
                return;
            }

            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                rfRef.Id,
                new ColumnSet(RequirementFundingAttributes.Requirement));

            var reqRef = rf.GetAttributeValue<EntityReference>(
                RequirementFundingAttributes.Requirement);
            if (reqRef == null)
            {
                tracing.Trace($"RF {rfRef.Id} has no Requirement; skipping FC backfill.");
                return;
            }

            var req = service.Retrieve(
                EntityNames.Requirements,
                reqRef.Id,
                new ColumnSet(
                    RequirementsAttributes.National,
                    RequirementsAttributes.FundCenter));

            var isNational = req.GetAttributeValue<bool>(RequirementsAttributes.National);
            if (!isNational)
            {
                tracing.Trace($"Requirement {reqRef.Id} is not centrally managed; leaving FC as-is.");
                return;
            }

            var reqFc = req.GetAttributeValue<EntityReference>(RequirementsAttributes.FundCenter);
            if (reqFc == null)
            {
                tracing.Trace(
                    $"Requirement {reqRef.Id} is centrally managed but has no FC set; cannot backfill.");
                return;
            }

            target[PrioritizationAttributes.FundCenter] = reqFc;
            tracing.Trace(
                $"Backfilled Prio FC = {reqFc.Id} from centrally managed Requirement {reqRef.Id}.");
        }
    }
}
