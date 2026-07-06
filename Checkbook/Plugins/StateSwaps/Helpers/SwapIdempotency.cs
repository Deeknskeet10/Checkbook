using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.StateSwaps.Helpers
{
    /// <summary>
    /// Existence of any active ledger row linked back to a State Swap is the
    /// idempotency signal for its approval pipeline — once ledgers have been
    /// written, we never re-process the swap. Approval booleans can be toggled
    /// through many data paths; ledger rows are the durable side effect.
    /// Mirror of <see cref="TurnIns.Helpers.TurnInIdempotency"/>.
    /// </summary>
    public static class SwapIdempotency
    {
        public static bool HasExistingLedger(IOrganizationService service, Guid swapId)
        {
            var query = new QueryExpression(EntityNames.Ledger)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            LedgerAttributes.StateSwap,
                            ConditionOperator.Equal, swapId),
                        new ConditionExpression(
                            LedgerAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            return service.RetrieveMultiple(query).Entities.Count > 0;
        }
    }
}
