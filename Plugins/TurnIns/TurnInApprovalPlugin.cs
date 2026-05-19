using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.TurnIns.Helpers;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// Post-operation orchestrator for an approved Turn-In.
    ///
    /// Fires on book_turnin Update. Detects an approval transition (state or BE going
    /// false → true) and runs the financial side effects in order:
    ///   1. Idempotency guard (existence of any ledger linked to this Turn-In)
    ///   2. Load items (LOA Fund + PG carried on each item for distribution grouping)
    ///   3. Resolve credit LOA
    ///   4. Create ledger entries (debit per LOA, single credit)
    ///   5. Create distributions (debit grouped by Fund/PG, single credit)
    ///   6. Update Prioritizations (items with a Prio)
    ///   7. Update Requirement Fundings directly (items without a Prio — RF-only)
    ///
    /// Validation (header/items math, approval routing) is owned by TurnInValidator
    /// running pre-op on the same Update. By the time this orchestrator runs we trust
    /// the input is valid; the idempotency guard here is the only defensive check.
    /// </summary>
    public class TurnInApprovalPlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            tracing.Trace("TurnInApprovalPlugin started.");

            if (context.PrimaryEntityName != EntityNames.Turnin) return;
            if (context.MessageName != "Update") return;
            if (context.Depth > 1)
            {
                tracing.Trace($"Depth {context.Depth} > 1; skipping to avoid recursion.");
                return;
            }

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            // ---- Approval-transition detection (same logic as the validator) ----
            bool preStateApproved = preImage?.GetAttributeValue<bool?>(TurninAttributes.StateApproved) ?? false;
            bool newStateApproved = target.Contains(TurninAttributes.StateApproved)
                ? target.GetAttributeValue<bool?>(TurninAttributes.StateApproved) ?? preStateApproved
                : preStateApproved;

            bool preBeApproved = preImage?.GetAttributeValue<bool?>(TurninAttributes.BEApproved) ?? false;
            bool newBeApproved = target.Contains(TurninAttributes.BEApproved)
                ? target.GetAttributeValue<bool?>(TurninAttributes.BEApproved) ?? preBeApproved
                : preBeApproved;

            bool stateApprovalTransition = !preStateApproved && newStateApproved
                                           && target.Contains(TurninAttributes.StateApproved);
            bool beApprovalTransition = !preBeApproved && newBeApproved
                                        && target.Contains(TurninAttributes.BEApproved);

            if (!stateApprovalTransition && !beApprovalTransition)
            {
                tracing.Trace("No approval transition — orchestrator does nothing.");
                return;
            }

            // ---- Idempotency: bail if any ledgers already exist for this Turn-In ----
            // Defense-in-depth — the validator should have caught this pre-op, but if
            // the validator step ever gets disabled this guard still prevents duplicates.
            var existingLedgers = service.RetrieveMultiple(new QueryExpression(EntityNames.Ledger)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(LedgerAttributes.TurnIn, ConditionOperator.Equal, context.PrimaryEntityId),
                        new ConditionExpression(LedgerAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    }
                }
            });
            if (existingLedgers.Entities.Count > 0)
            {
                tracing.Trace(
                    "Ledger entries already exist for this Turn-In — orchestrator declines to re-process. " +
                    "(Validator should have blocked the update at pre-op; this is a defensive guard.)");
                return;
            }

            tracing.Trace("Approval transition + clean ledger state — beginning Turn-In processing.");

            var merged = GetMergedEntity(target, preImage);
            Guid turnInId = merged.Id;
            decimal headerAmount = NumericHelper.ToDecimal(merged, TurninAttributes.Amount) ?? 0m;

            // ---- Load items (also resolves LOA.Fund + LOA.PG on each item) ----
            var items = TurnInItemRepository.GetTurnInItems(service, tracing, turnInId);

            // ---- Resolve LOAs for ledger creation ----
            var loaResolution = TurnInLOAResolver.ResolveLOAs(service, tracing, merged, items);

            // Sanity-check: items sum should match header amount (validator already enforces).
            if (Math.Round(loaResolution.TotalAmount, 2) != Math.Round(headerAmount, 2))
            {
                tracing.Trace(
                    $"WARNING: loaResolution.TotalAmount ({loaResolution.TotalAmount:C}) does not match " +
                    $"header amount ({headerAmount:C}). Proceeding with header amount as source of truth.");
            }

            // ---- 1. Ledger entries ----
            tracing.Trace("Creating ledger entries...");
            TurnInLedgerCreator.CreateLedgerEntries(service, tracing, turnInId, loaResolution);

            // ---- 2. Distributions (debit grouped by Fund/PG; one credit) ----
            tracing.Trace("Creating distribution entries...");
            TurnInDistributionCreator.CreateDistributions(service, tracing, merged, items, headerAmount);

            // ---- 3. Update child Prioritizations (items with a Prio) ----
            tracing.Trace("Updating Prioritizations...");
            TurnInPrioritizationUpdater.ApplyPrioritizationUpdates(service, tracing, items);

            // ---- 4. Update Requirement Fundings directly (RF-only items) ----
            tracing.Trace("Updating Requirement Fundings (RF-only items)...");
            TurnInRequirementFundingUpdater.ApplyRequirementFundingUpdates(service, tracing, items);

            tracing.Trace("TurnInApprovalPlugin completed successfully.");
        }
    }
}
