using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Items
{
    /// <summary>
    /// When a Prioritization gains an active Itemized Detail, force its Fund
    /// Center to the state-level FC (the FC whose parent is the distribution
    /// holding FC). Per-FC granularity then lives on the Itemized Details
    /// themselves (book_fundcenter, blank = state level), so the Prio-level FC
    /// carries no routing information beyond the state — and distributions
    /// already resolve Prio FCs up to state, so this write never changes a
    /// distribution destination. PrioritizationFundCenterLockGuard blocks user
    /// edits while the lock is engaged; removing the last Itemized Detail
    /// releases the lock but the state FC value stays.
    ///
    /// Exemption: when the parent Requirement is centrally managed
    /// (book_national = 1) the Prio FC is owned by the Requirement
    /// (PrioritizationFundCenterBackfill / RequirementFundCenterCascade) and
    /// must NOT be forced to state level — this plugin skips those Prios
    /// entirely, and the lock guard does not lock them.
    /// </summary>
    /// <remarks>
    /// Register: PostOperation, Sync, book_itemizeddetails —
    ///   1. Create (no filter, no images).
    ///   2. Update, filter statecode, pre-image (name "PreImage"): book_prioritization
    ///      — covers reactivation, which re-engages the lock.
    /// No Delete/Deactivate step: losing the last Itemized Detail only releases
    /// the lock, the Prioritization keeps the state FC value.
    /// </remarks>
    public class PrioritizationItemizedFundCenterDefault : PluginBase
    {
        private const string HoldingFundCenterEnvVar = "book_DistributionHoldingFundCenter";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.ItemizedDetails)
                return;
            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            if (context.MessageName == "Update")
            {
                // Only a flip to Active re-engages the lock; other updates are noise.
                var newState = target.GetAttributeValue<OptionSetValue>(ItemizedDetailsAttributes.StateCode);
                if (newState == null || newState.Value != StateCodeValues.Active)
                {
                    tracing.Trace("Update did not activate the Itemized Detail; skipping.");
                    return;
                }
            }

            var prioRef = GetEffectiveEntityReference(target, preImage, ItemizedDetailsAttributes.Prioritization);
            if (prioRef == null)
            {
                tracing.Trace("Itemized Detail has no Prioritization; skipping.");
                return;
            }

            var prio = service.Retrieve(
                EntityNames.Prioritization,
                prioRef.Id,
                new ColumnSet(
                    PrioritizationAttributes.FundCenter,
                    PrioritizationAttributes.State,
                    PrioritizationAttributes.Requirement,
                    PrioritizationAttributes.RequirementFunding));

            if (StateFundCenterResolver.HasCentrallyManagedRequirement(service, tracing, prio))
            {
                tracing.Trace(
                    $"Prio {prioRef.Id} belongs to a centrally managed Requirement; " +
                    "FC stays Requirement-owned, not forced to state level.");
                return;
            }

            var currentFc = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.FundCenter);
            var state = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);

            var holdingFcId = EnvironmentVariableHelper.GetGuid(service, HoldingFundCenterEnvVar);
            var fcCache = new Dictionary<Guid, FundCenterMeta>();

            var stateFcId = StateFundCenterResolver.ResolveForPrio(
                service, fcCache, tracing, state, currentFc, holdingFcId);
            if (stateFcId == null)
            {
                tracing.Trace(
                    $"Could not resolve a state-level FC for Prio {prioRef.Id} " +
                    "(no state FC under the holding FC and no walkable current FC); leaving FC as-is.");
                return;
            }

            if (currentFc != null && currentFc.Id == stateFcId.Value)
            {
                tracing.Trace($"Prio {prioRef.Id} FC already at state level ({stateFcId}); nothing to do.");
                return;
            }

            var update = new Entity(EntityNames.Prioritization, prioRef.Id)
            {
                [PrioritizationAttributes.FundCenter] =
                    new EntityReference(EntityNames.FundCenter, stateFcId.Value),
            };
            service.Update(update);
            tracing.Trace(
                $"Prio {prioRef.Id} has Itemized Details; FC set to state level {stateFcId} " +
                $"(was {(currentFc == null ? "empty" : currentFc.Id.ToString())}).");
        }
    }
}
