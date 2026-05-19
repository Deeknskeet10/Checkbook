using System;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.TurnIns.Helpers;

namespace Checkbook.Plugins.TurnIns
{
    /// <summary>
    /// Pre-operation validator for Turn-In approval.
    ///
    /// Runs on book_turnin Update. Only fires when an approval transition is in progress
    /// (book_stateapproved going false→true, or book_beapproved going false→true).
    ///
    /// Responsibilities (validation only — execution is in TurnInApprovalPlugin post-op):
    ///   1. Idempotency — block re-approval if ledger entries already exist for this Turn-In.
    ///   2. Header amount > 0.
    ///   3. Sum of item amounts equals header amount.
    ///   4. Each item has either a Prioritization or a Requirement Funding (or both).
    ///   5. Each item amount does not exceed available funds on its source
    ///      (Prio.book_newfundedamounttdp, or RF.book_newfundedamount when RF-only).
    ///   6. Approval routing: if any item is RF-only (no Prio), book_beapproved must be true.
    ///      Otherwise book_stateapproved is sufficient.
    ///
    /// All failures throw InvalidPluginExecutionException with a user-facing message.
    /// </summary>
    public class TurnInValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Turnin) return;
            if (context.MessageName != "Update") return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            // ---- Approval-transition detection ----
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
                tracing.Trace("TurnInValidator: no approval transition — skipping.");
                return;
            }

            tracing.Trace(
                $"TurnInValidator: approval transition detected " +
                $"(stateTx={stateApprovalTransition}, beTx={beApprovalTransition})");

            // ---- Idempotency: have we already created ledgers for this Turn-In? ----
            // Per design choice (Q2 = option C), existence of ledger rows linked back to
            // this Turn-In is the idempotency signal. End users can edit booleans through
            // various data paths (incl. Excel) — ledger existence is the durable side effect.
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
                throw new InvalidPluginExecutionException(
                    "This Turn-In has already been processed — ledger entries exist against it. " +
                    "Re-approval is blocked to prevent duplicate financial transactions. " +
                    "If you need to reverse this Turn-In, deactivate the record and create a new one.");
            }

            // Need a merged view to read amount + fund/pg etc. consistently
            var merged = GetMergedEntity(target, preImage);

            // ---- Header amount > 0 ----
            decimal headerAmount = NumericHelper.ToDecimal(merged, TurninAttributes.Amount) ?? 0m;
            if (headerAmount <= 0m)
            {
                throw new InvalidPluginExecutionException(
                    $"Turn-In Amount must be greater than zero. Current value: {headerAmount:C}");
            }

            // ---- Load items ----
            var items = TurnInItemRepository.GetTurnInItems(service, tracing, context.PrimaryEntityId);
            if (items.Count == 0)
            {
                throw new InvalidPluginExecutionException(
                    "Turn-In has no Turn-In Items. Add at least one item before approving.");
            }

            // ---- Sum-of-items equals header ----
            decimal itemSum = items.Sum(i => i.Amount);
            if (Math.Round(itemSum, 2) != Math.Round(headerAmount, 2))
            {
                throw new InvalidPluginExecutionException(
                    $"Turn-In header amount ({headerAmount:C}) does not match sum of item amounts " +
                    $"({itemSum:C}). The two must agree before approval. Please reconcile.");
            }

            // ---- Per-item: amount > 0 and ≤ available on the source record ----
            foreach (var item in items)
            {
                if (item.Amount <= 0m)
                {
                    throw new InvalidPluginExecutionException(
                        $"Turn-In Item amount must be greater than zero. Bad item: " +
                        $"Prio={item.Prioritization?.Id.ToString() ?? "(none)"}, " +
                        $"RF={item.RequirementFunding?.Id.ToString() ?? "(none)"}");
                }

                ValidateItemAgainstSource(service, tracing, item);
            }

            // ---- Approval routing ----
            // If any item is RF-only (no Prio attached), BE approval is required in
            // addition to State approval. Otherwise State approval is sufficient.
            bool anyRfOnly = items.Any(i => i.IsRFOnly);

            if (anyRfOnly)
            {
                if (!newBeApproved)
                {
                    throw new InvalidPluginExecutionException(
                        "This Turn-In includes items sourced directly from a Requirement Funding " +
                        "(no Prioritization). Budget Execution Approval is required before this " +
                        "Turn-In can be approved.");
                }
                tracing.Trace("TurnInValidator: RF-only items present; BE Approval required and present.");
            }

            if (!newStateApproved)
            {
                throw new InvalidPluginExecutionException(
                    "State Approval is required before a Turn-In can be processed.");
            }

            tracing.Trace("TurnInValidator: all validations passed.");
        }

        /// <summary>
        /// Validates that an item's amount does not exceed available funds on its source.
        /// - If Prioritization is set: must not exceed Prio.book_newfundedamounttdp.
        /// - Else (RF-only): must not exceed RF.book_newfundedamount.
        /// </summary>
        private static void ValidateItemAgainstSource(
            IOrganizationService service,
            ITracingService tracing,
            TurnInItemRecord item)
        {
            if (item.Prioritization != null)
            {
                var prio = service.Retrieve(
                    EntityNames.Prioritization,
                    item.Prioritization.Id,
                    new ColumnSet(PrioritizationAttributes.FundedAmountTDP));

                decimal available = NumericHelper.ToDecimal(prio, PrioritizationAttributes.FundedAmountTDP) ?? 0m;

                if (item.Amount > available)
                {
                    throw new InvalidPluginExecutionException(
                        $"Turn-In Item amount ({item.Amount:C}) exceeds available funded amount " +
                        $"({available:C}) on Prioritization {item.Prioritization.Name ?? item.Prioritization.Id.ToString()}.");
                }
                tracing.Trace($"Item OK: Prio {item.Prioritization.Id} has {available:C} available, taking {item.Amount:C}.");
            }
            else if (item.RequirementFunding != null)
            {
                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    item.RequirementFunding.Id,
                    new ColumnSet(RequirementFundingAttributes.FundedAmount));

                decimal available = NumericHelper.ToDecimal(rf, RequirementFundingAttributes.FundedAmount) ?? 0m;

                if (item.Amount > available)
                {
                    throw new InvalidPluginExecutionException(
                        $"Turn-In Item amount ({item.Amount:C}) exceeds available funded amount " +
                        $"({available:C}) on Requirement Funding " +
                        $"{item.RequirementFunding.Name ?? item.RequirementFunding.Id.ToString()}.");
                }
                tracing.Trace($"Item OK: RF {item.RequirementFunding.Id} has {available:C} available, taking {item.Amount:C}.");
            }
            // If both are null we already threw in the repository — defensive only.
        }
    }
}
