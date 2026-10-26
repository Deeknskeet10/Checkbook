using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Distributions.Helpers;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Distributions
{
    /// <summary>
    /// Custom API handler for <c>book_GenerateDistributions</c>. Replaces the
    /// <c>Distribution-GenerateAFPDistributions</c> Power Automate flow.
    ///
    /// Amend-in-place model (the original design deactivated every pending row
    /// up front and recreated from scratch; this destroyed pending Turn-In /
    /// State Swap / manual rows and churned row GUIDs for GFEBS clerks):
    /// <list type="number">
    ///   <item>Aggregate active Prioritizations into (dest_fc, PG, fund, FY) buckets,
    ///         then group buckets by (Fund, PG). Per destination the processor
    ///         compares target (funded × pct) against the committed IMMUTABLE net
    ///         (GFEBS-entered, manual, Turn-In/Swap-linked rows) and amends the
    ///         destination's PENDING sweep credit in place — update its amount,
    ///         create it when missing, deactivate it when no longer needed. One
    ///         consolidated pending debit at the holding FC carries the sum of the
    ///         group's pending credits; overages/evens roll through the Sweep
    ///         Turn-In machinery unchanged. Destination FC is resolved by walking
    ///         the FC parent chain up to state level (parent = holding FC).</item>
    ///   <item>Same reconciliation for BE-approved Requirements that have no
    ///         Prioritizations (types TARC + ARNGExternal), grouped on
    ///         (fundcenter, PG, fund, FY).</item>
    ///   <item>Orphan cleanup (Phase 4): pending sweep rows whose (Fund, FC, PG)
    ///         no longer matches any bucket are deactivated, and each pending
    ///         holding-FC debit is re-synced to the sum of its surviving credits.</item>
    /// </list>
    ///
    /// Input parameters:
    ///   <c>FundingType</c>        (int, optional)    — 0 = AFP only, 1 = Allotment only, omitted = both.
    ///   <c>FiscalYear</c>         (int, optional)    — option-set value on book_fund.book_fiscalyear;
    ///                                                  filters buckets + Phase 4. Omitted = all FYs.
    ///   <c>NextToken</c>          (string, optional) — opaque resume marker returned by a prior call.
    ///                                                  Empty/missing = fresh start. (The wire-level
    ///                                                  name is <c>NextToken</c>; internally the
    ///                                                  concept is a continuation cursor. Renamed
    ///                                                  from <c>ContinuationToken</c> to sidestep an
    ///                                                  orphaned Boolean-typed sdkmessageresponsefield
    ///                                                  row in the target org.)
    ///
    /// Output parameters:
    ///   <c>Deactivated</c>        (int) — pending sweep rows deactivated in THIS invocation
    ///                                     (no longer needed, duplicate, or orphaned).
    ///   <c>Created</c>            (int) — Distribution rows created (each debit / credit counts 1).
    ///   <c>Updated</c>            (int) — pending sweep rows amended in place (amount / FE / pairing).
    ///   <c>TurnInsCreated</c>     (int) — Overage Turn-Ins created.
    ///   <c>Skipped</c>            (int) — Destinations skipped (missing FundingDetails percentage, etc).
    ///   <c>NextToken</c>          (string) — empty = done; non-empty = caller should re-invoke
    ///                                        passing this back as input <c>NextToken</c>.
    ///
    /// Time budget: the plugin tracks a wall-clock budget below the 2-minute sandbox
    /// ceiling. When the budget is exceeded between buckets, processing halts and a
    /// continuation token is returned. Per-invocation output counters are NOT cumulative
    /// across calls — the caller sums them.
    /// </summary>
    public class GenerateDistributionsPlugin : PluginBase
    {
        private const string MessageName = "book_GenerateDistributions";
        private const string HoldingFundCenterEnvVar = EnvironmentVariableKeys.DistributionHoldingFundCenter;

        // Plugin sandbox hard kill is 120s. Bail at ~90s to leave ~30s of tail
        // headroom: after the budget trips, one more bucket may finish, then
        // SyncHoldingDebit's batched writes flush, then the caller serializes the
        // continuation token — all of which must complete before the 120s ceiling,
        // because a kill during the tail loses the token and stalls the run.
        // Writes are batched (BatchWriter / ExecuteMultiple), so the tail is a
        // handful of round-trips, not one per row.
        private static readonly TimeSpan TimeBudget = TimeSpan.FromSeconds(90);

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

            int? fundingTypeFilter = null;
            if (context.InputParameters.TryGetValue("FundingType", out var rawType) && rawType is int ft)
                fundingTypeFilter = ft;

            int? fiscalYearFilter = null;
            if (context.InputParameters.TryGetValue("FiscalYear", out var rawFy) && rawFy is int fy && fy > 0)
                fiscalYearFilter = fy;

            string tokenIn = null;
            if (context.InputParameters.TryGetValue("NextToken", out var rawTok) && rawTok is string s)
                tokenIn = s;
            var cursor = DistributionCursor.Parse(tokenIn);

            tracing.Trace(
                $"GenerateDistributions starting (FundingType={(fundingTypeFilter.HasValue ? fundingTypeFilter.Value.ToString() : "both")}, " +
                $"FiscalYear={(fiscalYearFilter.HasValue ? fiscalYearFilter.Value.ToString() : "all")}, " +
                $"resume={(cursor != null ? cursor.Serialize() : "(fresh)")}).");

            var holdingFundCenterId = EnvironmentVariableHelper.GetGuid(service, HoldingFundCenterEnvVar);
            tracing.Trace($"Holding Fund Center (env var {HoldingFundCenterEnvVar}) = {holdingFundCenterId}.");

            // Per-invocation caches (both need to be alive by the time we build
            // buckets, since bucket construction resolves owning BU).
            var fcCache  = new Dictionary<Guid, FundCenterMeta>();
            var pctCache = new Dictionary<string, FundingPercentageHelper.FundingResolution>();

            // Debit rows live at the holding FC — own them by the holding FC's BU.
            var holdingOwningBu = FundCenterWalkHelper.GetFundCenterMeta(service, fcCache, holdingFundCenterId)?.OwningBusinessUnit;

            var stopwatch = Stopwatch.StartNew();

            var totalDeactivated = 0;
            var totalCreated = 0;
            var totalUpdated = 0;
            var totalTurnIns = 0;
            var totalSkipped = 0;

            // ---- Phases 2 + 3 — per-FE bucket reconciliation ------------------
            // Skipped entirely when resuming into Phase 4.
            if (cursor == null || cursor.Phase < 4)
            {
                var fundingEvents = DistributionBucketQueries.ResolveActiveFundingEvents(service, tracing, fundingTypeFilter);
                if (fundingEvents.Count == 0)
                {
                    tracing.Trace("No active Funding Events match the filter — Phases 2 + 3 skipped.");
                }

                // Bucket targets come from funded amounts, which nothing in this
                // plugin writes — query them once per invocation, not once per FE.
                var phase2Buckets = DistributionBucketQueries.QueryPrioritizationBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter);
                var phase3Buckets = DistributionBucketQueries.QueryRequirementBuckets(service, tracing, holdingFundCenterId, fcCache, fiscalYearFilter);

                // Tripwire: Phase 2 (state-level FCs) and Phase 3 (TARC-level FCs)
                // destinations are expected to be disjoint. Each phase reconciles
                // only ITS OWN target against the FULL committed net at the FC, so a
                // shared destination would make the two passes fight — spurious
                // Sweep Turn-Ins and pending-credit clobbering. Warn-only; if this
                // ever fires, the phases need to be merged into one combined set.
                var phase2Keys = new HashSet<string>(phase2Buckets.Select(b => $"{b.FundId}|{b.FundCenterId}|{b.PgId}"));
                foreach (var b in phase3Buckets.Where(b => phase2Keys.Contains($"{b.FundId}|{b.FundCenterId}|{b.PgId}")))
                    tracing.Trace(
                        $"WARNING: destination (Fund={b.FundId}, FC={b.FundCenterId}, PG={b.PgId}) appears in BOTH " +
                        "Phase 2 and Phase 3 buckets — the phases will fight over its pending credit / Sweep Turn-In.");

                var groupsByPhase = new Dictionary<int, List<List<DistributionBucket>>>
                {
                    { 2, DistributionBucketQueries.GroupByFundAndPg(phase2Buckets) },   // Prioritizations
                    { 3, DistributionBucketQueries.GroupByFundAndPg(phase3Buckets) },   // Requirements
                };
                tracing.Trace($"Phase 2: {groupsByPhase[2].Count} / Phase 3: {groupsByPhase[3].Count} (Fund, PG) group(s).");

                // Determine starting (fe-index, phase, bucket-idx) from the cursor.
                var startFeIdx      = 0;
                var startPhase      = 2;
                var startBucket     = 0;
                var startBucketOff  = 0;
                if (cursor != null && cursor.Phase >= 2 && cursor.Phase <= 3)
                {
                    var idx = fundingEvents.FindIndex(e => e.Id == cursor.FundingEventId);
                    if (idx >= 0)
                    {
                        startFeIdx     = idx;
                        startPhase     = cursor.Phase;
                        startBucket    = cursor.BucketIdx;
                        startBucketOff = cursor.BucketOffset;
                    }
                    else
                    {
                        tracing.Trace($"Cursor FE {cursor.FundingEventId} no longer active — restarting at FE 0 / Phase 2.");
                    }
                }

                for (var feIdx = startFeIdx; feIdx < fundingEvents.Count; feIdx++)
                {
                    var fundingEvent = fundingEvents[feIdx];
                    var fundingType = fundingEvent.GetAttributeValue<OptionSetValue>(FundingEventAttributes.FundingType)?.Value ?? -1;
                    var fundingEventRef = fundingEvent.ToEntityReference();
                    tracing.Trace($"Processing FundingEvent {fundingEvent.Id} (type = {fundingType}, idx = {feIdx}).");

                    for (var phase = startPhase; phase <= 3; phase++)
                    {
                        var groups = groupsByPhase[phase];
                        var resuming = feIdx == startFeIdx && phase == startPhase;
                        var groupStart = resuming ? startBucket : 0;
                        for (var i = groupStart; i < groups.Count; i++)
                        {
                            // Only the group we resumed into carries a within-group offset.
                            var bucketOff = (resuming && i == startBucket) ? startBucketOff : 0;
                            if (stopwatch.Elapsed > TimeBudget)
                            {
                                var outCursor = new DistributionCursor { Phase = phase, FundingEventId = fundingEvent.Id, BucketIdx = i, BucketOffset = bucketOff };
                                tracing.Trace($"Time budget reached at FE {fundingEvent.Id} Phase {phase} group {i} (bucket {bucketOff}) — returning continuation.");
                                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, outCursor);
                                return;
                            }
                            var r = DistributionBucketProcessor.ProcessGroup(
                                service, tracing, groups[i], fundingEventRef, fundingType,
                                holdingFundCenterId, holdingOwningBu, bucketOff, stopwatch, TimeBudget, pctCache);
                            totalCreated     += r.DistributionsCreated;
                            totalUpdated     += r.DistributionsUpdated;
                            totalDeactivated += r.DistributionsDeactivated;
                            totalTurnIns     += r.TurnInsCreated;
                            totalSkipped     += r.Skipped;
                            if (!r.GroupComplete)
                            {
                                var outCursor = new DistributionCursor { Phase = phase, FundingEventId = fundingEvent.Id, BucketIdx = i, BucketOffset = r.NextBucketOffset };
                                tracing.Trace($"Phase {phase} group {i} split at bucket {r.NextBucketOffset} — returning continuation.");
                                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, outCursor);
                                return;
                            }
                        }
                    }

                    // Once we've finished an FE, subsequent ones start from Phase 2 / group 0.
                    startPhase = 2;
                    startBucket = 0;
                    startBucketOff = 0;
                }
            }

            // ---- Phase 4 — orphan cleanup --------------------------------------
            if (stopwatch.Elapsed > TimeBudget)
            {
                tracing.Trace("Time budget reached before Phase 4 — returning continuation (phase=4).");
                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, new DistributionCursor { Phase = 4 });
                return;
            }

            var cleanup = DistributionOrphanCleanup.Run(
                service, tracing, holdingFundCenterId, fcCache,
                fundingTypeFilter, fiscalYearFilter, stopwatch, TimeBudget);
            totalDeactivated += cleanup.Deactivated;
            totalUpdated     += cleanup.Updated;
            if (!cleanup.Complete)
            {
                tracing.Trace("Phase 4 incomplete — returning continuation (phase=4).");
                WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, new DistributionCursor { Phase = 4 });
                return;
            }

            WriteOutputs(context, totalDeactivated, totalCreated, totalUpdated, totalTurnIns, totalSkipped, null);
        }

        private static void WriteOutputs(IPluginExecutionContext context,
            int deactivated, int created, int updated, int turnIns, int skipped, DistributionCursor cursor)
        {
            context.OutputParameters["Deactivated"]    = deactivated;
            context.OutputParameters["Created"]        = created;
            context.OutputParameters["Updated"]        = updated;
            context.OutputParameters["TurnInsCreated"] = turnIns;
            context.OutputParameters["Skipped"]        = skipped;
            context.OutputParameters["NextToken"]      = cursor != null ? cursor.Serialize() : string.Empty;
        }
    }
}
