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
    /// Guards FY27+ spend plan rows across all three grains:
    ///   • Mode B (Breakout)     — anchored on book_prioritizationfunding, one
    ///     row per (PF, Fund Center, Row Type); cap vs the PF funded amount.
    ///   • Mode A (Centrally Mgd)— anchored on book_requirementfunding, one row
    ///     per (RF, Row Type); cap vs the RF funded amount.
    ///   • Mode C (State-Rollup) — anchored on (book_state, book_fund, book_sag)
    ///     with explicit book_newfiscalyear, one row per (State, Fund, SAG, FY,
    ///     Row Type); cap vs the stored bucket funded amount (book_fundedamount,
    ///     maintained by SpendPlanStateRollup).
    /// Shared for every mode:
    ///   • Anchor exclusivity — exactly one of the three, and none of the legacy
    ///     book_prioritization / book_requirement / book_unfundedrequest lookups.
    ///   • Planned cap — active Planned rows for the anchor may not total more
    ///     than funded (equality NOT required — plans build up incrementally).
    ///   • Month locks — a passed month's Planned cell is frozen; Actual cells
    ///     only accept passed months.
    /// Legacy (FY26) rows — no FY27 anchor/marker — pass through untouched.
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, book_spendplan —
    ///   1. Create (no filter, no images).
    ///   2. Update, filter: book_prioritizationfunding, book_requirementfunding,
    ///      book_state, book_fund, book_sag, book_newfiscalyear, book_fundcenter,
    ///      book_rowtype, book_fundedamount, book_prioritization, and the 12
    ///      book_new* month columns. Pre-image "PreImage": the same attributes
    ///      plus statecode.
    /// </remarks>
    public class SpendPlanFY27Validator : PluginBase
    {
        private const decimal Tolerance = 0.005m;

        private enum Mode { None, Breakout, Central, StateRollup }

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.SpendPlan)
                return;
            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            var pfRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.PrioritizationFunding);
            var rfRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.RequirementFunding);
            var stateRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.State);
            var fundRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.Fund);
            var sagRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.Sag);
            var hasRowType = target.Contains(SpendPlanAttributes.RowType) ||
                             (preImage != null && preImage.Contains(SpendPlanAttributes.RowType));

            var mode = DetectMode(pfRef, rfRef, stateRef, fundRef, sagRef, hasRowType);
            if (mode == Mode.None)
            {
                tracing.Trace("No FY27 anchor; legacy spend plan row — skipping.");
                return;
            }

            EnforceExclusivity(target, preImage, mode, pfRef, rfRef, stateRef, fundRef, sagRef);

            var fcRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.FundCenter);
            var rowType = GetEffectiveOptionSetValue(target, preImage, SpendPlanAttributes.RowType)?.Value
                          ?? SpendPlanRowTypeValues.Planned;

            // Resolve funded amount + fiscal year + the sibling-anchor filter once.
            var resolved = Resolve(service, mode, target, preImage, pfRef, rfRef, stateRef, fundRef, sagRef);

            var anchorAttrs = AnchorAttrs(mode).Concat(new[] { SpendPlanAttributes.FundCenter, SpendPlanAttributes.RowType });
            var anchorsChanged = context.MessageName == "Create" ||
                                 anchorAttrs.Any(a => HasAttributeChanged(target, a));

            if (anchorsChanged)
                EnforceUniqueRow(service, target, mode, resolved, fcRef, rowType);

            var monthsChanged = SpendPlanAttributes.DecimalMonths.Any(m => HasAttributeChanged(target, m));
            if (!monthsChanged && !anchorsChanged)
                return;

            if (monthsChanged)
                EnforceMonthLocks(tracing, target, preImage, resolved, rowType);

            if (rowType == SpendPlanRowTypeValues.Planned && (monthsChanged || anchorsChanged))
                EnforcePlannedCap(service, tracing, target, preImage, context, mode, resolved);
        }

        private static Mode DetectMode(
            EntityReference pf, EntityReference rf,
            EntityReference state, EntityReference fund, EntityReference sag, bool hasRowType)
        {
            if (state != null && fund != null && sag != null) return Mode.StateRollup;
            if (pf != null) return Mode.Breakout;
            if (rf != null && hasRowType) return Mode.Central; // rowtype marks an FY27 row, not a legacy RF row
            return Mode.None;
        }

        private void EnforceExclusivity(
            Entity target, Entity preImage, Mode mode,
            EntityReference pf, EntityReference rf,
            EntityReference state, EntityReference fund, EntityReference sag)
        {
            var anchorCount = (pf != null ? 1 : 0) +
                              (rf != null ? 1 : 0) +
                              (state != null && fund != null && sag != null ? 1 : 0);
            if (anchorCount > 1)
                throw new InvalidPluginExecutionException(
                    "A spend plan row must use exactly one anchor — Prioritization Funding " +
                    "(breakout), Requirement Funding (centrally managed), or State + Fund + SAG " +
                    "(state rollup). Clear the others.");

            // A partial state-rollup anchor is a data error.
            var anyBucketPart = state != null || fund != null || sag != null;
            if (mode != Mode.StateRollup && anyBucketPart)
                throw new InvalidPluginExecutionException(
                    "State, Fund and SAG must all be set together for a state-rollup spend plan row.");
            if (mode == Mode.StateRollup &&
                GetEffectiveOptionSetValue(target, preImage, SpendPlanAttributes.FiscalYear) == null)
                throw new InvalidPluginExecutionException(
                    "A state-rollup spend plan row requires a Fiscal Year.");

            var legacyPrio = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.Prioritization);
            var legacyReq = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.Requirement);
            var legacyUfr = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.UnfundedRequest);
            // Mode Central legitimately uses book_requirementfunding, never the
            // legacy book_requirement lookup.
            if (legacyPrio != null || legacyUfr != null || legacyReq != null)
                throw new InvalidPluginExecutionException(
                    "FY27 spend plan rows must leave the legacy Prioritization / Requirement / " +
                    "Unfunded Request lookups empty — those are reserved for FY26 spend plans.");
        }

        // ── Resolved anchor context ──────────────────────────────────────────

        private sealed class Resolved
        {
            public Mode Mode;
            public decimal Funded;
            public int? FiscalYear;
            public string Label;
            public List<ConditionExpression> AnchorConditions; // identifies sibling rows of the same anchor
        }

        private Resolved Resolve(
            IOrganizationService service, Mode mode, Entity target, Entity preImage,
            EntityReference pf, EntityReference rf,
            EntityReference state, EntityReference fund, EntityReference sag)
        {
            switch (mode)
            {
                case Mode.Breakout:
                {
                    var e = service.Retrieve(EntityNames.PrioritizationFunding, pf.Id, new ColumnSet(
                        PrioritizationFundingAttributes.FundedAmount,
                        PrioritizationFundingAttributes.Prioritization,
                        PrioritizationFundingAttributes.Name));
                    return new Resolved
                    {
                        Mode = mode,
                        Funded = NumericHelper.ToDecimal(e.GetAttributeValue<object>(PrioritizationFundingAttributes.FundedAmount), 0m),
                        FiscalYear = ResolveFyViaPrio(service, e.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization)),
                        Label = e.GetAttributeValue<string>(PrioritizationFundingAttributes.Name) ?? "this Prioritization Funding row",
                        AnchorConditions = new List<ConditionExpression>
                        {
                            new ConditionExpression(SpendPlanAttributes.PrioritizationFunding, ConditionOperator.Equal, pf.Id),
                        },
                    };
                }
                case Mode.Central:
                {
                    var e = service.Retrieve(EntityNames.RequirementFunding, rf.Id, new ColumnSet(
                        RequirementFundingAttributes.FundedAmount,
                        RequirementFundingAttributes.FiscalYear,
                        RequirementFundingAttributes.Name));
                    return new Resolved
                    {
                        Mode = mode,
                        Funded = NumericHelper.ToDecimal(e.GetAttributeValue<object>(RequirementFundingAttributes.FundedAmount), 0m),
                        FiscalYear = e.GetAttributeValue<OptionSetValue>(RequirementFundingAttributes.FiscalYear)?.Value,
                        Label = e.GetAttributeValue<string>(RequirementFundingAttributes.Name) ?? "this Requirement Funding row",
                        AnchorConditions = new List<ConditionExpression>
                        {
                            new ConditionExpression(SpendPlanAttributes.RequirementFunding, ConditionOperator.Equal, rf.Id),
                        },
                    };
                }
                default: // StateRollup — funded is the stored bucket rollup on this row
                {
                    var fy = GetEffectiveOptionSetValue(target, preImage, SpendPlanAttributes.FiscalYear)?.Value;
                    return new Resolved
                    {
                        Mode = mode,
                        Funded = GetEffectiveDecimal(target, preImage, SpendPlanAttributes.FundedAmount),
                        FiscalYear = fy,
                        Label = "this state-rollup bucket",
                        AnchorConditions = new List<ConditionExpression>
                        {
                            new ConditionExpression(SpendPlanAttributes.State, ConditionOperator.Equal, state.Id),
                            new ConditionExpression(SpendPlanAttributes.Fund, ConditionOperator.Equal, fund.Id),
                            new ConditionExpression(SpendPlanAttributes.Sag, ConditionOperator.Equal, sag.Id),
                            new ConditionExpression(SpendPlanAttributes.FiscalYear, ConditionOperator.Equal, fy),
                        },
                    };
                }
            }
        }

        private static string[] AnchorAttrs(Mode mode)
        {
            switch (mode)
            {
                case Mode.Breakout: return new[] { SpendPlanAttributes.PrioritizationFunding };
                case Mode.Central: return new[] { SpendPlanAttributes.RequirementFunding };
                default: return new[]
                {
                    SpendPlanAttributes.State, SpendPlanAttributes.Fund,
                    SpendPlanAttributes.Sag, SpendPlanAttributes.FiscalYear,
                };
            }
        }

        // ── Rules ────────────────────────────────────────────────────────────

        private static void EnforceUniqueRow(
            IOrganizationService service, Entity target, Mode mode, Resolved resolved,
            EntityReference fcRef, int rowType)
        {
            var query = new QueryExpression(EntityNames.SpendPlan)
            {
                TopCount = 1,
                ColumnSet = new ColumnSet(false),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And),
            };
            foreach (var c in resolved.AnchorConditions)
                query.Criteria.AddCondition(c);
            query.Criteria.AddCondition(SpendPlanAttributes.RowType, ConditionOperator.Equal, rowType);
            query.Criteria.AddCondition(SpendPlanAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            if (mode == Mode.Breakout) // FC is part of the breakout key (nullable)
                query.Criteria.AddCondition(fcRef == null
                    ? new ConditionExpression(SpendPlanAttributes.FundCenter, ConditionOperator.Null)
                    : new ConditionExpression(SpendPlanAttributes.FundCenter, ConditionOperator.Equal, fcRef.Id));

            if (target.Id != Guid.Empty)
                query.Criteria.AddCondition(SpendPlanAttributes.Id, ConditionOperator.NotEqual, target.Id);

            if (service.RetrieveMultiple(query).Entities.Count > 0)
                throw new InvalidPluginExecutionException(
                    "A spend plan row of this type already exists for this anchor — edit the " +
                    "existing row instead of creating another.");
        }

        private void EnforceMonthLocks(
            ITracingService tracing, Entity target, Entity preImage, Resolved resolved, int rowType)
        {
            if (resolved.FiscalYear == null)
            {
                tracing.Trace("Fiscal year unknown; skipping month-lock enforcement.");
                return;
            }

            for (var idx = 0; idx < SpendPlanAttributes.DecimalMonths.Length; idx++)
            {
                var attr = SpendPlanAttributes.DecimalMonths[idx];
                if (!HasAttributeChanged(target, attr))
                    continue;

                var newValue = NumericHelper.ToDecimal(target[attr], 0m);
                var oldValue = preImage != null && preImage.Contains(attr)
                    ? NumericHelper.ToDecimal(preImage[attr], 0m) : 0m;
                if (Math.Abs(newValue - oldValue) < Tolerance)
                    continue;

                var passed = MonthHasPassed(resolved.FiscalYear.Value, idx);
                if (rowType == SpendPlanRowTypeValues.Planned && passed)
                    throw new InvalidPluginExecutionException(
                        $"{MonthLabel(idx)} has already passed for FY {resolved.FiscalYear} — its " +
                        "Planned amount is locked. Record the difference in the Actual row instead.");
                if (rowType == SpendPlanRowTypeValues.Actual && !passed)
                    throw new InvalidPluginExecutionException(
                        $"{MonthLabel(idx)} has not finished yet for FY {resolved.FiscalYear} — Actual " +
                        "amounts can only be entered for completed months.");
            }
        }

        private void EnforcePlannedCap(
            IOrganizationService service, ITracingService tracing,
            Entity target, Entity preImage, IPluginExecutionContext context, Mode mode, Resolved resolved)
        {
            decimal thisRowTotal = SpendPlanAttributes.DecimalMonths
                .Sum(attr => GetEffectiveDecimal(target, preImage, attr));

            var query = new QueryExpression(EntityNames.SpendPlan)
            {
                ColumnSet = new ColumnSet(SpendPlanAttributes.DecimalMonths),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And),
            };
            foreach (var c in resolved.AnchorConditions)
                query.Criteria.AddCondition(c);
            query.Criteria.AddCondition(SpendPlanAttributes.RowType, ConditionOperator.Equal, SpendPlanRowTypeValues.Planned);
            query.Criteria.AddCondition(SpendPlanAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);
            if (context.MessageName == "Update" && target.Id != Guid.Empty)
                query.Criteria.AddCondition(SpendPlanAttributes.Id, ConditionOperator.NotEqual, target.Id);

            decimal siblingTotal = 0m;
            foreach (var sibling in service.RetrieveMultiple(query).Entities)
                foreach (var attr in SpendPlanAttributes.DecimalMonths)
                    siblingTotal += NumericHelper.ToDecimal(sibling.Contains(attr) ? sibling[attr] : null, 0m);

            var total = thisRowTotal + siblingTotal;
            if (total > resolved.Funded + Tolerance)
                throw new InvalidPluginExecutionException(
                    $"Planned spend for {resolved.Label} would total {total:C2}, which exceeds the " +
                    $"funded amount of {resolved.Funded:C2}. Reduce the monthly amounts so the plan " +
                    "does not exceed funding.");
            tracing.Trace($"Planned cap OK: {total} <= {resolved.Funded} (+{Tolerance}).");
        }

        // ── Fiscal-year helpers ──────────────────────────────────────────────

        private static int? ResolveFyViaPrio(IOrganizationService service, EntityReference prioRef)
        {
            if (prioRef == null) return null;
            var prio = service.Retrieve(EntityNames.Prioritization, prioRef.Id,
                new ColumnSet(PrioritizationAttributes.FiscalYear));
            var fy = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FiscalYear)?.Value;
            return fy != null && fy >= 1990 && fy <= 2200 ? fy : null;
        }

        /// <summary>True when the FY month (0 = Oct … 11 = Sep) is fully past.</summary>
        private static bool MonthHasPassed(int fiscalYear, int monthIdx)
        {
            var calYear = monthIdx < 3 ? fiscalYear - 1 : fiscalYear;
            var monthNum = (monthIdx + 9) % 12 + 1;
            var monthEnd = new DateTime(calYear, monthNum, 1).AddMonths(1);
            return DateTime.UtcNow >= monthEnd;
        }

        private static string MonthLabel(int monthIdx)
        {
            string[] labels =
            {
                "October", "November", "December", "January", "February", "March",
                "April", "May", "June", "July", "August", "September",
            };
            return labels[monthIdx];
        }
    }
}
