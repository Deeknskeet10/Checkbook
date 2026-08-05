using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// While a Prioritization has active Itemized Details its Fund Center is
    /// locked to the state-level FC (PrioritizationItemizedFundCenterDefault
    /// sets it). This guard blocks any Update that would move the FC anywhere
    /// else — the only accepted value is the resolved state-level FC itself,
    /// which is also what lets the default plugin and a user re-selecting the
    /// correct value through. When the last Itemized Detail is removed the
    /// guard stops matching and the field is editable again.
    ///
    /// Exemption: Prios under a centrally managed Requirement
    /// (book_national = 1) are never locked here — their FC is owned by the
    /// Requirement (PrioritizationFundCenterBackfill /
    /// RequirementFundCenterCascade), the itemized default plugin skips
    /// them, and blocking would reject the cascade's own FC write.
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, book_prioritization, Update.
    /// Filter attrs: book_fundcenter.
    /// Pre-image (name "PreImage"): book_fundcenter, book_state.
    /// </remarks>
    public class PrioritizationFundCenterLockGuard : PluginBase
    {
        private const string HoldingFundCenterEnvVar = "book_DistributionHoldingFundCenter";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization)
                return;
            if (context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            if (!HasAttributeChanged(target, PrioritizationAttributes.FundCenter))
                return;

            var preImage = TryGetPreImage(context);
            var newFc = target.GetAttributeValue<EntityReference>(PrioritizationAttributes.FundCenter);
            var oldFc = preImage?.GetAttributeValue<EntityReference>(PrioritizationAttributes.FundCenter);

            if (newFc != null && oldFc != null && newFc.Id == oldFc.Id)
            {
                tracing.Trace("FC unchanged; nothing to guard.");
                return;
            }

            if (!StateFundCenterResolver.HasActiveItemizedDetails(service, target.Id))
            {
                tracing.Trace("No active Itemized Details; FC is not locked.");
                return;
            }

            var prioLookups = service.Retrieve(
                EntityNames.Prioritization,
                target.Id,
                new ColumnSet(
                    PrioritizationAttributes.Requirement,
                    PrioritizationAttributes.RequirementFunding));
            if (StateFundCenterResolver.HasCentrallyManagedRequirement(service, tracing, prioLookups))
            {
                tracing.Trace(
                    "Prio belongs to a centrally managed Requirement; FC is Requirement-owned " +
                    "and not locked to state level.");
                return;
            }

            var state = preImage?.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);
            var holdingFcId = EnvironmentVariableHelper.GetGuid(service, HoldingFundCenterEnvVar);
            var fcCache = new Dictionary<Guid, FundCenterMeta>();

            var stateFcId = StateFundCenterResolver.ResolveForPrio(
                service, fcCache, tracing, state, oldFc, holdingFcId);
            if (stateFcId == null)
            {
                tracing.Trace(
                    "Lock engaged but no state-level FC could be resolved; allowing the write " +
                    "so the record does not become uneditable.");
                return;
            }

            if (newFc != null && newFc.Id == stateFcId.Value)
            {
                tracing.Trace($"Incoming FC is the state-level FC ({stateFcId}); allowed.");
                return;
            }

            throw new InvalidPluginExecutionException(
                "This Prioritization has Itemized Details, so its Fund Center is locked to the " +
                "state-level Fund Center. Set the Fund Center on the individual Itemized Details " +
                "instead, or remove all Itemized Details to edit this field.");
        }
    }
}
