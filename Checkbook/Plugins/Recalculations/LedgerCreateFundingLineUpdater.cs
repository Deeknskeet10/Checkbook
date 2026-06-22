using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// On Ledger Create, recalculates the LOA's TDP / Remaining to reflect
    /// the new debit or credit entry.
    /// </summary>
    public sealed class LedgerCreateFundingLineUpdater : LOATouchPropagator
    {
        protected override string EntityName => EntityNames.Ledger;
        protected override string LoaAttribute => LedgerAttributes.LineOfAccounting;
        protected override bool HandlesMessage(string message) => message == "Create";
    }
}
