using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Existence of any active ledger row linked back to a parent record
    /// (Turn-In, State Swap, ...) is the idempotency signal for that record's
    /// approval pipeline — once ledgers have been written, we never re-process
    /// it. Approval booleans can be toggled through many data paths; ledger
    /// rows are the durable side effect.
    /// </summary>
    public static class LedgerIdempotency
    {
        /// <param name="parentAttribute">The ledger lookup column naming the
        /// parent, e.g. <see cref="LedgerAttributes.TurnIn"/> or
        /// <see cref="LedgerAttributes.StateSwap"/>.</param>
        public static bool HasExistingLedger(
            IOrganizationService service, string parentAttribute, Guid parentId)
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
                            parentAttribute, ConditionOperator.Equal, parentId),
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
