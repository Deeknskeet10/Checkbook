using System;
using System.Collections.Generic;
using System.Linq;
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

            // RF-only items have no Prioritization — they are handled by
            // TurnInRequirementFundingUpdater and must be skipped here to avoid NREs.
            // Aggregate by Prio.Id so multiple items pointing at the same Prio
            // result in a single Update with the combined reduction.
            var prioTotals = items
                .Where(i => i.Prioritization != null)
                .GroupBy(i => i.Prioritization.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            if (prioTotals.Count == 0)
            {
                tracing.Trace("No Prio-backed items to process.");
                return;
            }

            foreach (var pair in prioTotals)
            {
                var prioId = pair.Key;
                var amount = pair.Value;

                tracing.Trace($"Updating Prioritization {prioId}, Amount taken = {amount}");

                var pri = service.Retrieve(
                    EntityNames.Prioritization,
                    prioId,
                    new ColumnSet(PrioritizationAttributes.FundedAmountTDP));

                // book_newfundedamounttdp is Decimal in the env; tolerate other source types
                // via NumericHelper while the Decimal-vs-Double migration is in flight.
                decimal oldFunded = NumericHelper.ToDecimal(pri, PrioritizationAttributes.FundedAmountTDP) ?? 0m;
                decimal newFunded = oldFunded - amount;

                if (newFunded < 0m)
                    newFunded = 0m;  // Prevent negative funded amounts

                tracing.Trace($"FundedAmountTDP: {oldFunded} -> {newFunded}");

                var update = new Entity(EntityNames.Prioritization, prioId);
                update[PrioritizationAttributes.FundedAmountTDP] = newFunded;

                service.Update(update);
            }

            tracing.Trace("TurnInPrioritizationUpdater: All prioritizations updated.");
        }
    }
}