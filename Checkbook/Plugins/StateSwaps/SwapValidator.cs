using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.StateSwaps.Helpers;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Pre-operation validator for book_stateswap Update. Only fires when the
    /// payload carries an approval flag = true (value-based, so a re-save that
    /// re-drives a stuck approval is validated like the original) or a denial
    /// transition is in progress.
    ///
    /// Enforces:
    ///   1. Idempotency — block re-approval if any ledger already links back to this swap.
    ///   2. Role gating — State transitions require State Approver / State Administrator
    ///      / Checkbook Administrator; BE transitions require Budget Executor /
    ///      Checkbook Administrator; denial requires any approver role.
    ///   3. Completeness — every active item must have both Debit Prio and Credit
    ///      Prio populated. (Debit-first drafting is allowed via
    ///      [[SwapItemDerivedFieldsPlugin]]; the pairing must be finished before
    ///      any approval.)
    ///   4. Both sides contribute — book_totalsentbya and book_totalsentbyb must
    ///      each be > 0. Amounts do NOT have to be equal (a state can trade 2-for-1
    ///      if both sides agree). Recomputed live from active items — the stored
    ///      book_isbalanced flag is not trusted here (belt and suspenders).
    ///   5. Overdraw — the sum of item amounts debited from each Prio must not exceed
    ///      that Prio's book_newfundedamounttdp.
    ///   6. BE approval requires both state approvals to be effectively true post-update.
    ///
    /// Denial transitions bypass completeness / balance / overdraw checks — a
    /// denied swap can be incomplete or one-sided.
    ///
    /// Register PreImage 'PreImage' with the full entity (need pre-update values of
    /// all approval + denied flags to detect transitions).
    /// </summary>
    public class SwapValidator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.StateSwap) return;
            if (context.MessageName != "Update") return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            // Approval flags are value-based (payload carries true) so a re-save
            // that re-drives a stuck approval (see SwapApprovalPlugin) is
            // validated and role-gated like the original. Denial stays
            // transition-based — a bare false can't distinguish "denied" from
            // "never approved", and SwapDenialPlugin owns that lifecycle.
            bool stateATx = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, StateSwapAttributes.StateAApproved);
            bool stateBTx = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, StateSwapAttributes.StateBApproved);
            bool beTx = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, StateSwapAttributes.BEApproved);
            bool deniedTx = ApprovalTransitionDetector.DetectBoolTransition(
                target, preImage, StateSwapAttributes.Denied);

            if (!stateATx && !stateBTx && !beTx && !deniedTx)
            {
                tracing.Trace("SwapValidator: no approval value / denial transition — skipping.");
                return;
            }

            tracing.Trace(
                $"SwapValidator: approval/denial detected. stateA={stateATx}, stateB={stateBTx}, " +
                $"be={beTx}, denied={deniedTx}.");

            // ---- 1. Idempotency ----
            if (LedgerIdempotency.HasExistingLedger(service, LedgerAttributes.StateSwap, context.PrimaryEntityId))
            {
                throw new InvalidPluginExecutionException(
                    "This State Swap has already been processed — ledger entries exist against it. " +
                    "Re-approval is blocked to prevent duplicate financial transactions. " +
                    "If the swap needs to be reversed, deactivate the record and create a new one.");
            }

            // Fetch StateA + StateB up front — both the role scope check and the
            // balance check need them.
            var swap = service.Retrieve(
                EntityNames.StateSwap,
                context.PrimaryEntityId,
                new ColumnSet(StateSwapAttributes.StateA, StateSwapAttributes.StateB));
            var stateA = swap.GetAttributeValue<EntityReference>(StateSwapAttributes.StateA);
            var stateB = swap.GetAttributeValue<EntityReference>(StateSwapAttributes.StateB);
            if (stateA == null || stateB == null)
                throw new InvalidPluginExecutionException(
                    "State Swap must have both State A and State B set before it can be approved.");

            // ---- 2. Role gating ----
            EnforceApprovalRoles(
                service, tracing, context.UserId,
                stateATx, stateBTx, beTx, deniedTx,
                stateA, stateB);

            // Denials skip the remaining balance / overdraw / BE-prereq checks —
            // a denial is allowed even on an incomplete swap.
            if (deniedTx && !stateATx && !stateBTx && !beTx)
            {
                tracing.Trace("SwapValidator: denial-only transition; balance/overdraw checks skipped.");
                return;
            }

            // ---- 3. Completeness ----
            // Every active item must have both Debit and Credit Prio set.
            // Debit-first drafting is allowed on Save, but not for approval.
            var incompleteCount = CountItemsMissingCreditPrio(service, context.PrimaryEntityId);
            if (incompleteCount > 0)
            {
                throw new InvalidPluginExecutionException(
                    $"State Swap has {incompleteCount} item(s) missing a Credit Prioritization. " +
                    "Every Swap Item must have both a Debit and a Credit Prioritization before approval.");
            }

            // ---- 4. Both-sides-contribute + 5. Overdraw ----
            // Recompute totals live from Active items — do not trust the stored
            // book_isbalanced flag in case items were changed via a path that
            // bypassed SwapRollupPlugin.

            var perDebitPrio = SumActiveItemsByDebitPrio(service, context.PrimaryEntityId);
            if (perDebitPrio.Count == 0)
                throw new InvalidPluginExecutionException(
                    "State Swap has no active Swap Items. Add at least one item before approving.");

            var perDebitState = perDebitPrio
                .GroupBy(x => x.Value.DebitStateId)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.Value.Amount));

            perDebitState.TryGetValue(stateA.Id, out var totalA);
            perDebitState.TryGetValue(stateB.Id, out var totalB);

            if (totalA <= 0m || totalB <= 0m)
            {
                throw new InvalidPluginExecutionException(
                    $"State Swap requires both states to contribute. State A sends {totalA:C}, " +
                    $"State B sends {totalB:C}. Add at least one item on each side before approval. " +
                    "(Totals do not have to be equal — a state may trade unevenly.)");
            }

            ValidateAggregatedOverdraw(service, tracing, perDebitPrio);

            // ---- 6. BE approval prerequisites ----
            if (beTx)
            {
                bool effStateA = GetEffectiveBool(target, preImage, StateSwapAttributes.StateAApproved);
                bool effStateB = GetEffectiveBool(target, preImage, StateSwapAttributes.StateBApproved);
                if (!effStateA || !effStateB)
                {
                    throw new InvalidPluginExecutionException(
                        "Budget Execution approval requires both State A and State B to " +
                        "have already approved the swap.");
                }
            }

            tracing.Trace("SwapValidator: all validations passed.");
        }

        /// <summary>
        /// Role check per transition kind, scoped to the specific state on state
        /// approval transitions. A user in State X cannot approve for State Y even
        /// if they hold a State Approver role — their BU must match the state's
        /// owning BU. Checkbook Administrators (org-wide) always pass.
        /// </summary>
        private static void EnforceApprovalRoles(
            IOrganizationService service,
            ITracingService tracing,
            Guid userId,
            bool stateATx,
            bool stateBTx,
            bool beTx,
            bool deniedTx,
            EntityReference stateA,
            EntityReference stateB)
        {
            if (stateATx || stateBTx)
            {
                bool hasStateRole = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.StateApprover, RoleNames.StateAdministrator);
                bool isCheckbookAdmin = UserRoleHelper.HasAnyRole(
                    service, tracing, userId, RoleNames.CheckbookAdministrator);
                if (!hasStateRole && !isCheckbookAdmin)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the State Approver, State Administrator, or Checkbook " +
                        "Administrator roles may approve a State Swap for a State.");
                }

                if (!isCheckbookAdmin)
                {
                    if (stateATx && !StateScopeHelper.IsUserInStateBU(service, tracing, userId, stateA))
                    {
                        throw new InvalidPluginExecutionException(
                            "You cannot approve the State A side of this Swap — your account " +
                            "does not belong to State A's business unit.");
                    }
                    if (stateBTx && !StateScopeHelper.IsUserInStateBU(service, tracing, userId, stateB))
                    {
                        throw new InvalidPluginExecutionException(
                            "You cannot approve the State B side of this Swap — your account " +
                            "does not belong to State B's business unit.");
                    }
                }
            }

            if (beTx)
            {
                bool allowed = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.BudgetExecutor, RoleNames.CheckbookAdministrator);
                if (!allowed)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the Budget Executor or Checkbook Administrator roles " +
                        "may grant Budget Execution approval on a State Swap.");
                }
            }

            if (deniedTx)
            {
                bool allowed = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.StateApprover,
                    RoleNames.StateAdministrator,
                    RoleNames.BudgetExecutor,
                    RoleNames.CheckbookAdministrator);
                if (!allowed)
                {
                    throw new InvalidPluginExecutionException(
                        "Only approvers (State Approver, State Administrator, Budget Executor, " +
                        "or Checkbook Administrator) may deny a State Swap.");
                }
            }
        }

        private static int CountItemsMissingCreditPrio(
            IOrganizationService service,
            Guid swapId)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.SwapItem}'>
                        <attribute name='{SwapItemAttributes.Id}' alias='n' aggregate='count'/>
                        <filter type='and'>
                            <condition attribute='{SwapItemAttributes.StateSwap}' operator='eq' value='{swapId}'/>
                            <condition attribute='{SwapItemAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                            <condition attribute='{SwapItemAttributes.CreditPrioritization}' operator='null'/>
                        </filter>
                    </entity>
                </fetch>";
            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            if (rows.Count == 0) return 0;
            var raw = rows[0].GetAttributeValue<AliasedValue>("n")?.Value;
            if (raw is int i) return i;
            return 0;
        }

        private struct DebitBucket { public Guid DebitStateId; public decimal Amount; }

        private static Dictionary<Guid, DebitBucket> SumActiveItemsByDebitPrio(
            IOrganizationService service,
            Guid swapId)
        {
            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.SwapItem}'>
                        <attribute name='{SwapItemAttributes.DebitPrioritization}' alias='debitprio' groupby='true'/>
                        <attribute name='{SwapItemAttributes.DebitState}' alias='debitstate' groupby='true'/>
                        <attribute name='{SwapItemAttributes.Amount}' alias='total' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{SwapItemAttributes.StateSwap}' operator='eq' value='{swapId}'/>
                            <condition attribute='{SwapItemAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                        </filter>
                    </entity>
                </fetch>";

            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            var result = new Dictionary<Guid, DebitBucket>();
            foreach (var row in rows)
            {
                var prioRef = row.GetAttributeValue<AliasedValue>("debitprio")?.Value as EntityReference;
                var stateRef = row.GetAttributeValue<AliasedValue>("debitstate")?.Value as EntityReference;
                var total = NumericHelper.ToDecimal(
                    row.GetAttributeValue<AliasedValue>("total")?.Value, 0m);
                if (prioRef == null || stateRef == null) continue;

                if (result.TryGetValue(prioRef.Id, out var existing))
                {
                    result[prioRef.Id] = new DebitBucket
                    {
                        DebitStateId = existing.DebitStateId,
                        Amount = existing.Amount + total,
                    };
                }
                else
                {
                    result[prioRef.Id] = new DebitBucket
                    {
                        DebitStateId = stateRef.Id,
                        Amount = total,
                    };
                }
            }
            return result;
        }

        private static void ValidateAggregatedOverdraw(
            IOrganizationService service,
            ITracingService tracing,
            Dictionary<Guid, DebitBucket> perDebitPrio)
        {
            foreach (var pair in perDebitPrio)
            {
                var prioId = pair.Key;
                var requested = pair.Value.Amount;

                var prio = service.Retrieve(
                    EntityNames.Prioritization,
                    prioId,
                    new ColumnSet(
                        PrioritizationAttributes.Name,
                        PrioritizationAttributes.FundedAmountTDP));
                decimal available = NumericHelper.ToDecimal(
                    prio, PrioritizationAttributes.FundedAmountTDP) ?? 0m;

                if (requested > available)
                {
                    var label = prio.GetAttributeValue<string>(PrioritizationAttributes.Name)
                                ?? prioId.ToString();
                    throw new InvalidPluginExecutionException(
                        $"Combined Swap Item amount ({requested:C}) exceeds available funded amount " +
                        $"({available:C}) on Prioritization {label}.");
                }
                tracing.Trace(
                    $"SwapValidator: Prio {prioId} has {available:C} available; swap debits {requested:C}.");
            }
        }
    }
}
