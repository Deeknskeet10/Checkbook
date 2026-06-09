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
    /// • Iterates active Funding Tracks that have no LOA linked yet
    ///   (optionally filtered by Fund fiscal year).
    /// • For each FT, resolves its LOA grain, find-or-creates the matching LOA,
    ///   links the FT, and associates the FT's APE with the LOA.
    /// • At the end of the batch, recalcs TDP once per unique LOA touched.
    ///
    /// The PostOp <c>FundingTrackTDPRecalculator</c> short-circuits at Depth>1,
    /// so the FT updates we issue from inside this Custom API don't trigger it.
    /// We do the recalc explicitly here — once per LOA rather than once per FT
    /// — to keep the work bounded by the LOA count, not the FT count.
    ///
    /// Input parameters:
    ///   <c>FiscalYear</c> (int, optional) — Fund FY option-set value to limit the scope.
    ///                                       Pass 0 or omit to process all FYs.
    ///   <c>BatchSize</c>  (int, optional) — Max number of FTs to attempt this invocation.
    ///                                       Pass 0 or omit for "process all in scope" (legacy).
    ///                                       Use to stay under the 2-minute sync sandbox limit
    ///                                       on large datasets; caller loops until Remaining=0.
    ///
    /// Output parameters:
    ///   <c>Created</c>   (int) — new LOAs created.
    ///   <c>Linked</c>    (int) — FTs linked to a pre-existing LOA.
    ///   <c>Skipped</c>   (int) — FTs skipped (missing grain, name build failed, etc).
    ///   <c>Failed</c>    (int) — FTs that threw an exception during processing.
    ///   <c>Remaining</c> (int) — Active unlinked FTs still in scope after this batch.
    ///                            Caller stops when this reaches 0, or when Created+Linked=0
    ///                            for a batch (stuck on unresolvable FTs).
    ///   <c>FailedDetails</c> (string) — semicolon-delimited "ftId: reason" list
    ///                                   so the caller can show the user which FTs failed.
    ///
    /// One FT failing never aborts the batch — exceptions are caught per-row, counted,
    /// and the loop continues so the rest of the run still completes.
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

            int batchSize = 0;
            if (context.InputParameters.TryGetValue("BatchSize", out var bsRaw) && bsRaw is int bs && bs > 0)
                batchSize = bs;

            tracing.Trace($"Generating LOAs (FiscalYear filter = " +
                          $"{(fiscalYearFilter == 0 ? "none" : fiscalYearFilter.ToString())}, " +
                          $"BatchSize = {(batchSize == 0 ? "unlimited" : batchSize.ToString())}).");

            var created = 0;
            var linked  = 0;
            var skipped = 0;
            var failed  = 0;
            var attempted = 0;
            var failedDetails = new List<string>();
            var touchedLoaIds = new HashSet<Guid>();

            foreach (var ft in QueryUnlinkedFundingTracks(service, fiscalYearFilter))
            {
                if (batchSize > 0 && attempted >= batchSize)
                {
                    tracing.Trace($"Reached BatchSize cap ({batchSize}); stopping this invocation.");
                    break;
                }
                attempted++;

                try
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
                        var loaEntity = LOAResolver.BuildLOAEntity(grain);
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
                catch (Exception ex)
                {
                    // One bad row (duplicate-key violations on the LOA unique index,
                    // FaultException from Associate, etc) must not abort the whole batch.
                    // Record the failure and move on so the remaining FTs still get processed.
                    failed++;
                    var reason = (ex.InnerException?.Message ?? ex.Message ?? ex.GetType().Name).Trim();
                    failedDetails.Add($"{ft.Id}: {reason}");
                    tracing.Trace($"FT {ft.Id}: FAILED — {reason}");
                }
            }

            if (touchedLoaIds.Count > 0)
            {
                tracing.Trace($"Recalculating TDP for {touchedLoaIds.Count} touched LOAs.");
                TDPCalculationHelper.BatchRecalculateLOATDP(service, touchedLoaIds, tracing);
            }

            var remaining = CountUnlinkedFundingTracks(service, fiscalYearFilter);

            tracing.Trace($"Batch done: {created} created, {linked} linked, " +
                          $"{skipped} skipped, {failed} failed, {attempted} attempted, " +
                          $"{remaining} still unlinked in scope.");

            context.OutputParameters["Created"]   = created;
            context.OutputParameters["Linked"]    = linked;
            context.OutputParameters["Skipped"]   = skipped;
            context.OutputParameters["Failed"]    = failed;
            context.OutputParameters["Remaining"] = remaining;
            context.OutputParameters["FailedDetails"] = string.Join("; ", failedDetails);
        }

        /// <summary>
        /// Counts active Funding Tracks in scope that still have no LOA linked.
        /// Used to populate the <c>Remaining</c> output so the JS caller knows
        /// whether another batch is needed.
        /// </summary>
        private static int CountUnlinkedFundingTracks(
            IOrganizationService service,
            int fiscalYearFilter)
        {
            var fyLink = fiscalYearFilter > 0
                ? $@"<link-entity name='{EntityNames.Fund}' from='{FundAttributes.Id}' to='{FundingTrackAttributes.Fund}' alias='fund'>
                       <filter><condition attribute='{FundAttributes.FiscalYear}' operator='eq' value='{fiscalYearFilter}' /></filter>
                     </link-entity>"
                : string.Empty;

            var fetch = $@"
                <fetch aggregate='true' no-lock='true'>
                  <entity name='{EntityNames.FundingTrack}'>
                    <attribute name='{FundingTrackAttributes.Id}' alias='cnt' aggregate='count' />
                    <filter type='and'>
                      <condition attribute='{FundingTrackAttributes.StateCode}'        operator='eq'   value='{StateCodeValues.Active}' />
                      <condition attribute='{FundingTrackAttributes.LineOfAccounting}' operator='null' />
                    </filter>
                    {fyLink}
                  </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));
            if (result.Entities.Count == 0) return 0;

            var aliased = result.Entities[0].GetAttributeValue<AliasedValue>("cnt");
            if (aliased?.Value is int i) return i;
            return 0;
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
                    FundingTrackAttributes.LineOfAccounting),
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
