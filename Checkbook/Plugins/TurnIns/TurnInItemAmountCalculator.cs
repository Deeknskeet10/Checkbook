using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.TurnIns.Helpers;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// FY27+ per-item AFP / Allotment sizing (docs/TurnIn-FY27-Redesign.md).
    ///
    /// FY27 Turn-Ins carry no header Fund/PG — one Turn-In may span several Fund/SAGs — so the
    /// header-level TurnInAmountCalculator can't size them. This step sizes each item instead:
    /// item amount × the current AFP / Allotment percentage for the item LOA's (Fund, PG), the
    /// LOA coming from the item's PF junction RF (or the item's own RF for RF-level items).
    /// TurnInItemRollup sums the results onto the header; TurnInDistributionCreator emits one
    /// pair per (Fund, PG) from them.
    ///
    /// Per-item sticky overrides (book_afpoverridden / book_allotmentoverridden) freeze the
    /// corresponding amount at its human-entered value, as on the header for FY26.
    ///
    /// Pre-Operation Sync on book_turninitems Create + Update. Update filter:
    /// book_newturninamount, book_prioritizationfunding, book_requirementfunding, book_turnin,
    /// book_afpoverridden, book_allotmentoverridden; PreImage with the same columns.
    /// FY26 items (parent Turn-In FY ≤ 26) are left alone.
    /// </summary>
    public class TurnInItemAmountCalculator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.TurnInItems) return;
            if (context.MessageName != "Create" && context.MessageName != "Update") return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            var turnInRef = GetEffectiveEntityReference(target, preImage, TurnInItemsAttributes.Turnin);
            if (turnInRef == null) return;

            var turnIn = service.Retrieve(EntityNames.Turnin, turnInRef.Id,
                new ColumnSet(TurninAttributes.FiscalYear, TurninAttributes.Origin));
            if (TurnInRules.IsLegacy(turnIn))
            {
                tracing.Trace("TurnInItemAmountCalculator: FY26 Turn-In — header calculator owns AFP/Allotment.");
                return;
            }

            bool afpOverridden = GetEffectiveBool(target, preImage, TurnInItemsAttributes.AFPOverridden);
            bool allotOverridden = GetEffectiveBool(target, preImage, TurnInItemsAttributes.AllotmentOverridden);
            if (afpOverridden && allotOverridden) return;

            decimal amount = GetEffectiveDecimal(target, preImage, TurnInItemsAttributes.Amount);
            var loa = ResolveItemLoa(service,
                GetEffectiveEntityReference(target, preImage, TurnInItemsAttributes.PrioritizationFunding),
                GetEffectiveEntityReference(target, preImage, TurnInItemsAttributes.RequirementFunding));

            EntityReference fund = null, pg = null;
            if (loa != null)
            {
                var l = service.Retrieve(EntityNames.FundingLine, loa.Id,
                    new ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.PG));
                fund = l.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
                pg = l.GetAttributeValue<EntityReference>(FundingLineAttributes.PG);
            }

            var asOf = DateTime.UtcNow.Date;
            if (!afpOverridden)
                target[TurnInItemsAttributes.AFPAmount] = Size(service, tracing, fund, pg, amount, FundingTypeValues.AFP, asOf);
            if (!allotOverridden)
                target[TurnInItemsAttributes.AllotmentAmount] = Size(service, tracing, fund, pg, amount, FundingTypeValues.Allotment, asOf);
        }

        private static decimal Size(
            IOrganizationService service, ITracingService tracing,
            EntityReference fund, EntityReference pg, decimal amount, int fundingType, DateTime asOf)
        {
            if (fund == null || pg == null || amount <= 0m) return 0m;
            var r = FundingPercentageHelper.Resolve(service, tracing, fund.Id, pg.Id, fundingType, asOf);
            decimal sized = r == null ? 0m : Math.Round(amount * r.Percentage / 100m, 2);
            tracing.Trace($"TurnInItemAmountCalculator: type {fundingType} amount={amount:N2} pct={r?.Percentage} -> {sized:N2}.");
            return sized;
        }

        private static EntityReference ResolveItemLoa(
            IOrganizationService service, EntityReference pf, EntityReference rf)
        {
            if (pf != null)
            {
                var p = service.Retrieve(EntityNames.PrioritizationFunding, pf.Id,
                    new ColumnSet(PrioritizationFundingAttributes.RequirementFunding));
                rf = p.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.RequirementFunding) ?? rf;
            }
            if (rf == null) return null;
            var r = service.Retrieve(EntityNames.RequirementFunding, rf.Id,
                new ColumnSet(RequirementFundingAttributes.LineOfAccounting));
            return r.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
        }
    }
}
