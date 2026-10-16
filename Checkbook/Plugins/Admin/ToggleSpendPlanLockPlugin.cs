using Checkbook.Plugins.Constants;

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
    /// in the Admin Center MDA. See <see cref="EnvVarToggleBase"/>.
    /// </summary>
    public class ToggleSpendPlanLockPlugin : EnvVarToggleBase
    {
        protected override string MessageName => "book_ToggleSpendPlanLock";
        protected override string EnvVarSchema => EnvironmentVariableKeys.LockSpendPlanEdits;
        protected override string LockLabel => "Spend Plan";
    }
}
