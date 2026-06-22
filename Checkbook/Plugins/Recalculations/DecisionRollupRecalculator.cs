using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Microsoft.Crm.Sdk.Messages;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation handler that keeps Funding Track roll-up totals and the
    /// associated LOA's TDP / Remaining current whenever a Decision is
    /// created/updated/deleted or reassigned between tracks. Two-hop:
    /// Decision → FundingTrack → LOA.
    ///
    /// Per affected Funding Track:
    ///   1. Force the FT's <see cref="FundingTrackAttributes.DecisionTotal"/>
    ///      roll-up to recalc immediately via <see cref="CalculateRollupFieldRequest"/>
    ///      (avoids waiting for the async roll-up system job).
    ///   2. Resolve the FT's LOA and add it to the batch for
    ///      <see cref="LOATouchPropagator"/>'s final
    ///      <c>BatchRecalculateLOATDP</c> pass.
    /// </summary>
    public sealed class DecisionRollupRecalculator : LOATouchPropagator
    {
        protected override string EntityName => EntityNames.Decision;

        protected override void CollectAffectedLOAs(
            IOrganizationService service,
            ITracingService tracing,
            IPluginExecutionContext context,
            Entity target,
            Entity preImage,
            HashSet<Guid> loaIds)
        {
            var trackIds = new HashSet<Guid>();
            AddTrackFrom(target, trackIds);
            AddTrackFrom(preImage, trackIds);

            if (trackIds.Count == 0 && context.MessageName == "Update")
            {
                var current = service.Retrieve(
                    EntityName, context.PrimaryEntityId,
                    new ColumnSet(DecisionAttributes.FundingTrack));
                AddTrackFrom(current, trackIds);
                tracing.Trace("Resolved Funding Track from DB fallback.");
            }

            foreach (var trackId in trackIds)
            {
                var rollupReq = new CalculateRollupFieldRequest
                {
                    Target = new EntityReference(EntityNames.FundingTrack, trackId),
                    FieldName = FundingTrackAttributes.DecisionTotal,
                };
                service.Execute(rollupReq);
                tracing.Trace($"Recalculated DecisionTotal roll-up for Funding Track {trackId}.");

                var track = service.Retrieve(
                    EntityNames.FundingTrack, trackId,
                    new ColumnSet(FundingTrackAttributes.LineOfAccounting));
                AddLoaFrom(track, FundingTrackAttributes.LineOfAccounting, loaIds);
            }
        }

        private static void AddTrackFrom(Entity entity, HashSet<Guid> trackIds)
        {
            if (entity == null) return;
            var track = entity.GetAttributeValue<EntityReference>(DecisionAttributes.FundingTrack);
            if (track != null) trackIds.Add(track.Id);
        }
    }
}
