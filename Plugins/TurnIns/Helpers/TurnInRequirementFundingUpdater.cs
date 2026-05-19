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
    /// Handles the Turn-In items that source funds directly from a Requirement Funding
    /// (no child Prioritization). For each such item:
    ///   - Reduce RF.book_newfundedamount by the item's amount
    ///   - Reduce RF.book_newtdp by the item's amount (TDP shrinks alongside funding)
    ///
    /// Items that have a Prioritization are NOT touched here — those are handled by
    /// TurnInPrioritizationUpdater, and the resulting Prio change cascades up to RF
    /// via the existing PrioritizationRollupToRequirementFunding plugin.
    ///
    /// All math is decimal; NumericHelper covers source-type variance.
    /// </summary>
    public static class TurnInRequirementFundingUpdater
    {
        public static void ApplyRequirementFundingUpdates(
            IOrganizationService service,
            ITracingService tracing,
            List<TurnInItemRecord> items)
        {
            tracing.Trace("TurnInRequirementFundingUpdater: processing RF-only items...");

            // Group RF-only items by RF id so we make exactly one Update per RF.
            var rfTotals = items
                .Where(i => i.IsRFOnly)
                .GroupBy(i => i.RequirementFunding.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            if (rfTotals.Count == 0)
            {
                tracing.Trace("No RF-only items to process.");
                return;
            }

            foreach (var pair in rfTotals)
            {
                var rfId = pair.Key;
                var amount = pair.Value;

                tracing.Trace($"Reducing RF {rfId} by {amount:C} (sum of RF-only item amounts).");

                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    rfId,
                    new ColumnSet(
                        RequirementFundingAttributes.TDP,
                        RequirementFundingAttributes.FundedAmount));

                decimal oldTdp = NumericHelper.ToDecimal(rf, RequirementFundingAttributes.TDP) ?? 0m;
                decimal oldFunded = NumericHelper.ToDecimal(rf, RequirementFundingAttributes.FundedAmount) ?? 0m;

                decimal newTdp = oldTdp - amount;
                decimal newFunded = oldFunded - amount;

                // Floor at zero — the validator should have prevented overdraw, but be defensive.
                if (newTdp < 0m) newTdp = 0m;
                if (newFunded < 0m) newFunded = 0m;

                tracing.Trace($"RF {rfId}: TDP {oldTdp:C} → {newTdp:C}; Funded {oldFunded:C} → {newFunded:C}");

                var update = new Entity(EntityNames.RequirementFunding, rfId);
                update[RequirementFundingAttributes.TDP] = newTdp;
                update[RequirementFundingAttributes.FundedAmount] = newFunded;

                service.Update(update);
            }

            tracing.Trace("TurnInRequirementFundingUpdater: all RF-only updates applied.");
        }
    }
}
