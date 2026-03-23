using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using ARNGCheckbook.Plugins.Constants;

namespace ARNGCheckbook.Plugins.BusinessLogic
{
    /// <summary>
    /// Plugin that initializes records with default values or computed fields
    /// on creation. This consolidates multiple initialization workflows into
    /// a single plugin.
    ///
    /// Supported entities:
    /// - RequirementFunding: Sets default field values
    /// - FundingLine (LOA): Initializes TDP fields to zero
    /// - Turn-in: Sets default approval status
    /// - Prioritization: Sets default approval status
    ///
    /// Registration:
    /// For each entity:
    /// - Message: Create, Stage: Pre-Operation (20)
    ///   No filtering attributes (runs on all creates)
    /// </summary>
    public class RecordInitializer : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            // Only handle Create message
            if (context.MessageName != "Create")
            {
                tracingService.Trace($"Skipping - message {context.MessageName} not handled");
                return;
            }

            var target = GetTarget(context);
            var entityName = context.PrimaryEntityName;

            tracingService.Trace($"Initializing {entityName} record");

            switch (entityName)
            {
                case EntityNames.RequirementFunding:
                    InitializeRequirementFunding(target, service, tracingService);
                    break;

                case EntityNames.FundingLine:
                    InitializeFundingLine(target, tracingService);
                    break;

                case EntityNames.Turnin:
                    InitializeTurnIn(target, tracingService);
                    break;

                case EntityNames.Prioritization:
                    InitializePrioritization(target, service, tracingService);
                    break;

                case EntityNames.SpendPlan:
                    InitializeSpendPlan(target, tracingService);
                    break;

                default:
                    tracingService.Trace($"Entity {entityName} not configured for initialization");
                    return;
            }

            tracingService.Trace($"{entityName} initialization complete");
        }

        /// <summary>
        /// Initializes RequirementFunding with default values.
        /// </summary>
        private void InitializeRequirementFunding(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            // Set default TDP to 0 if not provided
            if (!target.Contains(RequirementFundingAttributes.TDP))
            {
                target[RequirementFundingAttributes.TDP] = new Money(0m);
                tracingService.Trace("Set default TDP to 0");
            }

            // Set default FundedAmount to 0 if not provided
            if (!target.Contains(RequirementFundingAttributes.FundedAmount))
            {
                target[RequirementFundingAttributes.FundedAmount] = new Money(0m);
                tracingService.Trace("Set default FundedAmount to 0");
            }

            // Set default ValidatedAmount to 0 if not provided
            if (!target.Contains(RequirementFundingAttributes.ValidatedAmount))
            {
                target[RequirementFundingAttributes.ValidatedAmount] = new Money(0m);
                tracingService.Trace("Set default ValidatedAmount to 0");
            }

            // Set FundingValidated to false if not provided
            if (!target.Contains(RequirementFundingAttributes.FundingValidated))
            {
                target[RequirementFundingAttributes.FundingValidated] = false;
                tracingService.Trace("Set default FundingValidated to false");
            }
        }

        /// <summary>
        /// Initializes FundingLine (LOA) with default values.
        /// </summary>
        private void InitializeFundingLine(Entity target, ITracingService tracingService)
        {
            // Set default TDP to 0 if not provided
            if (!target.Contains(FundingLineAttributes.TDP))
            {
                target[FundingLineAttributes.TDP] = new Money(0m);
                tracingService.Trace("Set default TDP to 0");
            }

            // Set default TDPRemaining to match TDP (or 0)
            if (!target.Contains(FundingLineAttributes.TDPRemaining))
            {
                var tdp = target.GetAttributeValue<Money>(FundingLineAttributes.TDP);
                target[FundingLineAttributes.TDPRemaining] = tdp ?? new Money(0m);
                tracingService.Trace($"Set default TDPRemaining to {tdp?.Value ?? 0}");
            }
        }

        /// <summary>
        /// Initializes Turn-in with default values.
        /// </summary>
        private void InitializeTurnIn(Entity target, ITracingService tracingService)
        {
            // Set default Amount to 0 if not provided
            if (!target.Contains(TurninAttributes.Amount))
            {
                target[TurninAttributes.Amount] = new Money(0m);
                tracingService.Trace("Set default Amount to 0");
            }

            // Set default IdentifiedTurnInAmount to match Amount if not provided
            if (!target.Contains(TurninAttributes.IdentifiedTurnInAmount))
            {
                var amount = target.GetAttributeValue<Money>(TurninAttributes.Amount);
                target[TurninAttributes.IdentifiedTurnInAmount] = amount ?? new Money(0m);
                tracingService.Trace("Set default IdentifiedTurnInAmount");
            }

            // Set default approval flags
            if (!target.Contains(TurninAttributes.StateApproved))
            {
                target[TurninAttributes.StateApproved] = false;
                tracingService.Trace("Set default StateApproved to false");
            }

            if (!target.Contains(TurninAttributes.BEApproved))
            {
                target[TurninAttributes.BEApproved] = false;
                tracingService.Trace("Set default BEApproved to false");
            }
        }

        /// <summary>
        /// Initializes Prioritization with default values.
        /// </summary>
        private void InitializePrioritization(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            // Set default approval status to StateInput (0)
            if (!target.Contains(PrioritizationAttributes.ApprovalStatus))
            {
                target[PrioritizationAttributes.ApprovalStatus] = new OptionSetValue(ApprovalStatusValues.StateInput);
                tracingService.Trace("Set default ApprovalStatus to StateInput");
            }

            // Set default amounts to 0
            if (!target.Contains(PrioritizationAttributes.FundedAmountTDP))
            {
                target[PrioritizationAttributes.FundedAmountTDP] = new Money(0m);
                tracingService.Trace("Set default FundedAmountTDP to 0");
            }

            if (!target.Contains(PrioritizationAttributes.RequestedAmount))
            {
                target[PrioritizationAttributes.RequestedAmount] = new Money(0m);
                tracingService.Trace("Set default RequestedAmount to 0");
            }

            // Set flags
            if (!target.Contains(PrioritizationAttributes.SpendPlanGenerated))
            {
                target[PrioritizationAttributes.SpendPlanGenerated] = false;
                tracingService.Trace("Set default SpendPlanGenerated to false");
            }

            if (!target.Contains(PrioritizationAttributes.UFRGenerated))
            {
                target[PrioritizationAttributes.UFRGenerated] = false;
                tracingService.Trace("Set default UFRGenerated to false");
            }

            // Auto-populate State from RequirementFunding if not set
            if (!target.Contains(PrioritizationAttributes.State))
            {
                var rfRef = target.GetAttributeValue<EntityReference>(PrioritizationAttributes.RequirementFunding);
                if (rfRef != null)
                {
                    var stateRef = GetStateFromRequirementFunding(service, rfRef.Id);
                    if (stateRef != null)
                    {
                        target[PrioritizationAttributes.State] = stateRef;
                        tracingService.Trace($"Auto-populated State from RequirementFunding: {stateRef.Id}");
                    }
                }
            }
        }

        /// <summary>
        /// Initializes SpendPlan with default values.
        /// </summary>
        private void InitializeSpendPlan(Entity target, ITracingService tracingService)
        {
            // Set default Total to 0 if not provided
            if (!target.Contains(SpendPlanAttributes.Total))
            {
                target[SpendPlanAttributes.Total] = new Money(0m);
                tracingService.Trace("Set default Total to 0");
            }

            // Set all monthly fields to 0 if not provided
            var monthFields = new[]
            {
                SpendPlanAttributes.January, SpendPlanAttributes.February, SpendPlanAttributes.March,
                SpendPlanAttributes.April, SpendPlanAttributes.May, SpendPlanAttributes.June,
                SpendPlanAttributes.July, SpendPlanAttributes.August, SpendPlanAttributes.September,
                SpendPlanAttributes.October, SpendPlanAttributes.November, SpendPlanAttributes.December
            };

            foreach (var field in monthFields)
            {
                if (!target.Contains(field))
                {
                    target[field] = new Money(0m);
                }
            }
            tracingService.Trace("Set default monthly amounts to 0");

            // Set SpendPlanTotal to 0 if not provided
            if (!target.Contains(SpendPlanAttributes.SpendPlanTotal))
            {
                target[SpendPlanAttributes.SpendPlanTotal] = new Money(0m);
                tracingService.Trace("Set default SpendPlanTotal to 0");
            }
        }

        /// <summary>
        /// Gets the State reference from a RequirementFunding record.
        /// </summary>
        private EntityReference GetStateFromRequirementFunding(IOrganizationService service, Guid rfId)
        {
            try
            {
                // RequirementFunding links to FundCenter, which links to State
                var rf = service.Retrieve(EntityNames.RequirementFunding, rfId,
                    new ColumnSet(RequirementFundingAttributes.FundCenter));

                var fcRef = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.FundCenter);
                if (fcRef == null)
                    return null;

                // Get State from FundCenter
                var fc = service.Retrieve(EntityNames.FundCenter, fcRef.Id, new ColumnSet("book_state"));
                return fc.GetAttributeValue<EntityReference>("book_state");
            }
            catch
            {
                return null;
            }
        }
    }
}
