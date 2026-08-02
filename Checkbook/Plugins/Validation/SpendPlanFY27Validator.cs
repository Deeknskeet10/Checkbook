using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Guards FY27+ spend plan rows (the ones anchored on
    /// book_prioritizationfunding). Enforces:
    ///  1. Shape — a PF-anchored row must not also set book_prioritization
    ///     (that lookup is the legacy one-row-per-Prio shape, protected by the
    ///     book_uniquestatespendplan alternate key).
    ///  2. Uniqueness — one active row per (PF, Fund Center, Row Type); there
    ///     is no alternate key for this because FC is nullable.
    ///  3. Planned cap — active Planned rows under a PF may not total more
    ///     than the PF funded amount. Equality is NOT required here so plans
    ///     can be built up incrementally; the grid surfaces completeness.
    ///  4. Month locks — once a federal FY month has passed, its Planned cell
    ///     is frozen; Actual cells only accept values for passed months.
    /// Legacy rows (no PF lookup) pass through untouched.
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, book_spendplan —
    ///   1. Create (no filter, no images).
    ///   2. Update, filter: book_prioritizationfunding, book_fundcenter,
    ///      book_rowtype, book_prioritization, and the 12 book_new* month
    ///      columns. Pre-image (name "PreImage"): the same attributes plus
    ///      statecode.
    /// </remarks>
    public class SpendPlanFY27Validator : PluginBase
    {
        private const decimal Tolerance = 0.005m;

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
            if (pfRef == null)
            {
                tracing.Trace("No Prioritization Funding anchor; legacy spend plan row — skipping.");
                return;
            }

            var prioRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.Prioritization);
            if (prioRef != null)
            {
                throw new InvalidPluginExecutionException(
                    "FY27+ spend plan rows are anchored by Prioritization Funding only — " +
                    "leave the Prioritization field empty (it is reserved for legacy spend plans).");
            }

            var fcRef = GetEffectiveEntityReference(target, preImage, SpendPlanAttributes.FundCenter);
            var rowType = GetEffectiveOptionSetValue(target, preImage, SpendPlanAttributes.RowType)?.Value
                          ?? SpendPlanRowTypeValues.Planned;

            var anchorsChanged =
                context.MessageName == "Create" ||
                HasAnyAttributeChanged(
                    target,
                    SpendPlanAttributes.PrioritizationFunding,
                    SpendPlanAttributes.FundCenter,
                    SpendPlanAttributes.RowType);

            if (anchorsChanged)
                EnforceUniqueRow(service, target, pfRef, fcRef, rowType);

            var monthsChanged = SpendPlanAttributes.DecimalMonths
                .Any(m => HasAttributeChanged(target, m));

            if (!monthsChanged && !anchorsChanged)
                return;

            // PF funded amount + fiscal year (via the parent Prio) drive the
            // cap and the month locks.
            var pf = service.Retrieve(
                EntityNames.PrioritizationFunding,
                pfRef.Id,
                new ColumnSet(
                    PrioritizationFundingAttributes.FundedAmount,
                    PrioritizationFundingAttributes.Prioritization,
                    PrioritizationFundingAttributes.Name));
            var pfName = pf.GetAttributeValue<string>(PrioritizationFundingAttributes.Name)
                         ?? "this Prioritization Funding row";

            if (monthsChanged)
                EnforceMonthLocks(service, tracing, target, preImage, pf, rowType);

            if (rowType == SpendPlanRowTypeValues.Planned && (monthsChanged || anchorsChanged))
                EnforcePlannedCap(service, tracing, target, preImage, context, pfRef, pf, pfName);
        }

        private static void EnforceUniqueRow(
            IOrganizationService service,
            Entity target,
            EntityReference pfRef,
            EntityReference fcRef,
            int rowType)
        {
            var query = new QueryExpression(EntityNames.SpendPlan)
            {
                TopCount = 1,
                ColumnSet = new ColumnSet(false),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            SpendPlanAttributes.PrioritizationFunding,
                            ConditionOperator.Equal, pfRef.Id),
                        new ConditionExpression(
                            SpendPlanAttributes.RowType,
                            ConditionOperator.Equal, rowType),
                        new ConditionExpression(
                            SpendPlanAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            query.Criteria.AddCondition(
                fcRef == null
                    ? new ConditionExpression(SpendPlanAttributes.FundCenter, ConditionOperator.Null)
                    : new ConditionExpression(SpendPlanAttributes.FundCenter, ConditionOperator.Equal, fcRef.Id));
            if (target.Id != Guid.Empty)
                query.Criteria.AddCondition(
                    SpendPlanAttributes.Id, ConditionOperator.NotEqual, target.Id);

            if (service.RetrieveMultiple(query).Entities.Count > 0)
            {
                throw new InvalidPluginExecutionException(
                    "A spend plan row of this type already exists for this Prioritization Funding " +
                    "and Fund Center — edit the existing row instead of creating another.");
            }
        }

        private void EnforceMonthLocks(
            IOrganizationService service,
            ITracingService tracing,
            Entity target,
            Entity preImage,
            Entity pf,
            int rowType)
        {
            var fiscalYear = ResolveFiscalYear(service, pf);
            if (fiscalYear == null)
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
                    ? NumericHelper.ToDecimal(preImage[attr], 0m)
                    : 0m;
                if (Math.Abs(newValue - oldValue) < Tolerance)
                    continue; // no real change

                var passed = MonthHasPassed(fiscalYear.Value, idx);
                if (rowType == SpendPlanRowTypeValues.Planned && passed)
                {
                    throw new InvalidPluginExecutionException(
                        $"{MonthLabel(idx)} has already passed for FY {fiscalYear} — its Planned " +
                        "amount is locked. Record the difference in the Actual row instead.");
                }
                if (rowType == SpendPlanRowTypeValues.Actual && !passed)
                {
                    throw new InvalidPluginExecutionException(
                        $"{MonthLabel(idx)} has not finished yet for FY {fiscalYear} — Actual " +
                        "amounts can only be entered for completed months.");
                }
            }
        }

        private void EnforcePlannedCap(
            IOrganizationService service,
            ITracingService tracing,
            Entity target,
            Entity preImage,
            IPluginExecutionContext context,
            EntityReference pfRef,
            Entity pf,
            string pfName)
        {
            var funded = NumericHelper.ToDecimal(
                pf.GetAttributeValue<object>(PrioritizationFundingAttributes.FundedAmount), 0m);

            decimal thisRowTotal = 0m;
            foreach (var attr in SpendPlanAttributes.DecimalMonths)
                thisRowTotal += GetEffectiveDecimal(target, preImage, attr);

            decimal siblingTotal = 0m;
            var query = new QueryExpression(EntityNames.SpendPlan)
            {
                ColumnSet = new ColumnSet(SpendPlanAttributes.DecimalMonths),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            SpendPlanAttributes.PrioritizationFunding,
                            ConditionOperator.Equal, pfRef.Id),
                        new ConditionExpression(
                            SpendPlanAttributes.RowType,
                            ConditionOperator.Equal, SpendPlanRowTypeValues.Planned),
                        new ConditionExpression(
                            SpendPlanAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            if (context.MessageName == "Update" && target.Id != Guid.Empty)
                query.Criteria.AddCondition(
                    SpendPlanAttributes.Id, ConditionOperator.NotEqual, target.Id);

            foreach (var sibling in service.RetrieveMultiple(query).Entities)
                foreach (var attr in SpendPlanAttributes.DecimalMonths)
                    siblingTotal += NumericHelper.ToDecimal(
                        sibling.Contains(attr) ? sibling[attr] : null, 0m);

            var total = thisRowTotal + siblingTotal;
            if (total > funded + Tolerance)
            {
                throw new InvalidPluginExecutionException(
                    $"Planned spend for {pfName} would total {total:C2}, which exceeds the " +
                    $"funded amount of {funded:C2}. Reduce the monthly amounts so the plan " +
                    "does not exceed funding.");
            }
            tracing.Trace($"Planned cap OK: {total} <= {funded} (+{Tolerance}).");
        }

        /// <summary>PF → Prio → book_newfiscalyear (option values are the calendar year).</summary>
        private static int? ResolveFiscalYear(IOrganizationService service, Entity pf)
        {
            var prioRef = pf.GetAttributeValue<EntityReference>(
                PrioritizationFundingAttributes.Prioritization);
            if (prioRef == null) return null;

            var prio = service.Retrieve(
                EntityNames.Prioritization,
                prioRef.Id,
                new ColumnSet(PrioritizationAttributes.FiscalYear));
            var fy = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FiscalYear)?.Value;
            return fy != null && fy >= 1990 && fy <= 2200 ? fy : null;
        }

        /// <summary>True when the FY month (0 = Oct … 11 = Sep) is fully past.</summary>
        private static bool MonthHasPassed(int fiscalYear, int monthIdx)
        {
            var calYear = monthIdx < 3 ? fiscalYear - 1 : fiscalYear;
            var monthNum = (monthIdx + 9) % 12 + 1; // 1-based calendar month
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
