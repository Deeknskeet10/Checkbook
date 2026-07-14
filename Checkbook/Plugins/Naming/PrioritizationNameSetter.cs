using System;
using System.Globalization;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Naming
{
    /// <summary>
    /// Stamps book_name on book_prioritization at PreOperation so the
    /// book_uniqueprioritizationname unique key (on book_name) catches
    /// duplicates inside the user's transaction. Replaces the async
    /// "Prioritization - Set Name" workflow.
    ///
    /// Register:
    ///   - Message=Create, Stage=PreOperation, Mode=Sync, Rank=30
    ///       (after PrioritizationFundCenterBackfill rank 10 and
    ///       RequirementDetailFundingGuard rank 20 — this plugin reads
    ///       book_fundcenter from the Target to build the name)
    ///   - Message=Update, Stage=PreOperation, Mode=Sync
    ///       FilteringAttributes: book_state, book_requirementfunding, book_requirement,
    ///                            book_statepriority, book_fundcenter, book_newfiscalyear
    ///       PreImage "PreImage": same attributes
    /// </summary>
    public class PrioritizationNameSetter : PluginBase
    {
        private const int FY25 = 2025;
        private const int FY26 = 2026;

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization) return;
            if (context.MessageName != "Create" && context.MessageName != "Update") return;
            if (context.Stage != 20) return; // PreOperation only

            var target = GetTarget(context);
            var preImage = context.MessageName == "Update" ? TryGetPreImage(context) : null;

            var fy = GetEffectiveOptionSetValue(target, preImage, PrioritizationAttributes.FiscalYear);
            if (fy == null)
            {
                tracing.Trace("No fiscal year set — skipping name stamp.");
                return;
            }

            var state = GetEffectiveEntityReference(target, preImage, PrioritizationAttributes.State);
            var fundCenter = GetEffectiveEntityReference(target, preImage, PrioritizationAttributes.FundCenter);
            var statePriority = GetEffectiveInt(target, preImage, PrioritizationAttributes.StatePriority);
            var reqFunding = GetEffectiveEntityReference(target, preImage, PrioritizationAttributes.RequirementFunding);
            var requirement = GetEffectiveEntityReference(target, preImage, PrioritizationAttributes.Requirement);

            // goal_fiscalyear picklist values ARE the year (e.g. value 2026 → "FY2026").
            var fyText = "FY" + fy.Value.ToString(CultureInfo.InvariantCulture);
            var stateName = ResolveName(service, state);
            var fcName = ResolveName(service, fundCenter);

            string name;
            if (fy.Value == FY25 || fy.Value == FY26)
            {
                // Branch A — FY25/26: FY{FY}-{State}-{FundCenter}-{StatePriority}-{RequirementFunding}
                var rfName = ResolveName(service, reqFunding);
                var priorityText = statePriority?.ToString(CultureInfo.InvariantCulture);
                name = Join(fyText, stateName, fcName, priorityText, rfName);
            }
            else
            {
                // Branch B — FY27+: FY{FY}-{State}-{FundCenter}-{Requirement}
                var reqName = ResolveName(service, requirement);
                name = Join(fyText, stateName, fcName, reqName);
            }

            tracing.Trace($"Computed book_name = '{name}'");
            target[PrioritizationAttributes.Name] = name;
        }

        private static string ResolveName(IOrganizationService service, EntityReference reference)
        {
            if (reference == null) return null;
            if (!string.IsNullOrEmpty(reference.Name)) return reference.Name;

            // Lookup attributes on a Create Target carry only the id, not Name.
            var record = service.Retrieve(
                reference.LogicalName, reference.Id, new ColumnSet("book_name"));
            return record.GetAttributeValue<string>("book_name");
        }

        private static string Join(params string[] parts)
        {
            // SelectFirstNonNull semantics: null/empty segments become empty strings,
            // matching the existing workflow's concatenation behavior.
            for (int i = 0; i < parts.Length; i++)
                if (parts[i] == null) parts[i] = string.Empty;
            return string.Join("-", parts);
        }
    }
}
