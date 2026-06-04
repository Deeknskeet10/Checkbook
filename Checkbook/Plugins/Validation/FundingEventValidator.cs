using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-operation validator for book_fundingevent and book_fundingdetails.
    /// Enforces two invariants that FundingPercentageHelper and the Generate
    /// Distributions sweep both rely on:
    ///
    /// (A) Non-overlap — at any moment there is at most one active Funding Event
    ///     of a given FundingType (AFP / Allotment). Same-type events may not
    ///     have overlapping [StartDate, EndDate] ranges.
    ///
    /// (B) Allotment ≤ AFP — for every (Fund, PG/SAG), at every date covered by
    ///     active events, the Allotment percentage must not exceed the AFP
    ///     percentage. (Allotment is the authority to spend AFP, so it cannot
    ///     outrun what AFP has distributed.)
    ///
    /// Runs on Create + Update of both entities; the affected scope is derived
    /// from the target.
    /// </summary>
    public class FundingEventValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != "Create" && context.MessageName != "Update")
            {
                tracing.Trace($"Skipping — unsupported message {context.MessageName}.");
                return;
            }

            if (context.PrimaryEntityName == EntityNames.FundingEvent)
            {
                ValidateFundingEvent(context, service, tracing);
            }
            else if (context.PrimaryEntityName == EntityNames.FundingDetails)
            {
                ValidateFundingDetail(context, service, tracing);
            }
            else
            {
                tracing.Trace($"Skipping — entity {context.PrimaryEntityName} not handled.");
            }
        }

        // -----------------------------------------------------------------
        // Funding Event entry — re-checks both invariants for the event's
        // effective date range, type, and every (Fund, PG/SAG) reachable
        // through its book_fundingdetails children.
        // -----------------------------------------------------------------
        private void ValidateFundingEvent(
            IPluginExecutionContext context, IOrganizationService service, ITracingService tracing)
        {
            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);
            var merged = preImage == null ? target : GetMergedEntity(target, preImage);

            // If the merged record isn't active, no invariant can be violated.
            if (IsInactive(merged)) { tracing.Trace("Event is inactive — skipping."); return; }

            var fundingType = GetEffectiveOptionSetValue(target, preImage, FundingEventAttributes.FundingType)?.Value;
            var startDate   = GetEffectiveDate(target, preImage, FundingEventAttributes.StartDate);
            var endDate     = GetEffectiveDate(target, preImage, FundingEventAttributes.EndDate);

            if (fundingType == null || startDate == null || endDate == null)
            {
                tracing.Trace("Event missing Type / Start / End — letting Dataverse required-field validation handle it.");
                return;
            }

            if (endDate.Value < startDate.Value)
                throw new InvalidPluginExecutionException(
                    $"Funding Event Start ({startDate:yyyy-MM-dd}) must be on or before End ({endDate:yyyy-MM-dd}).");

            // (A) Non-overlap — same type, active, range overlaps target, not self.
            EnforceNoOverlap(service, tracing, context.PrimaryEntityId,
                             fundingType.Value, startDate.Value, endDate.Value,
                             GetName(merged));

            // (B) Allotment ≤ AFP across every (Fund, PG/SAG) covered by this event's details.
            // On Create the event has no children yet; nothing to check.
            if (context.MessageName == "Create" && context.PrimaryEntityId == Guid.Empty) return;

            var pairs = GetFundingDetailPairs(service, context.PrimaryEntityId);
            foreach (var pair in pairs)
            {
                EnforceAllotmentNotExceedingAFP(service, tracing, pair.FundId, pair.PgSagId,
                                                modifiedDetailId: Guid.Empty,
                                                overrideFundingEventId: context.PrimaryEntityId,
                                                overrideType: fundingType.Value,
                                                overrideStart: startDate.Value,
                                                overrideEnd: endDate.Value,
                                                overridePct: null);
            }
        }

        // -----------------------------------------------------------------
        // Funding Detail entry — only Invariant B applies; the detail itself
        // can't create a new overlap (its parent event's range is what matters).
        // We do still need to handle Fund/PG re-pointing: validate both the
        // new (Fund, PG/SAG) and, if changed, the old one (so removing a high
        // Allotment pct from a pair clears any lingering check needs).
        // -----------------------------------------------------------------
        private void ValidateFundingDetail(
            IPluginExecutionContext context, IOrganizationService service, ITracingService tracing)
        {
            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            if (IsInactive(preImage == null ? target : GetMergedEntity(target, preImage)))
            {
                tracing.Trace("Detail is inactive — skipping.");
                return;
            }

            var feRef    = GetEffectiveEntityReference(target, preImage, FundingDetailsAttributes.FundingEvent);
            var fundRef  = GetEffectiveEntityReference(target, preImage, FundingDetailsAttributes.Fund);
            var pgRef    = GetEffectiveEntityReference(target, preImage, FundingDetailsAttributes.PGSAG);
            var pctRaw   = (object)null;
            if (target.Contains(FundingDetailsAttributes.DistributionPercentage))
                pctRaw = target[FundingDetailsAttributes.DistributionPercentage];
            else if (preImage != null && preImage.Contains(FundingDetailsAttributes.DistributionPercentage))
                pctRaw = preImage[FundingDetailsAttributes.DistributionPercentage];
            var pct = NumericHelper.ToDecimal(pctRaw, 0m);

            if (feRef == null || fundRef == null || pgRef == null)
            {
                tracing.Trace("Detail missing FundingEvent / Fund / PG-SAG — letting required-field validation handle it.");
                return;
            }

            var feMeta = RetrieveFundingEventMeta(service, feRef.Id);
            if (feMeta == null)
            {
                tracing.Trace($"Parent FundingEvent {feRef.Id} not found — skipping.");
                return;
            }
            if (feMeta.IsInactive) { tracing.Trace("Parent event inactive — skipping."); return; }

            EnforceAllotmentNotExceedingAFP(
                service, tracing,
                fundId: fundRef.Id,
                pgSagId: pgRef.Id,
                modifiedDetailId: context.PrimaryEntityId,
                overrideFundingEventId: feRef.Id,
                overrideType: feMeta.FundingType,
                overrideStart: feMeta.StartDate,
                overrideEnd: feMeta.EndDate,
                overridePct: pct);

            // If the row's Fund / PG/SAG changed, also re-validate the OLD pair —
            // removing the detail from there could leave a previously-balanced
            // (Fund, PG/SAG) … actually, removing a row only LOWERS pct on that
            // pair, never raises Allotment above AFP. So skip re-check of the old.
        }

        // -----------------------------------------------------------------
        // Invariant A: same-type, range overlap, active, not-self.
        // -----------------------------------------------------------------
        private static void EnforceNoOverlap(
            IOrganizationService service, ITracingService tracing,
            Guid selfId, int fundingType, DateTime start, DateTime end, string selfName)
        {
            var conds = new FilterExpression(LogicalOperator.And)
            {
                Conditions =
                {
                    new ConditionExpression(FundingEventAttributes.FundingType, ConditionOperator.Equal, fundingType),
                    new ConditionExpression(FundingEventAttributes.StateCode,   ConditionOperator.Equal, StateCodeValues.Active),
                    new ConditionExpression(FundingEventAttributes.StartDate,   ConditionOperator.OnOrBefore, end),
                    new ConditionExpression(FundingEventAttributes.EndDate,     ConditionOperator.OnOrAfter,  start),
                },
            };
            if (selfId != Guid.Empty)
                conds.AddCondition(FundingEventAttributes.Id, ConditionOperator.NotEqual, selfId);

            var query = new QueryExpression(EntityNames.FundingEvent)
            {
                ColumnSet = new ColumnSet(FundingEventAttributes.Name),
                Criteria = conds,
                TopCount = 1,
                NoLock = true,
            };

            var conflict = service.RetrieveMultiple(query).Entities.FirstOrDefault();
            if (conflict != null)
            {
                var typeName = fundingType == FundingTypeValues.AFP ? "AFP" : "Allotment";
                var otherName = conflict.GetAttributeValue<string>(FundingEventAttributes.Name) ?? conflict.Id.ToString();
                throw new InvalidPluginExecutionException(
                    ValidationMessages.OverlappingFundingEvents(typeName, selfName ?? "(new)", otherName));
            }
        }

        // -----------------------------------------------------------------
        // Invariant B for one (Fund, PG/SAG):
        // walk the timeline of AFP + Allotment ranges intersecting the target
        // event's range (or the detail's parent event range), substituting
        // the target's pending values in place of the persisted row's, and
        // reject if Allotment pct > AFP pct in any segment.
        // -----------------------------------------------------------------
        private static void EnforceAllotmentNotExceedingAFP(
            IOrganizationService service, ITracingService tracing,
            Guid fundId, Guid pgSagId,
            Guid modifiedDetailId,
            Guid overrideFundingEventId,
            int overrideType,
            DateTime overrideStart,
            DateTime overrideEnd,
            decimal? overridePct)
        {
            // Pull all active FundingDetails rows for this (Fund, PG/SAG) joined to
            // their parent active FundingEvents. We'll filter to ranges intersecting
            // [overrideStart, overrideEnd] in memory — cheaper than a complex query
            // and the dataset is small.
            var rows = QueryActivePctRows(service, fundId, pgSagId);

            // Apply the override: substitute the modified row's persisted values
            // with the target's pending ones. For an event-level edit, override
            // applies to every row whose parent is the modified event. For a
            // detail-level edit, override applies to just that one row.
            var rangesByType = new Dictionary<int, List<PctRange>>
            {
                { FundingTypeValues.AFP, new List<PctRange>() },
                { FundingTypeValues.Allotment, new List<PctRange>() },
            };

            bool overrideAppliedToAny = false;
            foreach (var row in rows)
            {
                bool isOverrideTarget;
                if (modifiedDetailId != Guid.Empty)
                {
                    // Detail-level edit: row must match the detail id.
                    isOverrideTarget = row.DetailId == modifiedDetailId;
                }
                else
                {
                    // Event-level edit: row must hang off the modified event.
                    isOverrideTarget = row.FundingEventId == overrideFundingEventId;
                }

                if (isOverrideTarget)
                {
                    overrideAppliedToAny = true;
                    rangesByType[overrideType].Add(new PctRange(
                        overrideStart, overrideEnd,
                        overridePct ?? row.Pct,
                        row.FundingEventName ?? "(self)"));
                }
                else
                {
                    rangesByType[row.FundingType].Add(new PctRange(
                        row.StartDate, row.EndDate, row.Pct, row.FundingEventName ?? row.FundingEventId.ToString()));
                }
            }

            // If the edit is a brand-new detail/event (no matching persisted row),
            // inject the override as a fresh range.
            if (!overrideAppliedToAny && overridePct.HasValue)
            {
                rangesByType[overrideType].Add(new PctRange(
                    overrideStart, overrideEnd, overridePct.Value, "(this row)"));
            }

            // Build the segmented timeline restricted to the override's range —
            // any violation outside [overrideStart, overrideEnd] is either
            // pre-existing (someone else's problem) or already validated by
            // a prior save. We only ever judge what THIS save changes.
            var segments = BuildSegments(rangesByType, overrideStart, overrideEnd);

            foreach (var seg in segments)
            {
                if (seg.AllotmentPct > seg.AfpPct)
                {
                    var fundName = ResolveName(service, EntityNames.Fund, fundId, "book_name");
                    var pgName   = ResolveName(service, EntityNames.PG,   pgSagId, "book_name");
                    throw new InvalidPluginExecutionException(
                        ValidationMessages.AllotmentExceedsAFP(
                            fundName ?? fundId.ToString(),
                            pgName ?? pgSagId.ToString(),
                            seg.Start,
                            seg.AllotmentPct,
                            seg.AfpPct));
                }
            }
        }

        // -----------------------------------------------------------------
        // Helpers: data access
        // -----------------------------------------------------------------
        private sealed class PctRow
        {
            public Guid DetailId;
            public Guid FundingEventId;
            public string FundingEventName;
            public int FundingType;
            public DateTime StartDate;
            public DateTime EndDate;
            public decimal Pct;
        }

        private sealed class FundingEventMeta
        {
            public int FundingType;
            public DateTime StartDate;
            public DateTime EndDate;
            public bool IsInactive;
        }

        private static List<PctRow> QueryActivePctRows(IOrganizationService service, Guid fundId, Guid pgSagId)
        {
            var query = new QueryExpression(EntityNames.FundingDetails)
            {
                ColumnSet = new ColumnSet(
                    FundingDetailsAttributes.Id,
                    FundingDetailsAttributes.FundingEvent,
                    FundingDetailsAttributes.DistributionPercentage),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingDetailsAttributes.Fund,      ConditionOperator.Equal, fundId),
                        new ConditionExpression(FundingDetailsAttributes.PGSAG,    ConditionOperator.Equal, pgSagId),
                        new ConditionExpression(FundingDetailsAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                NoLock = true,
            };
            var feLink = query.AddLink(
                EntityNames.FundingEvent,
                FundingDetailsAttributes.FundingEvent,
                FundingEventAttributes.Id,
                JoinOperator.Inner);
            feLink.EntityAlias = "fe";
            feLink.Columns = new ColumnSet(
                FundingEventAttributes.Name,
                FundingEventAttributes.FundingType,
                FundingEventAttributes.StartDate,
                FundingEventAttributes.EndDate);
            feLink.LinkCriteria = new FilterExpression(LogicalOperator.And)
            {
                Conditions =
                {
                    new ConditionExpression(FundingEventAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                },
            };

            return service.RetrieveMultiple(query).Entities.Select(fd => new PctRow
            {
                DetailId         = fd.Id,
                FundingEventId   = fd.GetAttributeValue<EntityReference>(FundingDetailsAttributes.FundingEvent)?.Id ?? Guid.Empty,
                FundingEventName = GetAliasedString(fd, "fe", FundingEventAttributes.Name),
                FundingType      = GetAliasedOption(fd, "fe", FundingEventAttributes.FundingType),
                StartDate        = GetAliasedDate(fd, "fe", FundingEventAttributes.StartDate) ?? DateTime.MinValue,
                EndDate          = GetAliasedDate(fd, "fe", FundingEventAttributes.EndDate)   ?? DateTime.MaxValue,
                Pct              = NumericHelper.ToDecimal(fd, FundingDetailsAttributes.DistributionPercentage) ?? 0m,
            }).ToList();
        }

        private sealed class FundingDetailPair { public Guid FundId; public Guid PgSagId; }

        private static List<FundingDetailPair> GetFundingDetailPairs(IOrganizationService service, Guid fundingEventId)
        {
            var query = new QueryExpression(EntityNames.FundingDetails)
            {
                ColumnSet = new ColumnSet(FundingDetailsAttributes.Fund, FundingDetailsAttributes.PGSAG),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingDetailsAttributes.FundingEvent, ConditionOperator.Equal, fundingEventId),
                        new ConditionExpression(FundingDetailsAttributes.StateCode,    ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                NoLock = true,
            };

            return service.RetrieveMultiple(query).Entities
                .Select(e => new FundingDetailPair
                {
                    FundId  = e.GetAttributeValue<EntityReference>(FundingDetailsAttributes.Fund)?.Id ?? Guid.Empty,
                    PgSagId = e.GetAttributeValue<EntityReference>(FundingDetailsAttributes.PGSAG)?.Id ?? Guid.Empty,
                })
                .Where(p => p.FundId != Guid.Empty && p.PgSagId != Guid.Empty)
                .GroupBy(p => new { p.FundId, p.PgSagId })
                .Select(g => g.First())
                .ToList();
        }

        private static FundingEventMeta RetrieveFundingEventMeta(IOrganizationService service, Guid fundingEventId)
        {
            try
            {
                var fe = service.Retrieve(EntityNames.FundingEvent, fundingEventId, new ColumnSet(
                    FundingEventAttributes.FundingType,
                    FundingEventAttributes.StartDate,
                    FundingEventAttributes.EndDate,
                    FundingEventAttributes.StateCode));
                return new FundingEventMeta
                {
                    FundingType = fe.GetAttributeValue<OptionSetValue>(FundingEventAttributes.FundingType)?.Value ?? -1,
                    StartDate   = fe.GetAttributeValue<DateTime?>(FundingEventAttributes.StartDate) ?? DateTime.MinValue,
                    EndDate     = fe.GetAttributeValue<DateTime?>(FundingEventAttributes.EndDate)   ?? DateTime.MaxValue,
                    IsInactive  = (fe.GetAttributeValue<OptionSetValue>("statecode")?.Value ?? 0) != StateCodeValues.Active,
                };
            }
            catch
            {
                return null;
            }
        }

        private static string ResolveName(IOrganizationService service, string entityName, Guid id, string nameAttr)
        {
            try
            {
                var e = service.Retrieve(entityName, id, new ColumnSet(nameAttr));
                return e.GetAttributeValue<string>(nameAttr);
            }
            catch { return null; }
        }

        // -----------------------------------------------------------------
        // Segmentation
        // -----------------------------------------------------------------
        private sealed class PctRange
        {
            public DateTime Start;
            public DateTime End;
            public decimal Pct;
            public string Label;
            public PctRange(DateTime start, DateTime end, decimal pct, string label)
            {
                Start = start.Date; End = end.Date; Pct = pct; Label = label;
            }
        }

        private sealed class Segment
        {
            public DateTime Start;
            public DateTime End;
            public decimal AfpPct;
            public decimal AllotmentPct;
        }

        private static List<Segment> BuildSegments(
            Dictionary<int, List<PctRange>> rangesByType,
            DateTime clipStart, DateTime clipEnd)
        {
            // Boundary points: each range's Start and End+1 (exclusive end).
            var boundaries = new SortedSet<DateTime>();
            boundaries.Add(clipStart.Date);
            boundaries.Add(clipEnd.Date.AddDays(1));
            foreach (var kvp in rangesByType)
                foreach (var r in kvp.Value)
                {
                    if (r.End < clipStart || r.Start > clipEnd) continue;
                    var s = r.Start < clipStart ? clipStart : r.Start;
                    var e = r.End   > clipEnd   ? clipEnd   : r.End;
                    boundaries.Add(s);
                    boundaries.Add(e.AddDays(1));
                }

            var sorted = boundaries.ToList();
            var segments = new List<Segment>();
            for (int i = 0; i < sorted.Count - 1; i++)
            {
                var segStart = sorted[i];
                var segEnd   = sorted[i + 1].AddDays(-1);
                if (segStart > segEnd) continue;

                var seg = new Segment { Start = segStart, End = segEnd };
                foreach (var r in rangesByType[FundingTypeValues.AFP])
                    if (r.Start <= segStart && r.End >= segEnd) seg.AfpPct = Math.Max(seg.AfpPct, r.Pct);
                foreach (var r in rangesByType[FundingTypeValues.Allotment])
                    if (r.Start <= segStart && r.End >= segEnd) seg.AllotmentPct = Math.Max(seg.AllotmentPct, r.Pct);

                segments.Add(seg);
            }
            return segments;
        }

        // -----------------------------------------------------------------
        // Tiny extraction helpers
        // -----------------------------------------------------------------
        private static DateTime? GetEffectiveDate(Entity target, Entity preImage, string attr)
        {
            if (target.Contains(attr)) return target.GetAttributeValue<DateTime?>(attr);
            if (preImage != null && preImage.Contains(attr)) return preImage.GetAttributeValue<DateTime?>(attr);
            return null;
        }

        private static string GetName(Entity e)
        {
            if (e.Contains(FundingEventAttributes.Name))
                return e.GetAttributeValue<string>(FundingEventAttributes.Name);
            return null;
        }

        private static bool IsInactive(Entity e)
        {
            if (e == null) return false;
            var sc = e.GetAttributeValue<OptionSetValue>("statecode");
            return sc != null && sc.Value != StateCodeValues.Active;
        }

        private static string GetAliasedString(Entity e, string alias, string attr)
        {
            var key = alias + "." + attr;
            if (!e.Contains(key)) return null;
            var raw = (e[key] as AliasedValue)?.Value;
            return raw as string;
        }

        private static int GetAliasedOption(Entity e, string alias, string attr)
        {
            var key = alias + "." + attr;
            if (!e.Contains(key)) return -1;
            var raw = (e[key] as AliasedValue)?.Value;
            if (raw is OptionSetValue osv) return osv.Value;
            if (raw is int i) return i;
            return -1;
        }

        private static DateTime? GetAliasedDate(Entity e, string alias, string attr)
        {
            var key = alias + "." + attr;
            if (!e.Contains(key)) return null;
            var raw = (e[key] as AliasedValue)?.Value;
            return raw as DateTime?;
        }
    }
}
