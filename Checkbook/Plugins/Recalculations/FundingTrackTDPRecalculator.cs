using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation recalculator that updates the associated LOA's TDP and TDP Remaining
    /// whenever a Funding Track is created/updated/deleted or when its LOA/ResourceAmount changes.
    /// </summary>
    public class FundingTrackTDPRecalculator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            // Act only on Funding Track (book_fundingtrack) in Post-Operation
            if (context.PrimaryEntityName != EntityNames.FundingTrack)
            {
                tracing.Trace($"Skipping - not a {EntityNames.FundingTrack} record.");
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

            // Avoid recursion: our LOA updates shouldn't re-trigger this handler
            if (context.Depth > 1)
            {
                tracing.Trace($"Skipping - depth {context.Depth} > 1 to avoid recursion.");
                return;
            }

            var affectedLoaIds = new HashSet<Guid>();

            try
            {
                if (context.MessageName == "Delete")
                {
                    // For delete, we need the Pre-Image to know which LOA to recalc
                    var preImage = TryGetPreImage(context);
                    if (preImage != null)
                    {
                        var oldLoa = preImage.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);
                        if (oldLoa != null) affectedLoaIds.Add(oldLoa.Id);
                        tracing.Trace($"Delete: affected LOA (from pre-image): {oldLoa?.Id}");
                    }
                    else
                    {
                        tracing.Trace("Delete: No pre-image available; cannot determine LOA. Skipping.");
                        return;
                    }
                }
                else if (context.MessageName == "Create")
                {
                    // On create, Target should carry LOA
                    var target = GetTarget(context);
                    var newLoa = target.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);
                    if (newLoa != null) affectedLoaIds.Add(newLoa.Id);
                    tracing.Trace($"Create: affected LOA (from target): {newLoa?.Id}");
                }
                else // Update
                {
                    var target = GetTarget(context);

                    // If LOA changed, we must recalc BOTH old and new LOA
                    var preImage = TryGetPreImage(context);
                    var oldLoa = preImage?.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);
                    var newLoa = target.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);

                    if (oldLoa != null) affectedLoaIds.Add(oldLoa.Id);
                    if (newLoa != null) affectedLoaIds.Add(newLoa.Id);

                    // If LOA didn't change, we still need the current LOA (either in Target or from DB)
                    if (affectedLoaIds.Count == 0)
                    {
                        // Prefer target LOA
                        if (newLoa != null)
                        {
                            affectedLoaIds.Add(newLoa.Id);
                            tracing.Trace($"Update: affected LOA (from target): {newLoa.Id}");
                        }
                        else
                        {
                            // Fallback — retrieve from DB
                            var cols = new ColumnSet(FundingTrackAttributes.LineOfAccounting);
                            var current = service.Retrieve(EntityNames.FundingTrack, context.PrimaryEntityId, cols);
                            var currentLoa = current.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);
                            if (currentLoa != null)
                            {
                                affectedLoaIds.Add(currentLoa.Id);
                                tracing.Trace($"Update: affected LOA (from DB): {currentLoa.Id}");
                            }
                        }
                    }
                }

                if (affectedLoaIds.Count == 0)
                {
                    tracing.Trace("No affected LOAs determined; nothing to recalc.");
                    return;
                }

                // Recalculate each affected LOA (includes Funding Tracks + Ledger net; updates TDP & Remaining)
                foreach (var loaId in affectedLoaIds)
                {
                    TDPCalculationHelper.RecalculateLOATDP(service, loaId, tracing);
                    tracing.Trace($"LOA {loaId} recalculated (TDP & TDP Remaining).");
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