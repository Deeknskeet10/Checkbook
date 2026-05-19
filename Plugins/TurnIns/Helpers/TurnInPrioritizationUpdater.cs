using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Updates each Prioritization used in the Turn-In based on the
    /// amount pulled from it. 
    /// 
    /// Logic pattern aligns with Realignment PA workflow behavior:
    /// - Reduce funded amount (book_newfundedamounttdp)
    /// - Does not rewrite requested amount unless needed externally
    /// 
    /// Only the core essential update is applied here.
    /// </summary>
    public static class TurnInPrioritizationUpdater
    {
        public static void ApplyPrioritizationUpdates(
            IOrganizationService service,
            ITracingService tracing,
            List<TurnInItemRecord> items)
        {
            tracing.Trace("TurnInPrioritizationUpdater: Processing prioritization updates...");

            foreach (var item in items)
            {
                tracing.Trace($"Updating Prioritization {item.Prioritization.Id}, Amount taken = {item.Amount}");

                // Retrieve existing funded amount
                var pri = service.Retrieve(
                    EntityNames.Prioritization,
                    item.Prioritization.Id,
                    new ColumnSet(PrioritizationAttributes.FundedAmountTDP));

                // book_newfundedamounttdp is Decimal in the env; tolerate other source types
                // via NumericHelper while the Decimal-vs-Double migration is in flight.
                decimal oldFunded = NumericHelper.ToDecimal(pri, PrioritizationAttributes.FundedAmountTDP) ?? 0m;
                decimal newFunded = oldFunded - item.Amount;

                if (newFunded < 0m)
                    newFunded = 0m;  // Prevent negative funded amounts

                tracing.Trace($"FundedAmountTDP: {oldFunded} -> {newFunded}");

                // Build update entity — write a plain decimal (column is Decimal, not Money)
                var update = new Entity(EntityNames.Prioritization, item.Prioritization.Id);
                update[PrioritizationAttributes.FundedAmountTDP] = newFunded;

                service.Update(update);
            }

            tracing.Trace("TurnInPrioritizationUpdater: All prioritizations updated.");
        }
    }
}