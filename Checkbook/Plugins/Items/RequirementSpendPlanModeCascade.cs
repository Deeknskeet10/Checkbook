using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// When a Requirement's centrally-managed (book_national) or breakout
    /// (book_breakout) flag changes, re-stamp the spend-plan classification on
    /// its Prioritization Funding rows — but ONLY for the active planning FY and
    /// forward. Prior-FY PFs are the frozen record of what the mode was that
    /// year and are never loaded for write, so flipping a flag in FY29 can never
    /// rewrite FY27/FY28. Mirrors PrioritizationFundingSpendPlanStamp's derivation.
    /// </summary>
    /// <remarks>
    /// Register: PostOperation, Sync, book_requirements, Update.
    /// Filter attrs: book_national, book_breakout.
    /// Pre-image "PreImage": book_national, book_breakout.
    /// </remarks>
    public class RequirementSpendPlanModeCascade : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Requirements)
                return;
            if (context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            if (!HasAnyAttributeChanged(target,
                    RequirementsAttributes.National, RequirementsAttributes.Breakout))
            {
                tracing.Trace("Neither national nor breakout changed; no re-stamp.");
                return;
            }

            var national = GetEffectiveBool(target, preImage, RequirementsAttributes.National);
            var breakout = GetEffectiveBool(target, preImage, RequirementsAttributes.Breakout);
            var desiredMode = PrioritizationFundingSpendPlanStamp.ResolveMode(national, breakout);

            var activeFy = FiscalYearHelper.GetActivePlanningFiscalYear(service, tracing);

            var pfs = QueryActivePlanningFyPfs(service, target.Id, activeFy);
            tracing.Trace(
                $"Re-stamping mode={desiredMode}, CM={national} across {pfs.Entities.Count} " +
                $"PF(s) with FY >= {activeFy}.");

            foreach (var pf in pfs.Entities)
            {
                var currentMode = pf.GetAttributeValue<OptionSetValue>(
                    PrioritizationFundingAttributes.SpendPlanMode)?.Value;
                var currentCm = pf.GetAttributeValue<bool>(
                    PrioritizationFundingAttributes.CentrallyManaged);

                if (currentMode == desiredMode && currentCm == national)
                    continue;

                service.Update(new Entity(EntityNames.PrioritizationFunding, pf.Id)
                {
                    [PrioritizationFundingAttributes.CentrallyManaged] = national,
                    [PrioritizationFundingAttributes.SpendPlanMode] = new OptionSetValue(desiredMode),
                });
            }
        }

        /// <summary>
        /// Active PFs under this Requirement (PF → RF → RF.Requirement) whose FY
        /// (RF.book_newfiscalyear) is at or after the active planning FY.
        /// </summary>
        private static EntityCollection QueryActivePlanningFyPfs(
            IOrganizationService service, System.Guid requirementId, int activeFy)
        {
            var query = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(
                    PrioritizationFundingAttributes.SpendPlanMode,
                    PrioritizationFundingAttributes.CentrallyManaged),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationFundingAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rfLink = query.AddLink(
                EntityNames.RequirementFunding,
                PrioritizationFundingAttributes.RequirementFunding,
                RequirementFundingAttributes.Id,
                JoinOperator.Inner);
            rfLink.EntityAlias = "rf";
            rfLink.LinkCriteria.AddCondition(
                RequirementFundingAttributes.Requirement, ConditionOperator.Equal, requirementId);
            rfLink.LinkCriteria.AddCondition(
                RequirementFundingAttributes.FiscalYear, ConditionOperator.GreaterEqual, activeFy);

            return service.RetrieveMultiple(query);
        }
    }
}
