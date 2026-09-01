using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// When a Requirement Funding's LOA (book_lineofaccounting) changes, push the
    /// new LOA onto the stamped book_lineofaccounting of its Prioritization
    /// Funding rows so the state rollup keeps reaching the right Fund/SAG. Gated
    /// to the active planning FY and forward — a prior-FY RF is frozen and its
    /// PFs are left untouched. The downstream PF update re-triggers
    /// SpendPlanStateRollup, so bucket funded amounts follow the move.
    /// </summary>
    /// <remarks>
    /// Register: PostOperation, Sync, book_requirementfunding, Update.
    /// Filter attr: book_lineofaccounting.
    /// Pre-image "PreImage": book_lineofaccounting, book_newfiscalyear.
    /// </remarks>
    public class RequirementFundingLoaCascade : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.RequirementFunding)
                return;
            if (context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            if (!HasAttributeChanged(target, RequirementFundingAttributes.LineOfAccounting))
            {
                tracing.Trace("RF LOA unchanged; no PF cascade.");
                return;
            }

            var fy = GetEffectiveInt(target, preImage, RequirementFundingAttributes.FiscalYear);
            var activeFy = FiscalYearHelper.GetActivePlanningFiscalYear(service, tracing);
            if (fy != null && fy.Value < activeFy)
            {
                tracing.Trace($"RF FY {fy} is below active FY {activeFy}; frozen — no cascade.");
                return;
            }

            var newLoa = target.GetAttributeValue<EntityReference>(
                RequirementFundingAttributes.LineOfAccounting);

            var pfs = QueryActivePfs(service, target.Id);
            tracing.Trace(
                $"Cascading LOA={(newLoa == null ? "null" : newLoa.Id.ToString())} to " +
                $"{pfs.Entities.Count} PF(s).");

            foreach (var pf in pfs.Entities)
            {
                var currentLoa = pf.GetAttributeValue<EntityReference>(
                    PrioritizationFundingAttributes.LineOfAccounting);
                if (SameRef(currentLoa, newLoa))
                    continue;

                service.Update(new Entity(EntityNames.PrioritizationFunding, pf.Id)
                {
                    [PrioritizationFundingAttributes.LineOfAccounting] = newLoa,
                });
            }
        }

        private static EntityCollection QueryActivePfs(IOrganizationService service, System.Guid rfId)
        {
            var query = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(PrioritizationFundingAttributes.LineOfAccounting),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationFundingAttributes.RequirementFunding,
                            ConditionOperator.Equal, rfId),
                        new ConditionExpression(
                            PrioritizationFundingAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return service.RetrieveMultiple(query);
        }

        private static bool SameRef(EntityReference a, EntityReference b)
        {
            if (a == null && b == null) return true;
            if (a == null || b == null) return false;
            return a.Id == b.Id;
        }
    }
}
