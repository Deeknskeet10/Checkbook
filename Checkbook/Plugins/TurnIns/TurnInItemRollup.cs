using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.TurnIns.Helpers;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// FY27+ header totals (docs/TurnIn-FY27-Redesign.md). Keeps book_turnin.book_newamount,
    /// book_afpamount and book_allotmentamount equal to the sums over the Turn-In's active
    /// items, so the header Amount the validator checks against Σ items, and the AFP /
    /// Allotment shown on the form, follow the items (sized by TurnInItemAmountCalculator).
    ///
    /// Post-Operation Sync on book_turninitems Create / Update / Delete. Update filter:
    /// book_newturninamount, book_afpamount, book_allotmentamount, book_turnin, statecode.
    /// PreImage (Update + Delete): book_turnin.
    /// FY26 and Sweep-origin Turn-Ins are left alone (header-entered / sweep-owned amounts).
    /// </summary>
    public class TurnInItemRollup : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.TurnInItems) return;

            var affected = new HashSet<Guid>();
            var preImage = TryGetPreImage(context);
            if (context.MessageName != "Delete")
            {
                var target = GetTarget(context);
                var t = GetEffectiveEntityReference(target, preImage, TurnInItemsAttributes.Turnin);
                if (t != null) affected.Add(t.Id);
            }
            var prev = preImage?.GetAttributeValue<EntityReference>(TurnInItemsAttributes.Turnin);
            if (prev != null) affected.Add(prev.Id);

            foreach (var turnInId in affected)
                Recalculate(service, tracing, turnInId);
        }

        private static void Recalculate(IOrganizationService service, ITracingService tracing, Guid turnInId)
        {
            var turnIn = service.Retrieve(EntityNames.Turnin, turnInId, new ColumnSet(
                TurninAttributes.FiscalYear, TurninAttributes.Origin, TurninAttributes.Amount,
                TurninAttributes.AFPAmount, TurninAttributes.AllotmentAmount, TurninAttributes.StateCode));

            if (!TurnInLOAResolver.IsFy27Plus(turnIn)) return;
            if (turnIn.GetAttributeValue<OptionSetValue>(TurninAttributes.Origin)?.Value == TurnInOriginValues.Sweep) return;
            if (turnIn.GetAttributeValue<OptionSetValue>(TurninAttributes.StateCode)?.Value != StateCodeValues.Active) return;

            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.TurnInItems}'>
                        <attribute name='{TurnInItemsAttributes.Amount}' alias='amount' aggregate='sum'/>
                        <attribute name='{TurnInItemsAttributes.AFPAmount}' alias='afp' aggregate='sum'/>
                        <attribute name='{TurnInItemsAttributes.AllotmentAmount}' alias='allot' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{TurnInItemsAttributes.Turnin}' operator='eq' value='{turnInId}'/>
                            <condition attribute='{TurnInItemsAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                        </filter>
                    </entity>
                </fetch>";
            var row = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            decimal amount = row.Count > 0 ? AliasedValueHelper.GetDecimal(row[0], "amount") : 0m;
            decimal afp = row.Count > 0 ? AliasedValueHelper.GetDecimal(row[0], "afp") : 0m;
            decimal allot = row.Count > 0 ? AliasedValueHelper.GetDecimal(row[0], "allot") : 0m;

            var upd = new Entity(EntityNames.Turnin, turnInId);
            if (Differs(turnIn, TurninAttributes.Amount, amount)) upd[TurninAttributes.Amount] = amount;
            if (Differs(turnIn, TurninAttributes.AFPAmount, afp)) upd[TurninAttributes.AFPAmount] = afp;
            if (Differs(turnIn, TurninAttributes.AllotmentAmount, allot)) upd[TurninAttributes.AllotmentAmount] = allot;
            if (upd.Attributes.Count == 0) return;

            tracing.Trace($"TurnInItemRollup: Turn-In {turnInId} amount={amount:N2} afp={afp:N2} allot={allot:N2}.");
            service.Update(upd);
        }

        private static bool Differs(Entity e, string attr, decimal value)
            => Math.Round(NumericHelper.ToDecimal(e, attr) ?? 0m, 2) != Math.Round(value, 2);
    }
}
