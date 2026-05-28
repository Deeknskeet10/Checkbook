using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.Base;
using Microsoft.Xrm.Sdk.Query;

namespace Checkbook.Plugins.Validation
{
    public class RequirementFundingTDPValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            // Only run for RF
            if (context.PrimaryEntityName != EntityNames.RequirementFunding)
            {
                tracingService.Trace("Skipping — not RequirementFunding.");
                return;
            }

            if (context.MessageName != "Create" && context.MessageName != "Update")
            {
                tracingService.Trace($"Skipping — message {context.MessageName} not supported.");
                return;
            }

            var target = GetTarget(context);

            Entity preImage = null;
            bool isUpdate = context.MessageName == "Update";

            if (isUpdate)
            {
                preImage = TryGetPreImage(context);
                if (preImage == null)
                    tracingService.Trace("Warning: Pre-image missing.");
            }

            // ---------------------------------------------------------------
            // Skip LOA TDP validation when triggered by realignment 
            // (recursive parent walk — guaranteed to detect realignment)
            // ---------------------------------------------------------------
            if (IsTriggeredByRealignment(context))
            {
                tracingService.Trace("Skipping LOA validation — RF update triggered by RealignmentProcessor (ancestor context detected).");
                return;
            }


            // Get effective values (target override > preimage)
            var tdp = GetEffectiveDecimal(target, preImage, RequirementFundingAttributes.TDP);
            var fundedAmount = GetEffectiveDecimal(target, preImage, RequirementFundingAttributes.FundedAmount);
            var loaRef = GetEffectiveEntityReference(target, preImage, RequirementFundingAttributes.LineOfAccounting);

            tracingService.Trace($"RF Effective Values: TDP={tdp}, Funded={fundedAmount}, LOA={loaRef?.Id}");

            // Basic negative checks
            if (tdp < 0)
                throw new InvalidPluginExecutionException(ValidationMessages.NegativeTDP(tdp));

            if (fundedAmount < 0)
                throw new InvalidPluginExecutionException(ValidationMessages.NegativeFundedAmount(fundedAmount));

            // Funded must never exceed TDP
            if (fundedAmount > tdp)
            {
                var check = TDPCalculationHelper.ValidateFundedAmountVsTDP(fundedAmount, tdp);
                if (!check.IsValid)
                    throw new InvalidPluginExecutionException(check.ErrorMessage);
            }

            // ---------------------------------------------------------------
            // IMPORTANT FIX: Determine whether we actually need to validate LOA TDP
            // ---------------------------------------------------------------

            bool tdpChanged = target.Contains(RequirementFundingAttributes.TDP);
            bool fundedChanged = target.Contains(RequirementFundingAttributes.FundedAmount);

            // Determine if this RF has children
            bool hasChildren = RequirementFundingHasChildren(service, context.PrimaryEntityId);
            tracingService.Trace($"RF Has Children: {hasChildren}");

            /* 
             * RULE:
             * Validate LOA allocation *only if*:
             *    - TDP changed (this affects LOA allocation)
             * OR - FundedAmount changed AND RF has no children (manual RF)
             *
             * DO NOT validate LOA allocation when:
             *    - Only child Prioritization totals changed (roll-up).
             *    - FundedAmount changed due to roll-up.
             *    - Realignment net-zero distribution happens within the same LOA.
             */

            bool shouldValidateLOA =
                tdpChanged ||
                (fundedChanged && !hasChildren);

            if (!shouldValidateLOA)
            {
                tracingService.Trace("Skipping LOA TDP validation — No meaningful TDP-impacting changes detected.");
                return;
            }

            // ---------------------------------------------------------------
            // Now do LOA validation (only when needed)
            // ---------------------------------------------------------------
            if (tdp > 0)
            {
                if (loaRef == null)
                {
                    tracingService.Trace("Validation failed: RF has TDP but no LOA.");
                    throw new InvalidPluginExecutionException(ValidationMessages.TDPRequiresLOA);
                }

                Guid? excludeId = isUpdate ? context.PrimaryEntityId : (Guid?)null;

                var result = TDPCalculationHelper.ValidateTDPAllocation(
                    service,
                    loaRef.Id,
                    tdp,
                    excludeId
                );

                if (!result.IsValid)
                {
                    tracingService.Trace($"LOA validation failed: {result.ErrorMessage}");
                    throw new InvalidPluginExecutionException(result.ErrorMessage);
                }
            }

            tracingService.Trace("RF TDP validation complete — OK.");
        }

        private bool IsTriggeredByRealignment(IPluginExecutionContext ctx)
        {
            while (ctx != null)
            {
                if (ctx.PrimaryEntityName == EntityNames.Realignments &&
                    ctx.MessageName == "Update")
                {
                    return true;
                }

                ctx = ctx.ParentContext;
            }

            return false;
        }
        // Same helper logic used in your realignment plugin
        private bool RequirementFundingHasChildren(IOrganizationService service, Guid rfId)
        {
            var qe = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet(false),
                Criteria = new FilterExpression(LogicalOperator.And)
            };

            qe.Criteria.AddCondition(PrioritizationAttributes.RequirementFunding, ConditionOperator.Equal, rfId);
            qe.Criteria.AddCondition(PrioritizationAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var result = service.RetrieveMultiple(qe);

            return result.Entities != null && result.Entities.Count > 0;
        }
    }
}