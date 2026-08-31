using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// Pre-operation plugin that maintains the derived AFP and Allotment amount
    /// columns on a Kind A Turn-In whenever inputs that affect them change.
    ///
    /// Inputs: book_newamount (TDP being returned), book_fund, book_pg, book_fundcenter.
    /// Outputs (written to target): book_afpamount, book_allotmentamount — sized as
    /// TDP × current percentage from FundingPercentageHelper at the moment of save.
    ///
    /// Manual override: each amount has a sticky flag (book_afpoverridden,
    /// book_allotmentoverridden). When a flag is set, that amount is treated as
    /// human-entered and is left untouched here — it will NOT be re-derived, even
    /// when TDP or Fund/PG change. The two amounts are independent: a state can
    /// pin AFP (e.g. to 0, returning TDP without AFP) while Allotment keeps
    /// self-correcting. Clearing a flag lets auto-sizing resume (the flags are in
    /// the Update step filter, so clearing one retriggers a recompute).
    ///
    /// Skipped when book_origin = Sweep — the GenerateDistributions sweep is the
    /// authoritative writer of AFP/Allotment amounts for Kind B records.
    ///
    /// Fires on Create and Update; the runtime Update filter narrows which Updates
    /// actually invoke us. Reading "effective" values via target ∪ pre-image keeps
    /// behavior correct when only one input changes.
    /// </summary>
    public class TurnInAmountCalculator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Turnin) return;
            if (context.MessageName != "Create" && context.MessageName != "Update") return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            // Skip Kind B — sweep owns these values.
            var origin = GetEffectiveOptionSetValue(target, preImage, TurninAttributes.Origin);
            if (origin?.Value == TurnInOriginValues.Sweep)
            {
                tracing.Trace("Origin=Sweep — calculator does not write AFP/Allotment for sweep records.");
                return;
            }

            // Sticky manual overrides — a set flag freezes that amount at its
            // human-entered value. Read as effective (target ∪ pre-image) so an
            // unrelated update (e.g. a TDP bump) still honors a prior override.
            bool afpOverridden   = GetEffectiveBool(target, preImage, TurninAttributes.AFPOverridden);
            bool allotOverridden = GetEffectiveBool(target, preImage, TurninAttributes.AllotmentOverridden);

            if (afpOverridden && allotOverridden)
            {
                tracing.Trace("Both AFP and Allotment manually overridden — calculator leaves amounts untouched.");
                return;
            }

            var tdp = GetEffectiveDecimal(target, preImage, TurninAttributes.Amount);
            var fundRef = GetEffectiveEntityReference(target, preImage, TurninAttributes.Fund);
            var pgRef   = GetEffectiveEntityReference(target, preImage, TurninAttributes.PG);

            if (fundRef == null || pgRef == null)
            {
                tracing.Trace("Fund or PG/SAG missing — leaving non-overridden AFP/Allotment unset; required-field validation will catch.");
                return;
            }

            if (tdp <= 0m)
            {
                if (!afpOverridden)   target[TurninAttributes.AFPAmount] = 0m;
                if (!allotOverridden) target[TurninAttributes.AllotmentAmount] = 0m;
                tracing.Trace("TDP ≤ 0 — non-overridden AFP/Allotment amounts set to 0.");
                return;
            }

            var asOf = DateTime.UtcNow.Date;

            if (!afpOverridden)
            {
                var afp = FundingPercentageHelper.Resolve(service, tracing, fundRef.Id, pgRef.Id, FundingTypeValues.AFP, asOf);
                decimal afpAmount = afp == null ? 0m : Math.Round(tdp * afp.Percentage / 100m, 2);
                target[TurninAttributes.AFPAmount] = afpAmount;
                tracing.Trace($"TurnInAmountCalculator: TDP={tdp:C} → AFP={afpAmount:C} (pct={afp?.Percentage}).");
            }
            else
            {
                tracing.Trace("AFP manually overridden — leaving book_afpamount untouched.");
            }

            if (!allotOverridden)
            {
                var allot = FundingPercentageHelper.Resolve(service, tracing, fundRef.Id, pgRef.Id, FundingTypeValues.Allotment, asOf);
                decimal allotAmount = allot == null ? 0m : Math.Round(tdp * allot.Percentage / 100m, 2);
                target[TurninAttributes.AllotmentAmount] = allotAmount;
                tracing.Trace($"TurnInAmountCalculator: TDP={tdp:C} → Allotment={allotAmount:C} (pct={allot?.Percentage}).");
            }
            else
            {
                tracing.Trace("Allotment manually overridden — leaving book_allotmentamount untouched.");
            }
        }
    }
}
