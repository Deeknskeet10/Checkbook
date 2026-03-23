using System;
using Microsoft.Xrm.Sdk;
using ARNGCheckbook.Plugins.Constants;
using ARNGCheckbook.Plugins.Helpers;

namespace ARNGCheckbook.Plugins
{
    /// <summary>
    /// Plugin that recalculates TDP and TDP Remaining on Line of Accounting records
    /// when related Funding Tracks or Requirement Fundings are modified.
    ///
    /// Formula:
    ///   LOA.TDP = SUM(Funding Track.ResourceAmount)
    ///   LOA.TDPRemaining = LOA.TDP - SUM(Requirement Funding.TDP)
    ///
    /// Registration:
    ///
    /// For Funding Track (book_fundingtrack):
    /// - Message: Create, Stage: Post-Operation (40), Async recommended
    ///   Filtering Attributes: book_resourceamount, book_lineofaccountingloa
    ///
    /// - Message: Update, Stage: Post-Operation (40), Async recommended
    ///   Filtering Attributes: book_resourceamount, book_lineofaccountingloa
    ///   Pre-Image: book_lineofaccountingloa (to handle LOA changes)
    ///
    /// - Message: Delete, Stage: Pre-Operation (20), Sync required
    ///   Pre-Image: book_lineofaccountingloa, book_resourceamount
    ///
    /// For Requirement Funding (book_requirementfunding):
    /// - Message: Create, Stage: Post-Operation (40), Async recommended
    ///   Filtering Attributes: book_tdp, book_lineofaccounting
    ///
    /// - Message: Update, Stage: Post-Operation (40), Async recommended
    ///   Filtering Attributes: book_tdp, book_lineofaccounting
    ///   Pre-Image: book_lineofaccounting (to handle LOA changes)
    ///
    /// - Message: Delete, Stage: Pre-Operation (20), Sync required
    ///   Pre-Image: book_lineofaccounting, book_tdp
    /// </summary>
    public class LOATDPRecalculator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var entityName = context.PrimaryEntityName;
            var messageName = context.MessageName;

            tracingService.Trace($"Processing {messageName} on {entityName}");

            if (entityName == EntityNames.FundingTrack)
            {
                HandleFundingTrackChange(context, service, tracingService);
            }
            else if (entityName == EntityNames.RequirementFunding)
            {
                HandleRequirementFundingChange(context, service, tracingService);
            }
            else
            {
                tracingService.Trace($"Entity {entityName} not handled by this plugin");
            }
        }

        private void HandleFundingTrackChange(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var loaIds = GetAffectedLOAIds(
                context,
                FundingTrackAttributes.LineOfAccounting,
                tracingService);

            foreach (var loaId in loaIds)
            {
                tracingService.Trace($"Recalculating TDP for LOA {loaId} due to Funding Track change");
                TDPCalculationHelper.RecalculateLOATDP(service, loaId, tracingService);
            }
        }

        private void HandleRequirementFundingChange(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var loaIds = GetAffectedLOAIds(
                context,
                RequirementFundingAttributes.LineOfAccounting,
                tracingService);

            foreach (var loaId in loaIds)
            {
                tracingService.Trace($"Recalculating TDP Remaining for LOA {loaId} due to Requirement Funding change");
                TDPCalculationHelper.RecalculateTDPRemaining(service, loaId, tracingService);
            }
        }

        /// <summary>
        /// Gets all LOA IDs affected by this change. May return multiple IDs if the
        /// LOA lookup was changed from one LOA to another.
        /// </summary>
        private Guid[] GetAffectedLOAIds(
            IPluginExecutionContext context,
            string loaAttributeName,
            ITracingService tracingService)
        {
            var loaIds = new System.Collections.Generic.HashSet<Guid>();

            // For Delete: get LOA from pre-image
            if (context.MessageName == "Delete")
            {
                var preImage = TryGetPreImage(context);
                if (preImage != null)
                {
                    var loaRef = preImage.GetAttributeValue<EntityReference>(loaAttributeName);
                    if (loaRef != null)
                    {
                        tracingService.Trace($"Delete: LOA from pre-image: {loaRef.Id}");
                        loaIds.Add(loaRef.Id);
                    }
                }
                else
                {
                    tracingService.Trace("Warning: Pre-image not available for Delete");
                }
            }
            else
            {
                // For Create/Update: get LOA from target
                var target = GetTarget(context);
                var targetLoaRef = target.GetAttributeValue<EntityReference>(loaAttributeName);

                if (targetLoaRef != null)
                {
                    tracingService.Trace($"Target LOA: {targetLoaRef.Id}");
                    loaIds.Add(targetLoaRef.Id);
                }

                // For Update: also check pre-image for old LOA (if LOA was changed)
                if (context.MessageName == "Update")
                {
                    var preImage = TryGetPreImage(context);
                    if (preImage != null)
                    {
                        var preImageLoaRef = preImage.GetAttributeValue<EntityReference>(loaAttributeName);
                        if (preImageLoaRef != null && !loaIds.Contains(preImageLoaRef.Id))
                        {
                            tracingService.Trace($"Update: Previous LOA from pre-image: {preImageLoaRef.Id}");
                            loaIds.Add(preImageLoaRef.Id);
                        }
                    }
                }
            }

            var result = new Guid[loaIds.Count];
            loaIds.CopyTo(result);
            return result;
        }
    }
}
