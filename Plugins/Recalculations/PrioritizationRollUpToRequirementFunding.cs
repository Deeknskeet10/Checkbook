using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    public class PrioritizationRollupToRequirementFunding : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization)
                return;

            if (context.MessageName != "Create" &&
                context.MessageName != "Update" &&
                context.MessageName != "Delete")
                return;

            if (context.Depth > 1)
                return;

            // For Delete, use pre-image
            Entity preImage = null;
            Entity target = null;

            if (context.MessageName == "Delete")
            {
                preImage = TryGetPreImage(context);
                target = preImage;
            }
            else
            {
                target = GetTarget(context);

                if (context.MessageName == "Update")
                    preImage = TryGetPreImage(context);
            }

            var parentRF = target.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.RequirementFunding
            ) ?? preImage?.GetAttributeValue<EntityReference>(PrioritizationAttributes.RequirementFunding);

            if (parentRF == null)
            {
                tracing.Trace("No parent RF — nothing to roll up.");
                return;
            }

            tracing.Trace($"Rolling up Prioritizations for RF {parentRF.Id}");

            // ---- EXECUTE THE SAME FETCH THE WORKFLOW USED ----
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.Prioritization}'>
                        <attribute name='{PrioritizationAttributes.FundedAmountTDP}' alias='total_funded' aggregate='sum'/>
                        <attribute name='{PrioritizationAttributes.ValidatedAmount}' alias='total_validated' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{PrioritizationAttributes.ApprovalStatus}' operator='eq' value='4'/>
                            <condition attribute='{PrioritizationAttributes.StateCode}' operator='eq' value='0'/>
                        </filter>
                        <link-entity name='{EntityNames.RequirementFunding}' from='{RequirementFundingAttributes.Id}'
                                     to='{PrioritizationAttributes.RequirementFunding}' link-type='inner'>
                            <filter>
                                <condition attribute='{RequirementFundingAttributes.Id}' operator='eq' value='{parentRF.Id}'/>
                            </filter>
                        </link-entity>
                    </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));

            decimal fundedTotal = 0m;
            decimal validatedTotal = 0m;

            if (result.Entities.Count > 0)
            {
                var f = result.Entities[0].GetAttributeValue<AliasedValue>("total_funded");
                var v = result.Entities[0].GetAttributeValue<AliasedValue>("total_validated");

                fundedTotal = f != null ? Convert.ToDecimal(f.Value) : 0m;
                validatedTotal = v != null ? Convert.ToDecimal(v.Value) : 0m;
            }

            tracing.Trace($"Calculated RF totals: Funded={fundedTotal}, Validated={validatedTotal}");

            // ---- UPDATE REQUIREMENT FUNDING ----
            var update = new Entity(EntityNames.RequirementFunding, parentRF.Id);
            update[RequirementFundingAttributes.FundedAmount] = fundedTotal;
            update[RequirementFundingAttributes.ValidatedAmount] = validatedTotal;

            service.Update(update);

            tracing.Trace("Requirement Funding roll-up updated successfully.");
        }
    }
}