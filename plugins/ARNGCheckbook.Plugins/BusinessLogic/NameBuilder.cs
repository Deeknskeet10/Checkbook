using System;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using ARNGCheckbook.Plugins.Constants;

namespace ARNGCheckbook.Plugins.BusinessLogic
{
    /// <summary>
    /// Plugin that automatically generates the Name field for various entities
    /// based on configured rules. This replaces 8 XAML workflows that perform
    /// simple name concatenation.
    ///
    /// Supported entities and naming patterns:
    /// - Fund: Name + " - " + BOC.Name + " - " + DollarType.Name
    /// - LOEFocusArea: LOE + " - " + FocusArea
    /// - FundingTrack: [Configured pattern]
    /// - Distributions: [Configured pattern]
    /// - LINRequests: [Configured pattern]
    /// - Realignments: [Configured pattern]
    /// - RequirementFunding: [Configured pattern]
    /// - Prioritization: [Configured pattern]
    ///
    /// Registration:
    /// - Message: Create, Stage: Pre-Operation (20)
    /// - Register on each supported entity
    /// </summary>
    public class NameBuilder : PluginBase
    {
        private const int MaxNameLength = 450; // Safe limit for primary name fields

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            // Only handle Create message in pre-operation
            if (context.MessageName != "Create")
            {
                tracingService.Trace($"Skipping - message {context.MessageName} not handled");
                return;
            }

            var target = GetTarget(context);
            var entityName = context.PrimaryEntityName;

            tracingService.Trace($"Building name for entity: {entityName}");

            string generatedName;
            try
            {
                switch (entityName)
                {
                    case EntityNames.Fund:
                        generatedName = BuildFundName(target, service, tracingService);
                        break;

                    case EntityNames.LOEFocusArea:
                        generatedName = BuildLOEFocusAreaName(target, tracingService);
                        break;

                    case EntityNames.FundingTrack:
                        generatedName = BuildFundingTrackName(target, service, tracingService);
                        break;

                    case EntityNames.Distributions:
                        generatedName = BuildDistributionName(target, service, tracingService);
                        break;

                    case EntityNames.LINRequests:
                        generatedName = BuildLINRequestName(target, service, tracingService);
                        break;

                    case EntityNames.Realignments:
                        generatedName = BuildRealignmentName(target, service, tracingService);
                        break;

                    case EntityNames.RequirementFunding:
                        generatedName = BuildRequirementFundingName(target, service, tracingService);
                        break;

                    case EntityNames.Prioritization:
                        generatedName = BuildPrioritizationName(target, service, tracingService);
                        break;

                    default:
                        tracingService.Trace($"Entity {entityName} not configured for name building");
                        return;
                }
            }
            catch (Exception ex)
            {
                tracingService.Trace($"Error building name: {ex.Message}");
                // Don't fail the operation, just skip name generation
                return;
            }

            if (!string.IsNullOrWhiteSpace(generatedName))
            {
                // Truncate if needed
                if (generatedName.Length > MaxNameLength)
                {
                    generatedName = generatedName.Substring(0, MaxNameLength);
                    tracingService.Trace($"Name truncated to {MaxNameLength} characters");
                }

                // Set the name on the target (will be saved with the record)
                target["book_name"] = generatedName;
                tracingService.Trace($"Generated name: {generatedName}");
            }
        }

        /// <summary>
        /// Builds name for Fund entity: Name + " - " + BOC + " - " + DollarType
        /// </summary>
        private string BuildFundName(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            var sb = new StringBuilder();

            // Get Fund Name
            var fundName = target.GetAttributeValue<string>(FundAttributes.Name);
            if (!string.IsNullOrWhiteSpace(fundName))
            {
                sb.Append(fundName);
            }

            // Get BOC reference and retrieve name
            var bocRef = target.GetAttributeValue<EntityReference>(FundAttributes.BOC);
            if (bocRef != null)
            {
                var bocName = GetEntityName(service, bocRef);
                if (!string.IsNullOrWhiteSpace(bocName))
                {
                    if (sb.Length > 0) sb.Append(" - ");
                    sb.Append(bocName);
                }
            }

            // Get Dollar Type reference and retrieve name
            var dollarTypeRef = target.GetAttributeValue<EntityReference>(FundAttributes.DollarType);
            if (dollarTypeRef != null)
            {
                var dollarTypeName = GetEntityName(service, dollarTypeRef);
                if (!string.IsNullOrWhiteSpace(dollarTypeName))
                {
                    if (sb.Length > 0) sb.Append(" - ");
                    sb.Append(dollarTypeName);
                }
            }

            return sb.ToString();
        }

        /// <summary>
        /// Builds name for LOEFocusArea entity: LOE + " - " + FocusArea
        /// </summary>
        private string BuildLOEFocusAreaName(Entity target, ITracingService tracingService)
        {
            var loe = target.GetAttributeValue<string>(LOEFocusAreaAttributes.LOE);
            var focusArea = target.GetAttributeValue<string>(LOEFocusAreaAttributes.FocusArea);

            if (!string.IsNullOrWhiteSpace(loe) && !string.IsNullOrWhiteSpace(focusArea))
            {
                return $"{loe} - {focusArea}";
            }
            else if (!string.IsNullOrWhiteSpace(loe))
            {
                return loe;
            }
            else if (!string.IsNullOrWhiteSpace(focusArea))
            {
                return focusArea;
            }

            return null;
        }

        /// <summary>
        /// Builds name for FundingTrack entity
        /// </summary>
        private string BuildFundingTrackName(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            var sb = new StringBuilder();

            // Get LOA reference and name
            var loaRef = target.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);
            if (loaRef != null)
            {
                var loaName = GetEntityName(service, loaRef);
                if (!string.IsNullOrWhiteSpace(loaName))
                {
                    sb.Append(loaName);
                }
            }

            // Add resource amount if present
            var resourceAmount = target.GetAttributeValue<Money>(FundingTrackAttributes.ResourceAmount);
            if (resourceAmount != null)
            {
                if (sb.Length > 0) sb.Append(" - ");
                sb.Append(resourceAmount.Value.ToString("C0"));
            }

            return sb.Length > 0 ? sb.ToString() : null;
        }

        /// <summary>
        /// Builds name for Distribution entity
        /// </summary>
        private string BuildDistributionName(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            var parts = new StringBuilder();

            // Fund Center
            var fcRef = target.GetAttributeValue<EntityReference>(DistributionsAttributes.FundCenter);
            if (fcRef != null)
            {
                var fcName = GetEntityName(service, fcRef);
                if (!string.IsNullOrWhiteSpace(fcName))
                {
                    parts.Append(fcName);
                }
            }

            // Fund
            var fundRef = target.GetAttributeValue<EntityReference>(DistributionsAttributes.Fund);
            if (fundRef != null)
            {
                var fundName = GetEntityName(service, fundRef);
                if (!string.IsNullOrWhiteSpace(fundName))
                {
                    if (parts.Length > 0) parts.Append(" - ");
                    parts.Append(fundName);
                }
            }

            // Amount
            var amount = target.GetAttributeValue<double?>(DistributionsAttributes.Amount);
            if (amount.HasValue)
            {
                if (parts.Length > 0) parts.Append(" - ");
                parts.Append(amount.Value.ToString("C0"));
            }

            return parts.Length > 0 ? parts.ToString() : null;
        }

        /// <summary>
        /// Builds name for LINRequest entity
        /// </summary>
        private string BuildLINRequestName(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            var parts = new StringBuilder();

            // Prioritization reference
            var priRef = target.GetAttributeValue<EntityReference>(LINRequestsAttributes.Prioritization);
            if (priRef != null)
            {
                var priName = GetEntityName(service, priRef);
                if (!string.IsNullOrWhiteSpace(priName))
                {
                    parts.Append(priName);
                }
            }

            // LIN reference
            var linRef = target.GetAttributeValue<EntityReference>(LINRequestsAttributes.LIN);
            if (linRef != null)
            {
                var linName = GetEntityName(service, linRef);
                if (!string.IsNullOrWhiteSpace(linName))
                {
                    if (parts.Length > 0) parts.Append(" - ");
                    parts.Append(linName);
                }
            }

            return parts.Length > 0 ? parts.ToString() : null;
        }

        /// <summary>
        /// Builds name for Realignment entity
        /// </summary>
        private string BuildRealignmentName(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            var parts = new StringBuilder();

            // Debited LOA
            var debitedLOARef = target.GetAttributeValue<EntityReference>(RealignmentsAttributes.DebitedLOA);
            if (debitedLOARef != null)
            {
                var loaName = GetEntityName(service, debitedLOARef);
                if (!string.IsNullOrWhiteSpace(loaName))
                {
                    parts.Append("From: ");
                    parts.Append(loaName);
                }
            }

            // Credited LOA
            var creditedLOARef = target.GetAttributeValue<EntityReference>(RealignmentsAttributes.CreditedLOA);
            if (creditedLOARef != null)
            {
                var loaName = GetEntityName(service, creditedLOARef);
                if (!string.IsNullOrWhiteSpace(loaName))
                {
                    if (parts.Length > 0) parts.Append(" → ");
                    else parts.Append("To: ");
                    parts.Append(loaName);
                }
            }

            // Amount
            var amount = target.GetAttributeValue<Money>(RealignmentsAttributes.Amount);
            if (amount != null)
            {
                if (parts.Length > 0) parts.Append(" ");
                parts.Append($"({amount.Value:C0})");
            }

            return parts.Length > 0 ? parts.ToString() : null;
        }

        /// <summary>
        /// Builds name for RequirementFunding entity
        /// </summary>
        private string BuildRequirementFundingName(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            var parts = new StringBuilder();

            // Requirement reference
            var reqRef = target.GetAttributeValue<EntityReference>(RequirementFundingAttributes.Requirement);
            if (reqRef != null)
            {
                var reqName = GetEntityName(service, reqRef);
                if (!string.IsNullOrWhiteSpace(reqName))
                {
                    parts.Append(reqName);
                }
            }

            // LOA reference
            var loaRef = target.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
            if (loaRef != null)
            {
                var loaName = GetEntityName(service, loaRef);
                if (!string.IsNullOrWhiteSpace(loaName))
                {
                    if (parts.Length > 0) parts.Append(" - ");
                    parts.Append(loaName);
                }
            }

            return parts.Length > 0 ? parts.ToString() : null;
        }

        /// <summary>
        /// Builds name for Prioritization entity
        /// </summary>
        private string BuildPrioritizationName(Entity target, IOrganizationService service, ITracingService tracingService)
        {
            var parts = new StringBuilder();

            // State reference
            var stateRef = target.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);
            if (stateRef != null)
            {
                var stateName = GetEntityName(service, stateRef);
                if (!string.IsNullOrWhiteSpace(stateName))
                {
                    parts.Append(stateName);
                }
            }

            // Fiscal Year
            var fy = target.GetAttributeValue<string>(PrioritizationAttributes.FiscalYear);
            if (!string.IsNullOrWhiteSpace(fy))
            {
                if (parts.Length > 0) parts.Append(" - ");
                parts.Append("FY");
                parts.Append(fy);
            }

            // Priority
            var priority = target.GetAttributeValue<int?>(PrioritizationAttributes.StatePriority);
            if (priority.HasValue)
            {
                if (parts.Length > 0) parts.Append(" - ");
                parts.Append("Pri ");
                parts.Append(priority.Value);
            }

            // Requirement Funding reference (brief)
            var rfRef = target.GetAttributeValue<EntityReference>(PrioritizationAttributes.RequirementFunding);
            if (rfRef != null)
            {
                var rfName = GetEntityName(service, rfRef);
                if (!string.IsNullOrWhiteSpace(rfName))
                {
                    if (parts.Length > 0) parts.Append(" - ");
                    // Truncate if too long
                    if (rfName.Length > 50)
                        rfName = rfName.Substring(0, 47) + "...";
                    parts.Append(rfName);
                }
            }

            return parts.Length > 0 ? parts.ToString() : null;
        }

        /// <summary>
        /// Helper to retrieve the name of a related entity.
        /// </summary>
        private string GetEntityName(IOrganizationService service, EntityReference entityRef)
        {
            if (entityRef == null)
                return null;

            // If the name is already populated in the reference, use it
            if (!string.IsNullOrWhiteSpace(entityRef.Name))
                return entityRef.Name;

            // Otherwise, retrieve it
            try
            {
                // Most entities use "book_name" for custom entities or "name" for system entities
                var primaryNameAttribute = entityRef.LogicalName.StartsWith("book_") ? "book_name" : "name";
                var entity = service.Retrieve(entityRef.LogicalName, entityRef.Id, new ColumnSet(primaryNameAttribute));
                return entity.GetAttributeValue<string>(primaryNameAttribute);
            }
            catch
            {
                return entityRef.Id.ToString();
            }
        }
    }
}
