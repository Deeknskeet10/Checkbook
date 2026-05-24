using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.LOAs.Helpers;

namespace Checkbook.Plugins.LOAs
{
    /// <summary>
    /// Custom API handler for <c>book_GenerateLOAs</c>. The bulk-mode counterpart
    /// to <see cref="FundingTrackLOASynchronizer"/>:
    ///
    /// • Iterates every active Funding Track that has no LOA linked yet
    ///   (optionally filtered by Fund fiscal year).
    /// • For each FT, resolves its LOA grain, find-or-creates the matching LOA,
    ///   links the FT, and associates the FT's APE with the LOA.
    /// • Recalculates TDP on every touched LOA at the end.
    ///
    /// Input parameters:
    ///   <c>FiscalYear</c> (int, optional) — Fund FY option-set value to limit the scope.
    ///                                       Pass 0 or omit to process all FYs.
    ///
    /// Output parameters:
    ///   <c>Created</c> (int) — new LOAs created.
    ///   <c>Linked</c>  (int) — FTs linked to a pre-existing LOA.
    ///   <c>Skipped</c> (int) — FTs skipped (missing grain, name build failed, etc).
    /// </summary>
    public class LOAGenerator : PluginBase
    {
        private const string MessageName = "book_GenerateLOAs";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != MessageName)
            {
                tracing.Trace($"Skipping — message {context.MessageName} is not {MessageName}.");
                return;
            }

            int fiscalYearFilter = 0;
            if (context.InputParameters.TryGetValue("FiscalYear", out var fyRaw) && fyRaw is int fy && fy > 0)
                fiscalYearFilter = fy;

            tracing.Trace($"Generating LOAs (FiscalYear filter = " +
                          $"{(fiscalYearFilter == 0 ? "none" : fiscalYearFilter.ToString())}).");

            var created = 0;
            var linked  = 0;
            var skipped = 0;
            var touchedLoaIds = new HashSet<Guid>();

            foreach (var ft in QueryUnlinkedFundingTracks(service, fiscalYearFilter))
            {
                var grain = LOAResolver.Resolve(service, ft, tracing);
                if (grain == null)
                {
                    skipped++;
                    continue;
                }

                var matchedId = LOAResolver.FindByName(service, grain.CanonicalName);
                Guid loaId;
                if (matchedId.HasValue)
                {
                    loaId = matchedId.Value;
                    linked++;
                    tracing.Trace($"FT {ft.Id}: linking to existing LOA '{grain.CanonicalName}' → {loaId}.");
                }
                else
                {
                    var owningBu = ft.GetAttributeValue<EntityReference>("owningbusinessunit");
                    var loaEntity = LOAResolver.BuildLOAEntity(grain, owningBu);
                    loaId = service.Create(loaEntity);
                    created++;
                    tracing.Trace($"FT {ft.Id}: created new LOA '{grain.CanonicalName}' → {loaId}.");
                }

                // Link the FT to the LOA. The synchronizer guards Depth>1 so won't recurse.
                var ftUpdate = new Entity(EntityNames.FundingTrack, ft.Id);
                ftUpdate[FundingTrackAttributes.LineOfAccounting] =
                    new EntityReference(EntityNames.FundingLine, loaId);
                service.Update(ftUpdate);

                if (grain.APE != null)
                    LOAResolver.AssociateApe(service, loaId, grain.APE, tracing);

                touchedLoaIds.Add(loaId);
            }

            tracing.Trace($"Resolved {created} created + {linked} linked + {skipped} skipped " +
                          $"across {touchedLoaIds.Count} touched LOAs. Recalculating TDP.");

            if (touchedLoaIds.Count > 0)
                TDPCalculationHelper.BatchRecalculateLOATDP(service, touchedLoaIds, tracing);

            context.OutputParameters["Created"] = created;
            context.OutputParameters["Linked"]  = linked;
            context.OutputParameters["Skipped"] = skipped;
        }

        /// <summary>
        /// Pages through every active Funding Track with no <c>book_lineofaccountingloa</c>,
        /// optionally restricted to a Fund fiscal year. Yields one entity at a time
        /// so the caller can stream large batches.
        /// </summary>
        private static IEnumerable<Entity> QueryUnlinkedFundingTracks(
            IOrganizationService service,
            int fiscalYearFilter)
        {
            var query = new QueryExpression(EntityNames.FundingTrack)
            {
                ColumnSet = new ColumnSet(
                    FundingTrackAttributes.Id,
                    FundingTrackAttributes.DisbursingOfficial,
                    FundingTrackAttributes.Fund,
                    FundingTrackAttributes.BOC,
                    FundingTrackAttributes.DollarType,
                    FundingTrackAttributes.PG,
                    FundingTrackAttributes.SAG,
                    FundingTrackAttributes.MDEP,
                    FundingTrackAttributes.APE,
                    FundingTrackAttributes.LineOfAccounting,
                    "owningbusinessunit"),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingTrackAttributes.StateCode,        ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(FundingTrackAttributes.LineOfAccounting, ConditionOperator.Null),
                    },
                },
                PageInfo = new PagingInfo { Count = 500, PageNumber = 1, ReturnTotalRecordCount = false },
                NoLock = true,
            };

            if (fiscalYearFilter > 0)
            {
                var fundLink = query.AddLink(EntityNames.Fund, FundingTrackAttributes.Fund, FundAttributes.Id);
                fundLink.EntityAlias = "fund";
                fundLink.LinkCriteria.AddCondition(FundAttributes.FiscalYear, ConditionOperator.Equal, fiscalYearFilter);
            }

            while (true)
            {
                var page = service.RetrieveMultiple(query);
                foreach (var entity in page.Entities)
                    yield return entity;

                if (!page.MoreRecords)
                    yield break;

                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
        }
    }
}
