using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Microsoft.Crm.Sdk.Messages; // CalculateRollupFieldRequest
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation handler that ensures Funding Track roll-up totals and the LOA's TDP/Remaining
    /// are up-to-date whenever a Decision is created/updated/deleted or reassigned between tracks.
    ///
    /// Flow:
    /// - Determine affected Funding Track(s)
    /// - Force Decision Total roll-up to recalc via CalculateRollupFieldRequest
    /// - Find associated LOA(s) and call TDPCalculationHelper.RecalculateLOATDP to refresh TDP & Remaining
    /// </summary>
    public class DecisionRollupRecalculator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            // Only act on book_decision in Post-Operation
            if (context.PrimaryEntityName != EntityNames.Decision)
            {
                tracing.Trace($"Skipping - not a {EntityNames.Decision} record.");
                return;
            }

            if (context.Stage != 40 ||
               !(context.MessageName == "Create" ||
                 context.MessageName == "Update" ||
                 context.MessageName == "Delete"))
            {
                tracing.Trace($"Skipping - Stage {context.Stage}, Message {context.MessageName} not handled.");
                return;
            }

            // Avoid recursion: our LOA updates should not re-trigger this handler
            if (context.Depth > 1)
            {
                tracing.Trace($"Skipping - depth {context.Depth} > 1 to avoid recursion.");
                return;
            }

            var affectedTrackIds = new HashSet<Guid>();

            try
            {
                if (context.MessageName == "Delete")
                {
                    // Need Pre-Image to know which Funding Track the deleted decision belonged to
                    var preImage = TryGetPreImage(context);
                    if (preImage != null)
                    {
                        var oldTrack = preImage.GetAttributeValue<EntityReference>(DecisionAttributes.FundingTrack);
                        if (oldTrack != null) affectedTrackIds.Add(oldTrack.Id);
                        tracing.Trace($"Delete: affected Funding Track (from pre-image): {oldTrack?.Id}");
                    }
                    else
                    {
                        tracing.Trace("Delete: No pre-image available; cannot determine Funding Track. Skipping.");
                        return;
                    }
                }
                else if (context.MessageName == "Create")
                {
                    // On create, Target should carry the Funding Track
                    var target = GetTarget(context);
                    var newTrack = target.GetAttributeValue<EntityReference>(DecisionAttributes.FundingTrack);
                    if (newTrack != null) affectedTrackIds.Add(newTrack.Id);
                    tracing.Trace($"Create: affected Funding Track (from target): {newTrack?.Id}");
                }
                else // Update
                {
                    var target = GetTarget(context);

                    // If Funding Track changed, recalc BOTH old and new tracks
                    var preImage = TryGetPreImage(context);
                    var oldTrack = preImage?.GetAttributeValue<EntityReference>(DecisionAttributes.FundingTrack);
                    var newTrack = target.GetAttributeValue<EntityReference>(DecisionAttributes.FundingTrack);

                    if (oldTrack != null) affectedTrackIds.Add(oldTrack.Id);
                    if (newTrack != null) affectedTrackIds.Add(newTrack.Id);

                    // If track didn't change, add the current track (target or DB)
                    if (affectedTrackIds.Count == 0)
                    {
                        if (newTrack != null)
                        {
                            affectedTrackIds.Add(newTrack.Id);
                            tracing.Trace($"Update: affected Funding Track (from target): {newTrack.Id}");
                        }
                        else
                        {
                            var cols = new ColumnSet(DecisionAttributes.FundingTrack);
                            var current = service.Retrieve(EntityNames.Decision, context.PrimaryEntityId, cols);
                            var currentTrack = current.GetAttributeValue<EntityReference>(DecisionAttributes.FundingTrack);
                            if (currentTrack != null)
                            {
                                affectedTrackIds.Add(currentTrack.Id);
                                tracing.Trace($"Update: affected Funding Track (from DB): {currentTrack.Id}");
                            }
                        }
                    }
                }

                if (affectedTrackIds.Count == 0)
                {
                    tracing.Trace("No affected Funding Tracks determined; nothing to recalc.");
                    return;
                }

                foreach (var trackId in affectedTrackIds)
                {
                    // 1) Force the Funding Track roll-up (book_decisiontotal) to recalculate immediately
                    //    This avoids waiting for async system jobs and ensures the formula column reads fresh totals.
                    var rollupReq = new CalculateRollupFieldRequest
                    {
                        Target   = new EntityReference(EntityNames.FundingTrack, trackId),
                        FieldName = FundingTrackAttributes.DecisionTotal // roll-up column logical name
                    };
                    var rollupRes = (CalculateRollupFieldResponse)service.Execute(rollupReq);
                    tracing.Trace($"Roll-up recalculated for Funding Track {trackId}. New value: {rollupRes.Results}");

                    // 2) Find the associated LOA for the Funding Track
                    var trackCols = new ColumnSet(FundingTrackAttributes.LineOfAccounting);
                    var track = service.Retrieve(EntityNames.FundingTrack, trackId, trackCols);
                    var loaRef = track.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);
                    if (loaRef == null)
                    {
                        tracing.Trace($"Funding Track {trackId} has no LOA; skipping LOA recalculation.");
                        continue;
                    }

                    // 3) Recalc LOA TDP & Remaining (Funding Tracks sum + Ledger net − Allocations)
                    TDPCalculationHelper.RecalculateLOATDP(service, loaRef.Id, tracing);
                    tracing.Trace($"LOA {loaRef.Id} recalculated after decision change (TDP & Remaining).");
                }
            }
            catch (InvalidPluginExecutionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                tracing.Trace($"Unhandled exception in {GetType().Name}: {ex}");
                throw new InvalidPluginExecutionException(
                    $"An error occurred in {GetType().Name}: {ex.Message}", ex);
            }
        }
    }
}