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

            var tdp = GetEffectiveDecimal(target, preImage, TurninAttributes.Amount);
            var fundRef = GetEffectiveEntityReference(target, preImage, TurninAttributes.Fund);
            var pgRef   = GetEffectiveEntityReference(target, preImage, TurninAttributes.PG);

            if (fundRef == null || pgRef == null)
            {
                tracing.Trace("Fund or PG/SAG missing — leaving AFP/Allotment unset; required-field validation will catch.");
                return;
            }

            if (tdp <= 0m)
            {
                target[TurninAttributes.AFPAmount] = 0m;
                target[TurninAttributes.AllotmentAmount] = 0m;
                tracing.Trace("TDP ≤ 0 — AFP and Allotment amounts set to 0.");
                return;
            }

            var asOf = DateTime.UtcNow.Date;

            var afp = FundingPercentageHelper.Resolve(service, tracing, fundRef.Id, pgRef.Id, FundingTypeValues.AFP, asOf);
            var allot = FundingPercentageHelper.Resolve(service, tracing, fundRef.Id, pgRef.Id, FundingTypeValues.Allotment, asOf);

            decimal afpAmount   = afp   == null ? 0m : Math.Round(tdp * afp.Percentage / 100m, 2);
            decimal allotAmount = allot == null ? 0m : Math.Round(tdp * allot.Percentage / 100m, 2);

            target[TurninAttributes.AFPAmount] = afpAmount;
            target[TurninAttributes.AllotmentAmount] = allotAmount;

            tracing.Trace(
                $"TurnInAmountCalculator: TDP={tdp:C} → AFP={afpAmount:C} (pct={afp?.Percentage}), " +
                $"Allotment={allotAmount:C} (pct={allot?.Percentage}).");
        }
    }
}
