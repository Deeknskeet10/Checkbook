using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Admin
{
    /// <summary>
    /// Custom API handler for <c>book_ToggleSpendPlanLock</c>.
    ///
    /// Flips the <c>book_LockSpendPlanEdits</c> environment variable value
    /// record. When it is on, <see cref="Validation.SpendPlanEditLockGuard"/>
    /// blocks direct user Create/Update/Delete of book_spendplan rows (the
    /// Planned month values and anchors); when it is off, editing is
    /// unrestricted. Backs the "Spend Plan Lock" / "Unlock" command bar button
    /// in the Admin Center MDA.
    ///
    /// Only users holding <see cref="RoleNames.CheckbookAdministrator"/>
    /// (directly or via a team) may execute this API — enforced here rather
    /// than via the Custom API "Allowed Custom Processing Step Type" so the
    /// error message is readable. Mirrors
    /// <see cref="ToggleFundedAmountLockPlugin"/>.
    ///
    /// Input parameters: none.
    /// Output parameters:
    ///   <c>IsLocked</c> (Boolean) — the toggle state AFTER this call. The
    ///                               button reads this to decide the toast text.
    /// </summary>
    public class ToggleSpendPlanLockPlugin : PluginBase
    {
        private const string MessageName    = "book_ToggleSpendPlanLock";
        private const string OutputIsLocked = "IsLocked";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != MessageName) return;

            if (!UserRoleHelper.HasAnyRole(
                    service, tracing, context.InitiatingUserId,
                    RoleNames.CheckbookAdministrator))
            {
                throw new InvalidPluginExecutionException(
                    $"You must have the '{RoleNames.CheckbookAdministrator}' role " +
                    "to change the Spend Plan lock.");
            }

            var (definitionId, valueRecord, effectiveValue) =
                EnvironmentVariableHelper.GetValueRecord(
                    service, EnvironmentVariableKeys.LockSpendPlanEdits);
            var currentlyLocked = EnvironmentVariableHelper.ParseBool(effectiveValue);
            var nextLocked = !currentlyLocked;
            var nextValue = nextLocked ? "true" : "false";

            if (valueRecord == null)
            {
                var toCreate = new Entity("environmentvariablevalue");
                toCreate["environmentvariabledefinitionid"] = new EntityReference(
                    "environmentvariabledefinition", definitionId);
                toCreate["value"] = nextValue;
                service.Create(toCreate);
                tracing.Trace(
                    $"ToggleSpendPlanLock: created value record → {nextValue}.");
            }
            else
            {
                var toUpdate = new Entity("environmentvariablevalue", valueRecord.Id);
                toUpdate["value"] = nextValue;
                service.Update(toUpdate);
                tracing.Trace(
                    $"ToggleSpendPlanLock: updated value record → {nextValue}.");
            }

            context.OutputParameters[OutputIsLocked] = nextLocked;
        }
    }
}
