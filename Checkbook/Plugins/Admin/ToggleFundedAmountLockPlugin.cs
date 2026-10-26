using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Admin
{
    /// <summary>
    /// Custom API handler for <c>book_ToggleFundedAmountLock</c>.
    ///
    /// Flips the <c>book_LockManualFundedEdits</c> environment variable value
    /// record. When it's on, <see cref="Validation.RequirementFundingFundedAmountLock"/>,
    /// <see cref="Validation.RequirementDetailFundingFundedAmountLock"/>,
    /// <see cref="Validation.PrioritizationFundingFundedAmountLock"/>,
    /// <see cref="Validation.PrioritizationFundedAmountLock"/>, and
    /// <see cref="Validation.ItemizedDetailFundedAmountLock"/> block direct
    /// reductions of RF Funded Amount, the RD funding junction amount, the FY27
    /// junction amount, the Prio rolled-up funded amount, and itemized detail
    /// funded respectively
    /// (increases stay allowed; RF TDP stays editable down to Funded); when it's off,
    /// direct edits are unrestricted. Backs the "Lock Funding" / "Unlock
    /// Funding" command bar button in the Admin Center MDA.
    /// See <see cref="EnvVarToggleBase"/>.
    /// </summary>
    public class ToggleFundedAmountLockPlugin : EnvVarToggleBase
    {
        protected override string MessageName => "book_ToggleFundedAmountLock";
        protected override string EnvVarSchema => EnvironmentVariableKeys.LockManualFundedEdits;
        protected override string LockLabel => "Funded Amount";
    }
}
