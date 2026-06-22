using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Existence of any active ledger row linked to a Turn-In is the
    /// idempotency signal for the approval pipeline — once we've created
    /// ledgers for a Turn-In, we never re-process it. (Booleans like
    /// book_stateapproved can be toggled through many data paths; ledger
    /// rows are the durable side effect.)
    /// </summary>
    public static class TurnInIdempotency
    {
        public static bool HasExistingLedger(IOrganizationService service, Guid turnInId)
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
                            LedgerAttributes.TurnIn,
                            ConditionOperator.Equal, turnInId),
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
