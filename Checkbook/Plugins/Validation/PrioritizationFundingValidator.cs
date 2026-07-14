using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    public class PrioritizationFundingValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization)
                return;

            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            var target = GetTarget(context);

            // Pre-image for Update
            Entity preImage = null;
            if (context.MessageName == "Update")
                preImage = TryGetPreImage(context);

            // Pull Prioritization values
            var newFunded = GetEffectiveDecimal(
                target, preImage, PrioritizationAttributes.FundedAmountTDP
            );

            var parentRF = GetEffectiveEntityReference(
                target, preImage, PrioritizationAttributes.RequirementFunding
            );

            if (parentRF == null)
            {
                tracing.Trace("No parent Requirement Funding found — skipping validation.");
                return;
            }

            tracing.Trace($"Validating Prioritization change under RF {parentRF.Id}");

            // Retrieve parent Requirement Funding
            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                parentRF.Id,
                new ColumnSet(
                    RequirementFundingAttributes.TDP,
                    RequirementFundingAttributes.LineOfAccounting
                )
            );

            var rfTDP = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;

            var loaRef = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
            if (loaRef == null)
            {
                throw new InvalidPluginExecutionException(
                    "Parent Requirement Funding has no Line of Accounting assigned."
                );
            }

            tracing.Trace($"RF TDP = {rfTDP}");

            // ---- 1. Calculate sibling totals (APPROVED + ACTIVE only) ----
            var fetch = $@"
                <fetch aggregate='true'>
                  <entity name='{EntityNames.Prioritization}'>
                    <attribute name='{PrioritizationAttributes.FundedAmountTDP}' alias='total_funded' aggregate='sum'/>
                    <filter type='and'>
                        <condition attribute='{PrioritizationAttributes.ApprovalStatus}' operator='eq' value='{ApprovalStatusValues.FinalApproved}'/>
                        <condition attribute='{PrioritizationAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
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

            var siblingFundedSum = result.Entities.Count > 0
                ? AliasedValueHelper.GetDecimal(result.Entities[0], "total_funded")
                : 0m;

            tracing.Trace($"Sibling funded total: {siblingFundedSum}");

            // ---- 2. Compute proposed total (include new change) ----
            // NOTE: Fetch includes the current record for Update, so subtract old value.
            decimal oldFunded = preImage?.GetAttributeValue<decimal?>(PrioritizationAttributes.FundedAmountTDP) ?? 0m;

            var proposedTotal = siblingFundedSum - oldFunded + newFunded;

            tracing.Trace($"Proposed total after change: {proposedTotal}");

            // ---- 3. Enforce RF TDP cap ----
            if (proposedTotal > rfTDP)
            {
                throw new InvalidPluginExecutionException(
                    $"This update would exceed the Requirement Funding’s TDP cap. " +
                    $"RF TDP = {rfTDP:N2}, Proposed total = {proposedTotal:N2}."
                );
            }

            // ---- 4. Validate against LOA TDP remaining ----
            var validate = TDPCalculationHelper.ValidateTDPAllocation(
                service, loaRef.Id, proposedTotal, parentRF.Id
            );

            if (!validate.IsValid)
            {
                throw new InvalidPluginExecutionException(validate.ErrorMessage);
            }

            tracing.Trace("Prioritization validation passed.");
        }
    }
}