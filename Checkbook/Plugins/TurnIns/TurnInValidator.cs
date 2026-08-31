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
    /// Runs on book_turnin Update. Only fires when the Update payload carries an
    /// approval flag = true (book_stateapproved or book_beapproved). Value-based
    /// rather than transition-based so a re-save that re-drives a stuck approval
    /// (see TurnInApprovalPlugin) is validated and role-gated like the original.
    ///
    /// Responsibilities (validation only — execution is in TurnInApprovalPlugin post-op):
    ///   1. Idempotency — block re-approval if ledger entries already exist for this Turn-In.
    ///   2. AFP-only path (book_origin = Sweep with zero items):
    ///        - Header book_newamount must equal 0 (no TDP is moving).
    ///        - Either book_afpamount or book_allotmentamount must be &gt; 0.
    ///        - book_beapproved must be true (matches RequiresBEApprovalRecalc).
    ///   3. Regular (item-bearing) path:
    ///        - Header amount &gt; 0.
    ///        - Sum of item amounts equals header amount.
    ///        - Each item has either a Prioritization or a Requirement Funding (or both).
    ///        - Each item amount does not exceed available funds on its source
    ///          (Prio.book_newfundedamounttdp, or RF.book_newfundedamount when RF-only).
    ///        - State-only rule: a regular geographic-state user (member of a
    ///          "{ABBR} - State Approver/Administrator" owner team, ABBR not PEC/WTC)
    ///          may not turn in RF-only items — every item must carry a Prioritization.
    ///          PEC and WTC are exempt (may turn in RF-only).
    ///        - Approval ordering: RF-only Turn-Ins take a two-step approval (State
    ///          first, then BE). This validator only enforces that a BE-approval save
    ///          has State approval already in place; the RF-only "BE before funds move"
    ///          rule itself is gated in TurnInApprovalPlugin's execution-readiness check
    ///          (State-only approvals are allowed through here so they can route to BE).
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

            // ---- Approval detection (value-based, matches the orchestrator) ----
            // Gate on the payload *carrying* an approval flag = true rather than on
            // a false → true transition. A stuck approval (flag committed while the
            // orchestrator step was disabled or the update was dropped nested) is
            // healed by re-saving the flag — that save must run this validation
            // too, and a transition check would skip it (true → true).
            bool stateApprovedInPayload = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, TurninAttributes.StateApproved);
            bool beApprovedInPayload = ApprovalTransitionDetector.PayloadHasBoolValue(
                target, TurninAttributes.BEApproved);

            if (!stateApprovedInPayload && !beApprovedInPayload)
            {
                tracing.Trace("TurnInValidator: no approval value in payload — skipping.");
                return;
            }

            tracing.Trace(
                $"TurnInValidator: approval value in payload " +
                $"(state={stateApprovedInPayload}, be={beApprovedInPayload})");

            // Effective post-update value of both flags — needed for the
            // approval-routing check at the end of this method.
            bool newStateApproved = GetEffectiveBool(target, preImage, TurninAttributes.StateApproved);
            bool newBeApproved = GetEffectiveBool(target, preImage, TurninAttributes.BEApproved);

            // ---- Role gating ----
            // Table-level privileges let a few State roles (PM, FC Reviewer) update
            // Turn-Ins for editing purposes, but only Approvers/Administrators may
            // actually carry the approval flags. Checkbook Administrators always pass.
            EnforceApprovalRoles(
                service, tracing, context.UserId, stateApprovedInPayload, beApprovedInPayload);

            // ---- Idempotency: have we already created ledgers for this Turn-In? ----
            // Per design choice (Q2 = option C), existence of ledger rows linked back to
            // this Turn-In is the idempotency signal. End users can edit booleans through
            // various data paths (incl. Excel) — ledger existence is the durable side effect.
            if (LedgerIdempotency.HasExistingLedger(service, LedgerAttributes.TurnIn, context.PrimaryEntityId))
            {
                throw new InvalidPluginExecutionException(
                    "This Turn-In has already been processed — ledger entries exist against it. " +
                    "Re-approval is blocked to prevent duplicate financial transactions. " +
                    "If you need to reverse this Turn-In, deactivate the record and create a new one.");
            }

            // Need a merged view to read amount + fund/pg etc. consistently
            var merged = GetMergedEntity(target, preImage);

            // An approval save only carries the approval boolean(s) in Target, so the
            // amount/origin fields below can come *only* from the pre-image. If the
            // registered pre-image is missing any of them (registration drift — e.g. a
            // step registered before book_afpamount/book_allotmentamount were added to
            // the image), reading them from `merged` silently yields 0 and the
            // sweep-origin AFP-only guard misfires on a Turn-In that actually carries a
            // positive AFP amount. Backfill from the database — Pre-Operation runs before
            // the write and this save never touches these columns, so the stored values
            // are the correct effective values. Matches the reduction-lock validators'
            // "falls back to a Retrieve if the image is missing" convention.
            EnsureSweepFields(service, tracing, context.PrimaryEntityId, merged);

            decimal headerAmount = NumericHelper.ToDecimal(merged, TurninAttributes.Amount) ?? 0m;
            int origin = merged.GetAttributeValue<OptionSetValue>(TurninAttributes.Origin)?.Value
                ?? TurnInOriginValues.State;
            bool isSweep = origin == TurnInOriginValues.Sweep;

            // ---- Load items ----
            var items = TurnInItemRepository.GetTurnInItems(service, tracing, context.PrimaryEntityId);

            // ---- AFP-only (Kind B / sweep) path: zero items permitted ----
            // Sweep-created Turn-Ins track an AFP/Allotment over-allocation; no TDP moves,
            // so there are no items and header book_newamount is 0. These are State-level
            // corrections and require State Approval ONLY. BE Approval is reserved for
            // Turn-Ins that move funds with no Prioritization (RF-only items — see the
            // item-bearing path below); a sweep Turn-In has no such items.
            if (items.Count == 0)
            {
                if (!isSweep)
                {
                    throw new InvalidPluginExecutionException(
                        "Turn-In has no Turn-In Items. Add at least one item before approving.");
                }

                if (Math.Round(headerAmount, 2) != 0m)
                {
                    throw new InvalidPluginExecutionException(
                        $"Sweep-origin (AFP-only) Turn-In must have Amount = 0 — no TDP moves on approval. " +
                        $"Current value: {headerAmount:C}");
                }

                decimal afpAmount = NumericHelper.ToDecimal(merged, TurninAttributes.AFPAmount) ?? 0m;
                decimal allotmentAmount = NumericHelper.ToDecimal(merged, TurninAttributes.AllotmentAmount) ?? 0m;
                if (afpAmount <= 0m && allotmentAmount <= 0m)
                {
                    throw new InvalidPluginExecutionException(
                        "Sweep-origin (AFP-only) Turn-In must carry a positive AFP or Allotment amount.");
                }

                // Sweep-origin Turn-Ins are State-approved only — no BE gate. BE Approval
                // applies solely to Turn-Ins that move funds outside a Prioritization
                // (RF-only items), which a zero-item sweep by definition never has.
                if (!newStateApproved)
                {
                    throw new InvalidPluginExecutionException(
                        "State Approval is required before a Turn-In can be processed.");
                }

                tracing.Trace("TurnInValidator: AFP-only sweep Turn-In validations passed.");
                return;
            }

            // ---- Header amount > 0 (item-bearing path) ----
            if (headerAmount <= 0m)
            {
                throw new InvalidPluginExecutionException(
                    $"Turn-In Amount must be greater than zero. Current value: {headerAmount:C}");
            }

            // ---- Sum-of-items equals header ----
            decimal itemSum = items.Sum(i => i.Amount);
            if (Math.Round(itemSum, 2) != Math.Round(headerAmount, 2))
            {
                throw new InvalidPluginExecutionException(
                    $"Turn-In header amount ({headerAmount:C}) does not match sum of item amounts " +
                    $"({itemSum:C}). The two must agree before approval. Please reconcile.");
            }

            // ---- Per-item: amount > 0 ----
            foreach (var item in items)
            {
                if (item.Amount <= 0m)
                {
                    throw new InvalidPluginExecutionException(
                        $"Turn-In Item amount must be greater than zero. Bad item: " +
                        $"Prio={item.Prioritization?.Id.ToString() ?? "(none)"}, " +
                        $"RF={item.RequirementFunding?.Id.ToString() ?? "(none)"}");
                }
            }

            // ---- Per-source availability check (aggregated across items) ----
            // Multiple items can reference the same Prio (or the same RF for RF-only items).
            // Each item in isolation may fit under the source's available amount while the
            // *sum* overdraws it. Aggregate first, then compare to the source once per source.
            ValidateAggregatedAvailability(service, tracing, items);

            // ---- State-only rule: regular states must turn in through a Prioritization ----
            // A geographic-state user (member of a "{ABBR} - State Approver/Administrator"
            // owner team whose ABBR is not PEC/WTC) may not turn in funds sourced directly
            // from a Requirement Funding — every Turn-In Item must carry a Prioritization.
            // PEC and WTC are non-geographic entities and stay exempt (they may turn in
            // RF-only). Checkbook Administrators / Budget Executors hold no such state team
            // and pass. Enforced on the State's approval save (the moment the State submits);
            // a BE approval save re-runs this but the BE user is not a state-team member.
            if (items.Any(i => i.IsRFOnly) &&
                StateTeamHelper.IsRestrictedStateUser(
                    service, tracing, context.UserId, RfOnlyExemptAbbreviations))
            {
                throw new InvalidPluginExecutionException(
                    "A Turn-In submitted by a State must move funds through a Prioritization. " +
                    "One or more items are sourced directly from a Requirement Funding with no " +
                    "Prioritization — add a Prioritization to each Turn-In Item before approving. " +
                    "(Only PEC and WTC may turn in directly from a Requirement Funding.)");
            }

            // ---- Approval routing ----
            // RF-only Turn-Ins (items sourced directly from a Requirement Funding,
            // no Prioritization) take a TWO-STEP approval: the State approves first —
            // which routes the Turn-In to Budget Execution — and BE approves second,
            // each in its own save. Demanding both flags on every approval save
            // deadlocks step one: the State save carries book_stateapproved only, so a
            // "BE approval must also be present" check rejects it, and BE can never
            // reach the record because the State could never route it. (Symmetrically,
            // a BE-first save was rejected for missing State approval — so neither
            // side could move. That was the reported deadlock.)
            //
            // Enforce ordering the way SwapValidator does instead: only when BE
            // approval is being GRANTED in this save do we require State approval to
            // already be effective. A State-only approval is always permitted here and
            // routes the Turn-In to BE. Execution readiness (RF-only => both flags;
            // otherwise State alone) is gated in the post-op orchestrator
            // TurnInApprovalPlugin, which creates ledgers only once the Turn-In is
            // fully approved — so letting the intermediate State approval through here
            // is safe.
            if (beApprovedInPayload && newBeApproved && !newStateApproved)
            {
                throw new InvalidPluginExecutionException(
                    "Budget Execution approval requires State Approval to already be in " +
                    "place. Approve for the State first, then grant Budget Execution approval.");
            }

            tracing.Trace("TurnInValidator: all validations passed.");
        }

        /// <summary>
        /// Non-geographic state abbreviations exempt from the "regular states must
        /// turn in through a Prioritization" rule — PEC and WTC may turn in items
        /// sourced directly from a Requirement Funding. Matched against the leading
        /// abbreviation of the user's "{ABBR} - State Approver/Administrator" owner
        /// team (see <see cref="StateTeamHelper"/>).
        /// </summary>
        private static readonly string[] RfOnlyExemptAbbreviations = { "PEC", "WTC" };

        /// <summary>
        /// Fields the approval-time validation reads that an approval save never
        /// carries in Target (they come only from the pre-image). Backfilled from
        /// the database when the pre-image doesn't supply them.
        /// </summary>
        private static readonly string[] SweepFields =
        {
            TurninAttributes.Amount,
            TurninAttributes.Origin,
            TurninAttributes.AFPAmount,
            TurninAttributes.AllotmentAmount,
        };

        /// <summary>
        /// Guarantees <paramref name="merged"/> contains every field in
        /// <see cref="SweepFields"/>. Any that are absent (pre-image drift) are
        /// retrieved once from the stored record and overlaid — without clobbering
        /// values already present from Target/pre-image. A no-op when the pre-image
        /// is complete, so the happy path issues no extra Retrieve.
        /// </summary>
        private static void EnsureSweepFields(
            IOrganizationService service,
            ITracingService tracing,
            Guid turnInId,
            Entity merged)
        {
            var missing = SweepFields.Where(f => !merged.Contains(f)).ToArray();
            if (missing.Length == 0) return;

            tracing.Trace(
                $"TurnInValidator: pre-image missing [{string.Join(", ", missing)}]; " +
                "retrieving from stored record.");

            var stored = service.Retrieve(
                EntityNames.Turnin, turnInId, new ColumnSet(missing));

            foreach (var field in missing)
            {
                if (stored.Contains(field))
                    merged[field] = stored[field];
            }
        }

        /// <summary>
        /// Blocks approval saves when the caller doesn't hold an appropriate role.
        /// Checkbook Administrators always pass on both sides. A payload-carried
        /// state flag requires State Approver or State Administrator; a
        /// payload-carried BE flag requires the Budget Executor role.
        /// </summary>
        private static void EnforceApprovalRoles(
            IOrganizationService service,
            ITracingService tracing,
            Guid userId,
            bool stateFlagInPayload,
            bool beFlagInPayload)
        {
            if (stateFlagInPayload)
            {
                bool allowed = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.StateApprover, RoleNames.StateAdministrator, RoleNames.CheckbookAdministrator);
                if (!allowed)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the State Approver, State Administrator, or Checkbook " +
                        "Administrator roles may approve a Turn-In for the State.");
                }
            }

            if (beFlagInPayload)
            {
                bool allowed = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.BudgetExecutor, RoleNames.CheckbookAdministrator);
                if (!allowed)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the Budget Executor or Checkbook Administrator roles " +
                        "may grant Budget Execution approval on a Turn-In.");
                }
            }
        }

        /// <summary>
        /// Validates that the sum of item amounts per source does not exceed available funds.
        /// - For items with a Prioritization: aggregate by Prio, compare to Prio.book_newfundedamounttdp.
        /// - For RF-only items: aggregate by RF, compare to RF.book_newfundedamount.
        ///
        /// Aggregating before the check prevents two items on the same source from each fitting
        /// individually while together overdrawing — which the downstream updaters would silently
        /// floor at zero.
        /// </summary>
        private static void ValidateAggregatedAvailability(
            IOrganizationService service,
            ITracingService tracing,
            List<TurnInItemRecord> items)
        {
            // Group Prio-backed items by Prio.Id. RF-only items group separately by RF.Id.
            var prioTotals = items
                .Where(i => i.Prioritization != null)
                .GroupBy(i => i.Prioritization.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            var rfOnlyTotals = items
                .Where(i => i.IsRFOnly)
                .GroupBy(i => i.RequirementFunding.Id)
                .ToDictionary(g => g.Key, g => g.Sum(i => i.Amount));

            // Keep a label per source for nicer error messages (Prio/RF Name when present).
            var prioLabels = items
                .Where(i => i.Prioritization != null)
                .GroupBy(i => i.Prioritization.Id)
                .ToDictionary(
                    g => g.Key,
                    g => g.First().Prioritization.Name ?? g.Key.ToString());

            var rfLabels = items
                .Where(i => i.IsRFOnly)
                .GroupBy(i => i.RequirementFunding.Id)
                .ToDictionary(
                    g => g.Key,
                    g => g.First().RequirementFunding.Name ?? g.Key.ToString());

            foreach (var pair in prioTotals)
            {
                var prioId = pair.Key;
                var requested = pair.Value;

                var prio = service.Retrieve(
                    EntityNames.Prioritization,
                    prioId,
                    new ColumnSet(PrioritizationAttributes.FundedAmountTDP));

                decimal available = NumericHelper.ToDecimal(prio, PrioritizationAttributes.FundedAmountTDP) ?? 0m;

                if (requested > available)
                {
                    throw new InvalidPluginExecutionException(
                        $"Combined Turn-In Item amount ({requested:C}) exceeds available funded amount " +
                        $"({available:C}) on Prioritization {prioLabels[prioId]}.");
                }
                tracing.Trace($"Prio {prioId}: {available:C} available, taking {requested:C} (aggregated).");
            }

            foreach (var pair in rfOnlyTotals)
            {
                var rfId = pair.Key;
                var requested = pair.Value;

                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    rfId,
                    new ColumnSet(RequirementFundingAttributes.FundedAmount));

                decimal available = NumericHelper.ToDecimal(rf, RequirementFundingAttributes.FundedAmount) ?? 0m;

                if (requested > available)
                {
                    throw new InvalidPluginExecutionException(
                        $"Combined Turn-In Item amount ({requested:C}) exceeds available funded amount " +
                        $"({available:C}) on Requirement Funding {rfLabels[rfId]}.");
                }
                tracing.Trace($"RF {rfId}: {available:C} available, taking {requested:C} (aggregated).");
            }
        }
    }
}
