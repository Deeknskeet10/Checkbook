using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.Realignments.Helpers;

namespace Checkbook.Plugins.Realignments
{
    /// <summary>
    /// Fully updated Realignment Processor (Ledger-First, Option B, RF.TDP-only credit updates).
    /// Requirements:
    /// • LOA is never updated directly; only ledger entries represent LOA movement.
    /// • Prior validation is performed by RealignmentValidator + SetSameFundSagFlagPlugin.
    /// • Credit RF always increases TDP only (Option 1).
    /// • RF.Funded is NEVER modified for RFs with children (rollup plugin controls parent RF funded).
    /// • RF.Funded is left unchanged for RFs without children (per Option B alignment).
    /// • Prioritization rollup plugin recalculates RF.Funded after prioritization moves.
    /// • Processor only performs execution, not validation.
    /// • Idempotent trigger: fires when the payload carries a decision value and
    ///   the record is still active (deactivation marks "processed"), so bulk
    ///   saves and re-saves of a stuck approval both work. No nesting/Depth
    ///   guard: real-time Business Rules on this table (SetStateApproval,
    ///   LockSameSAGFundField) update the record, so the decision save runs
    ///   nested under a book_realignments Update — an ancestor-walk guard would
    ///   silently drop every approval. Idempotency comes from value+active, and
    ///   the payload-only decision check means only the actual decision write
    ///   processes (see note in ExecutePlugin).
    /// </summary>
    public class RealignmentProcessor : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Realignments)
                return;
            if (context.MessageName != "Update")
                return;

            // NOTE: Do NOT skip when nested inside another book_realignments
            // Update. Real-time Business Rules on this table (Realignments -
            // SetStateApproval, Realignments - LockSameSAGFundField, Mode=1) set
            // fields server-side, which issues a nested book_realignments
            // Update; the user's decision-bearing save runs *inside* that
            // nesting. An IsNestedUpdateOf(...) guard here silently dropped every
            // approval (symptom: "self re-entry — skipping" with nothing else
            // logged and the record never deactivating).
            //
            // No self re-entry guard is needed. FinalizeRealignment writes only
            // statecode/statuscode and this step is filtered on
            // book_newstateapproved/book_bedecision, so Finalize cannot
            // re-trigger the processor. Idempotency is provided by the
            // value-in-payload + record-active checks below; because the
            // decision check reads the Target payload only, the nested
            // business-rule updates (which carry other attributes, not the
            // user's decision write) fall through to "No approval value in
            // payload" without double-processing.

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            decimal amount = GetEffectiveDecimal(target, preImage, RealignmentsAttributes.Amount);

            var debitPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedPrioritization);
            var creditPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedPrioritization);

            var debitRF = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedRequirement);
            var creditRF = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedRequirement);

            var debitLOA = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedLOA);
            var creditLOA = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedLOA);

            bool sameFundSAG = GetEffectiveBool(target, preImage, RealignmentsAttributes.SameFundandSAG);
            bool isPriorPath = debitPrior != null && creditPrior != null;
            bool isRFPath = debitRF != null && creditRF != null;

            // FY27 multi-line: a realignment that carries child book_realignmentitem
            // rows takes its approval shape from the item rollup (all-same-Fund/SAG +
            // entry mode), not the single parent lookups. Legacy FY26 single-row
            // realignments (no items) fall through to the existing path unchanged.
            bool hasItems = HasActiveItems(service, context.PrimaryEntityId);
            if (hasItems)
            {
                var shape = service.Retrieve(EntityNames.Realignments, context.PrimaryEntityId,
                    new ColumnSet(RealignmentsAttributes.AllSameFundSAG, RealignmentsAttributes.EntryMode));
                sameFundSAG = shape.GetAttributeValue<bool>(RealignmentsAttributes.AllSameFundSAG);
                var entryMode = shape.GetAttributeValue<OptionSetValue>(RealignmentsAttributes.EntryMode)?.Value;
                isPriorPath = entryMode == RealignmentEntryModeValues.State;
                isRFPath = !isPriorPath;
                tracing.Trace(
                    $"RealignmentProcessor: item-based realignment (entryMode={(entryMode?.ToString() ?? "null")}, " +
                    $"allSameFundSAG={sameFundSAG}).");
            }


            // =============================================================
            // APPROVAL & DENIAL DETECTION (Choice-Based, value + active)
            // =============================================================
            // Every processed realignment is deactivated in
            // FinalizeRealignment, so an *active* record whose payload carries
            // a decision value is by definition unprocessed. Pre-image
            // edge-detection proved fragile: a decision written while the step
            // was disabled (or the update dropped at depth) sticks, and every
            // later approval is Approved→Approved — invisible to a transition
            // check, with no way out short of deny/reactivate/re-approve.
            // Value + still-active lets any save carrying the value re-drive
            // the stuck record.

            bool recordActive =
                (preImage?.GetAttributeValue<OptionSetValue>("statecode")?.Value
                 ?? StateCodeValues.Active) == StateCodeValues.Active;

            if (!recordActive)
            {
                tracing.Trace("Realignment already inactive (processed) — skipping.");
                return;
            }

            bool stateApprovedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Approved);
            bool stateDeniedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Denied);

            bool beApprovedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Approved);
            bool beDeniedInPayload = ApprovalTransitionDetector.PayloadHasOptionSetValue(
                target, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Denied);

            // ---- Denial → Immediate deactivation ----
            if (stateDeniedInPayload || beDeniedInPayload)
            {
                tracing.Trace("Realignment explicitly denied — auto-deactivating.");
                FinalizeRealignment(service, tracing, context.PrimaryEntityId);
                return;
            }

            // ---- Approval determination ----
            bool newlyApproved;
            if (sameFundSAG && isPriorPath)
            {
                newlyApproved = stateApprovedInPayload;
            }
            else
            {
                newlyApproved = beApprovedInPayload;
            }

            // If no approval value in the payload → user is saving/editing → do nothing
            if (!newlyApproved)
            {
                tracing.Trace("No approval value in payload — skipping processing.");
                return;
            }

            tracing.Trace("RealignmentProcessor: Approved and beginning execution.");

            // FY27 item path: iterate the child items (each a Fund/SAG move) and
            // deactivate. The legacy single-row path below runs only when there
            // are no items.
            if (hasItems)
            {
                // Order matters (see ProcessItems / MovePfJunction):
                //  1) ProcessItems — debit side frees RF/LOA TDP, credit RF.TDP is bumped;
                //     UpsertCreditPf runs only for a Direct credit Prio.
                //  2) ApplyDetailIncreases — raise the crediting Itemized Prio's details, so
                //     PrioritizationItemizedRollup lifts its Prio total and SingleRfAutoAllocate
                //     syncs the credit junction (now within both the raised total and the bumped
                //     RF.TDP). No-op for a Direct credit Prio.
                //  3) ApplyDetailReductions — lower the debiting Itemized Prio's details to match
                //     the junctions the moves already reduced.
                ProcessItems(service, tracing, context);
                ApplyDetailIncreases(service, tracing, context.PrimaryEntityId);
                ApplyDetailReductions(service, tracing, context.PrimaryEntityId);
                FinalizeRealignment(service, tracing, context.PrimaryEntityId);
                return;
            }

            // Note on "is this update happening because of a realignment?" downstream:
            // RequirementFundingTDPValidator detects this by walking context.ParentContext
            // (see IsTriggeredByRealignment there). That ancestor-walk approach replaced
            // an earlier SharedVariables flag. LOA-allocation validation is intentionally
            // skipped while a realignment is mid-flight — the validator runs again after
            // the whole sequence completes and would otherwise see an intermediate state
            // where the debit RF has already been reduced but the credit RF hasn't been
            // increased yet, failing on what is in fact a balanced operation.

            if (debitLOA != null && creditLOA != null && debitLOA.Id != creditLOA.Id)
            {
                tracing.Trace("LOAs differ — creating ledger debit/credit entries first (Ledger-First).");
                LedgerCreator.CreateRealignmentPair(
                    service,
                    tracing,
                    debitLOA,
                    creditLOA,
                    amount,
                    context.PrimaryEntityId);

                // Intermediate recalc: the ledger pair is written but the paired RF
                // move has not happened yet, so the debit LOA transiently shows a
                // reduced remaining. Do not enforce the non-negative guard here — the
                // final recalc below validates the settled state.
                TDPCalculationHelper.RecalculateLOATDP(service, debitLOA.Id, tracing, enforceNonNegative: false);
                TDPCalculationHelper.RecalculateLOATDP(service, creditLOA.Id, tracing, enforceNonNegative: false);
            }

            if (isPriorPath)
            {
                tracing.Trace("Executing Prior→Prior realignment.");
                ExecutePriorToPrior(service, tracing, debitPrior, creditPrior, debitRF, creditRF, debitLOA, creditLOA, amount);
            }
            else if (isRFPath)
            {
                tracing.Trace("Executing RF→RF realignment.");
                ExecuteRFtoRF(service, tracing, debitRF, creditRF, amount);
            }
            /* Recalculate TDP on LOAs after realignments (catch TDP Remaining bug) */
            if (debitLOA != null && creditLOA != null && debitLOA.Id != creditLOA.Id)
            {
                TDPCalculationHelper.RecalculateLOATDP(service, debitLOA.Id, tracing);
                TDPCalculationHelper.RecalculateLOATDP(service, creditLOA.Id, tracing);
            }

            // When the debit and credit LOAs do NOT share the same Fund AND SAG/PG,
            // the money changes buckets, so the debited state must return the debited
            // Fund to A18 and A18 must issue the desired credited Fund back out. Emit
            // the round-trip AFP/Allotment Distributions that record that swap. Same
            // Fund-and-SAG realignments are fungible within one bucket and need none.
            if (!sameFundSAG && (isPriorPath || isRFPath))
            {
                var debitAnchorFc = isPriorPath
                    ? ResolveAnchorFundCenter(service, EntityNames.Prioritization, debitPrior, PrioritizationAttributes.FundCenter)
                    : ResolveRFFundCenter(service, debitRF);
                var creditAnchorFc = isPriorPath
                    ? ResolveAnchorFundCenter(service, EntityNames.Prioritization, creditPrior, PrioritizationAttributes.FundCenter)
                    : ResolveRFFundCenter(service, creditRF);

                RealignmentDistributionCreator.CreateDistributions(
                    service, tracing, context.PrimaryEntityId,
                    debitAnchorFc, creditAnchorFc, debitLOA, creditLOA, amount);
            }

            FinalizeRealignment(service, tracing, context.PrimaryEntityId);
        }

        // ============================================================
        // FY27 multi-line item processing
        // ============================================================

        private static bool HasActiveItems(IOrganizationService service, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return service.RetrieveMultiple(q).Entities.Count > 0;
        }

        private static System.Collections.Generic.List<Entity> GetActiveItems(
            IOrganizationService service, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentItemAttributes.Amount,
                    RealignmentItemAttributes.DebitPrioritizationFunding,
                    RealignmentItemAttributes.DebitRequirementDetailFunding,
                    RealignmentItemAttributes.DebitRequirementFunding,
                    RealignmentItemAttributes.CreditRequirementFunding,
                    RealignmentItemAttributes.SameFundandSAG),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return new System.Collections.Generic.List<Entity>(service.RetrieveMultiple(q).Entities);
        }

        private void ProcessItems(
            IOrganizationService service, ITracingService tracing, IPluginExecutionContext context)
        {
            var realignmentId = context.PrimaryEntityId;
            var realignment = service.Retrieve(EntityNames.Realignments, realignmentId,
                new ColumnSet(RealignmentsAttributes.CreditedPrioritization));
            var creditPrio = realignment.GetAttributeValue<EntityReference>(
                RealignmentsAttributes.CreditedPrioritization);

            // When the crediting Prioritization is Itemized, its PF junctions are
            // owned by the detail roll-up (+ PrioritizationSingleRfAutoAllocate for
            // the single-RF case), NOT by UpsertCreditPf. Crediting then flows as:
            // bump the credit RF.TDP here, raise the credit details afterwards
            // (ApplyDetailIncreases) so the roll-up lifts the Prio total and the
            // single-RF auto-allocate syncs the junction — so we must SKIP
            // UpsertCreditPf for those items (it would double the credit, and
            // raising it before the details are up trips the Σ PF ≤ Prio-total cap).
            bool creditPrioItemized = false;
            if (creditPrio != null)
            {
                var cp = service.Retrieve(EntityNames.Prioritization, creditPrio.Id,
                    new ColumnSet(PrioritizationAttributes.FundingMode));
                creditPrioItemized = cp.GetAttributeValue<OptionSetValue>(
                    PrioritizationAttributes.FundingMode)?.Value == FundingModeValues.Itemized;

                // The single-RF auto-allocate is what re-syncs the itemized credit
                // junction. A multi-RF itemized credit Prio would leave Σ PF short
                // (auto-allocate no-ops) — not supported on this path yet.
                if (creditPrioItemized && CountActivePf(service, creditPrio.Id) > 1)
                    throw new InvalidPluginExecutionException(
                        "Crediting into an itemized Prioritization that already splits across multiple " +
                        "Requirement Fundings is not supported by this realignment path. Use a single-RF " +
                        "credit Prioritization or a direct-funded one.");
            }

            var items = GetActiveItems(service, realignmentId);
            tracing.Trace(
                $"ProcessItems: processing {items.Count} active realignment item(s) " +
                $"(creditPrioItemized={creditPrioItemized}).");
            foreach (var item in items)
                ProcessItem(service, tracing, item, creditPrio, creditPrioItemized, realignmentId);
        }

        private static int CountActivePf(IOrganizationService service, Guid prioId)
        {
            var q = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(false),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(PrioritizationFundingAttributes.Prioritization, ConditionOperator.Equal, prioId),
                        new ConditionExpression(PrioritizationFundingAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return service.RetrieveMultiple(q).Entities.Count;
        }

        /// <summary>
        /// Reduces each selected ItemizedDetail's Funded amount by its
        /// book_realignmentdetailreduction amount. PrioritizationItemizedRollup (no depth
        /// guard) recomputes the parent Prioritization total from the reduced details.
        /// </summary>
        private void ApplyDetailReductions(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentDetailReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentDetailReductionAttributes.Amount,
                    RealignmentDetailReductionAttributes.ItemizedDetail),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentDetailReductionAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentDetailReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rows = service.RetrieveMultiple(q).Entities;
            if (rows.Count == 0) { tracing.Trace("ApplyDetailReductions: no detail reductions on this realignment."); return; }

            foreach (var row in rows)
            {
                var detailRef = row.GetAttributeValue<EntityReference>(RealignmentDetailReductionAttributes.ItemizedDetail);
                decimal reduceBy = row.GetAttributeValue<decimal?>(RealignmentDetailReductionAttributes.Amount) ?? 0m;
                if (detailRef == null || reduceBy <= 0m) continue;

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.FundedAmount));
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                if (reduceBy > funded)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot execute: an Itemized Detail holds {funded:N2} funded but a detail " +
                        $"reduction of {reduceBy:N2} was entered. Re-balance the detail reductions.");

                var upd = new Entity(EntityNames.ItemizedDetails, detailRef.Id);
                upd[ItemizedDetailsAttributes.FundedAmount] = funded - reduceBy;
                service.Update(upd);
                tracing.Trace($"ApplyDetailReductions: ItemizedDetail {detailRef.Id} funded {funded:N2} -> {(funded - reduceBy):N2}.");
            }
        }

        /// <summary>
        /// Credit-side mirror of <see cref="ApplyDetailReductions"/>. Raises each selected
        /// ItemizedDetail's Funded by its book_realignmentdetailincrease amount so the crediting
        /// Itemized Prioritization's total (via PrioritizationItemizedRollup) is already up before
        /// the credit PF upsert. Increases are always allowed by the FundedAmountLock (only
        /// reductions are gated). Validated to balance by RealignmentValidator.EnforceItemizedCreditBalance.
        /// </summary>
        private void ApplyDetailIncreases(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var q = new QueryExpression(RealignmentDetailIncreaseAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentDetailIncreaseAttributes.Amount,
                    RealignmentDetailIncreaseAttributes.ItemizedDetail),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentDetailIncreaseAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentDetailIncreaseAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var rows = service.RetrieveMultiple(q).Entities;
            if (rows.Count == 0) { tracing.Trace("ApplyDetailIncreases: no detail increases on this realignment."); return; }

            foreach (var row in rows)
            {
                var detailRef = row.GetAttributeValue<EntityReference>(RealignmentDetailIncreaseAttributes.ItemizedDetail);
                decimal raiseBy = row.GetAttributeValue<decimal?>(RealignmentDetailIncreaseAttributes.Amount) ?? 0m;
                if (detailRef == null || raiseBy <= 0m) continue;

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.FundedAmount,
                                  ItemizedDetailsAttributes.ValidatedAmount,
                                  ItemizedDetailsAttributes.RequestedAmount));
                decimal funded = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.FundedAmount) ?? 0m;
                decimal validated = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.ValidatedAmount) ?? 0m;
                decimal requested = detail.GetAttributeValue<decimal?>(ItemizedDetailsAttributes.RequestedAmount) ?? 0m;
                decimal newFunded = funded + raiseBy;

                var upd = new Entity(EntityNames.ItemizedDetails, detailRef.Id);
                upd[ItemizedDetailsAttributes.FundedAmount] = newFunded;
                // Funded <= Validated <= ... and Funded <= Requested are enforced upstream
                // (PrioritizationItemizedRollup rolls these to the Prio, which blocks
                // Requested < Funded). Lift Validated and Requested to cover the new Funded
                // (mirrors ExecutePriorToPrior raising the credit's Requested).
                if (validated < newFunded) upd[ItemizedDetailsAttributes.ValidatedAmount] = newFunded;
                if (requested < newFunded) upd[ItemizedDetailsAttributes.RequestedAmount] = newFunded;
                service.Update(upd);
                tracing.Trace($"ApplyDetailIncreases: ItemizedDetail {detailRef.Id} funded {funded:N2} -> {newFunded:N2}.");
            }
        }

        /// <summary>
        /// Executes one Fund/SAG move. The debit source is exactly one of a
        /// Prioritization Funding (State path), a Requirement Detail Funding
        /// (direct path), or a Requirement Funding (plain RF→RF); the credit always
        /// lands on the item's credit RF. Moves the junction amount (and RF.TDP for
        /// cross-RF), creating the ledger pair + A18 distributions for cross-LOA /
        /// cross-Fund-SAG moves. The junction rollups are depth-guarded off at this
        /// depth, so RF/Prio totals are recalculated explicitly.
        /// </summary>
        private void ProcessItem(
            IOrganizationService service, ITracingService tracing,
            Entity item, EntityReference creditPrio, bool creditPrioItemized, Guid realignmentId)
        {
            decimal amount = item.GetAttributeValue<decimal?>(RealignmentItemAttributes.Amount) ?? 0m;
            if (amount <= 0m) { tracing.Trace("Item amount <= 0; skipping."); return; }

            var debitPf = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitPrioritizationFunding);
            var debitRdf = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitRequirementDetailFunding);
            var debitRfDirect = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitRequirementFunding);
            var creditRf = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.CreditRequirementFunding);
            bool sameFundSag = item.GetAttributeValue<bool>(RealignmentItemAttributes.SameFundandSAG);

            if (creditRf == null)
                throw new InvalidPluginExecutionException(
                    "A Realignment Item has no Credit Requirement Funding; cannot execute.");

            EntityReference debitRf;
            EntityReference debitPrio = null;
            EntityReference debitRd = null;
            decimal debitJunctionFunded = 0m;

            if (debitPf != null)
            {
                var pf = service.Retrieve(EntityNames.PrioritizationFunding, debitPf.Id,
                    new ColumnSet(PrioritizationFundingAttributes.RequirementFunding,
                                  PrioritizationFundingAttributes.Prioritization,
                                  PrioritizationFundingAttributes.FundedAmount));
                debitRf = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.RequirementFunding);
                debitPrio = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization);
                debitJunctionFunded = pf.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
            }
            else if (debitRdf != null)
            {
                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, debitRdf.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.RequirementFunding,
                                  RequirementDetailFundingAttributes.RequirementDetail,
                                  RequirementDetailFundingAttributes.FundedAmount));
                debitRf = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
                debitRd = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementDetail);
                debitJunctionFunded = rdf.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
            }
            else if (debitRfDirect != null)
            {
                debitRf = debitRfDirect;
            }
            else
            {
                throw new InvalidPluginExecutionException("A Realignment Item has no debit source; cannot execute.");
            }

            if (debitRf == null)
                throw new InvalidPluginExecutionException(
                    "The Realignment Item's debit source does not resolve to a Requirement Funding.");

            var debitLoa = GetRfLoa(service, debitRf.Id);
            var creditLoa = GetRfLoa(service, creditRf.Id);
            bool crossLoa = debitLoa != null && creditLoa != null && debitLoa.Id != creditLoa.Id;
            bool sameRf = debitRf.Id == creditRf.Id;

            // 1) Ledger-first for cross-LOA; intermediate recalc without enforcement.
            if (crossLoa)
            {
                LedgerCreator.CreateRealignmentPair(service, tracing, debitLoa, creditLoa, amount, realignmentId);
                TDPCalculationHelper.RecalculateLOATDP(service, debitLoa.Id, tracing, enforceNonNegative: false);
                TDPCalculationHelper.RecalculateLOATDP(service, creditLoa.Id, tracing, enforceNonNegative: false);
            }

            // 2) Junction + RF.TDP movement, per debit-unit shape.
            if (debitPf != null)
            {
                MovePfJunction(service, tracing, debitPf, debitJunctionFunded, debitRf, creditPrio, creditRf, amount, sameRf, creditPrioItemized);
                if (debitPrio != null)
                    PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded(service, debitPrio.Id, tracing);
                if (creditPrio != null)
                    PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded(service, creditPrio.Id, tracing);
            }
            else if (debitRdf != null)
            {
                MoveRdfJunction(service, tracing, debitRdf, debitJunctionFunded, debitRd, debitRf, creditRf, amount, sameRf);
            }
            else
            {
                if (!sameRf)
                {
                    ApplyDebitToRF(service, tracing, debitRf, amount, false);
                    ApplyCreditToRF(service, tracing, creditRf, amount);
                }
            }

            // 3) Settle LOA TDP (cross-LOA) with enforcement.
            if (crossLoa)
            {
                TDPCalculationHelper.RecalculateLOATDP(service, debitLoa.Id, tracing);
                TDPCalculationHelper.RecalculateLOATDP(service, creditLoa.Id, tracing);
            }

            // 4) Cross-Fund/SAG: A18 round-trip AFP/Allotment distributions.
            if (!sameFundSag)
            {
                var debitAnchorFc = debitPrio != null
                    ? ResolveAnchorFundCenter(service, EntityNames.Prioritization, debitPrio, PrioritizationAttributes.FundCenter)
                    : ResolveRFFundCenter(service, debitRf);
                var creditAnchorFc = creditPrio != null
                    ? ResolveAnchorFundCenter(service, EntityNames.Prioritization, creditPrio, PrioritizationAttributes.FundCenter)
                    : ResolveRFFundCenter(service, creditRf);

                RealignmentDistributionCreator.CreateDistributions(
                    service, tracing, realignmentId,
                    debitAnchorFc, creditAnchorFc, debitLoa, creditLoa, amount);
            }
        }

        /// <summary>State-path move: debit PF −amount; credit Prio↔creditRF PF +amount.</summary>
        private void MovePfJunction(
            IOrganizationService service, ITracingService tracing,
            EntityReference debitPf, decimal debitPfFunded, EntityReference debitRf,
            EntityReference creditPrio, EntityReference creditRf, decimal amount, bool sameRf,
            bool creditPrioItemized)
        {
            if (creditPrio == null)
                throw new InvalidPluginExecutionException(
                    "A State-path Realignment Item has no Credit Prioritization on the parent Realignment.");

            if (debitPfFunded < amount)
                throw new InvalidPluginExecutionException(
                    $"Realignment cannot execute: the debit Prioritization Funding holds only {debitPfFunded:N2} " +
                    $"but the item moves {amount:N2}.");

            // Free the debit side BEFORE raising the credit side so real TDP headroom
            // always exists for the credit RF.TDP increase (no reliance on the
            // RequirementFundingTDPValidator realignment bypass). For cross-LOA moves
            // the credit LOA's headroom comes from the ledger created in ProcessItem;
            // for same-LOA moves it comes from the debit RF.TDP reduction here.

            // 1. Reduce the debit junction.
            var updDebitPf = new Entity(EntityNames.PrioritizationFunding, debitPf.Id);
            updDebitPf[PrioritizationFundingAttributes.FundedAmount] = debitPfFunded - amount;
            service.Update(updDebitPf);

            if (!sameRf)
            {
                // 2. Lower the debit RF Funded (from the reduced junction) and TDP
                //    together, so the entity-scoped "Funded vs TDP" business rule
                //    never sees Funded > TDP, and the LOA regains `amount` of TDP.
                var debitTdp = GetRfTdp(service, debitRf.Id);
                if (debitTdp < amount)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot execute: the debit Requirement Funding TDP {debitTdp:N2} " +
                        $"is less than the move amount {amount:N2}.");
                var debitUpd = PrioritizationRollupHelper.BuildRFFundedUpdate(service, debitRf.Id, tracing);
                debitUpd[RequirementFundingAttributes.TDP] = debitTdp - amount;
                service.Update(debitUpd);

                // 3. Raise the credit RF.TDP (headroom now exists on its LOA).
                BumpRfTdp(service, tracing, creditRf.Id, amount);
            }

            // 4. Add/raise the credit junction (RF.TDP cap now satisfied) — ONLY for a
            //    Direct credit Prio. For an Itemized credit Prio the junction is owned by
            //    the detail roll-up + SingleRfAutoAllocate: ApplyDetailIncreases (run after
            //    this, once RF.TDP is bumped) raises the details, lifting the Prio total and
            //    syncing the junction. Upserting here would double the credit and, before the
            //    details are raised, breach the Σ PF ≤ Prio-total cap.
            if (!creditPrioItemized)
                UpsertCreditPf(service, tracing, creditPrio, creditRf, amount);
            else
                tracing.Trace("MovePfJunction: itemized credit Prio — deferring credit junction to detail increase + auto-allocate.");

            // 5. Refresh the credit RF funded from its junctions (same RF when in-house).
            //    For the itemized-credit case the authoritative refresh happens when
            //    auto-allocate syncs the junction; this is a harmless pre-pass.
            PrioritizationRollupHelper.RecalculateRFFunded(service, sameRf ? debitRf.Id : creditRf.Id, tracing);
        }

        /// <summary>Direct-path move: debit RDF −amount; same RD ↔ creditRF RDF +amount.</summary>
        private void MoveRdfJunction(
            IOrganizationService service, ITracingService tracing,
            EntityReference debitRdf, decimal debitRdfFunded, EntityReference debitRd,
            EntityReference debitRf, EntityReference creditRf, decimal amount, bool sameRf)
        {
            if (debitRd == null)
                throw new InvalidPluginExecutionException(
                    "A direct-path Realignment Item's debit Requirement Detail Funding has no Requirement Detail.");

            if (debitRdfFunded < amount)
                throw new InvalidPluginExecutionException(
                    $"Realignment cannot execute: the debit Requirement Detail Funding holds only {debitRdfFunded:N2} " +
                    $"but the item moves {amount:N2}.");

            // Free the debit side before raising the credit side (see MovePfJunction).
            // 1. Reduce the debit junction.
            var updDebitRdf = new Entity(EntityNames.RequirementDetailFunding, debitRdf.Id);
            updDebitRdf[RequirementDetailFundingAttributes.FundedAmount] = debitRdfFunded - amount;
            service.Update(updDebitRdf);

            if (!sameRf)
            {
                // 2. Lower debit RF Funded + TDP together (returns `amount` of LOA TDP).
                var debitTdp = GetRfTdp(service, debitRf.Id);
                if (debitTdp < amount)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot execute: the debit Requirement Funding TDP {debitTdp:N2} " +
                        $"is less than the move amount {amount:N2}.");
                var debitUpd = PrioritizationRollupHelper.BuildRFFundedUpdate(service, debitRf.Id, tracing);
                debitUpd[RequirementFundingAttributes.TDP] = debitTdp - amount;
                service.Update(debitUpd);

                // 3. Raise the credit RF.TDP (headroom now exists on its LOA).
                BumpRfTdp(service, tracing, creditRf.Id, amount);
            }

            // 4. Add/raise the credit junction (RF.TDP cap now satisfied).
            UpsertCreditRdf(service, tracing, debitRd, creditRf, amount);

            // 5. Refresh the credit RF funded from its junctions.
            PrioritizationRollupHelper.RecalculateRFFunded(service, sameRf ? debitRf.Id : creditRf.Id, tracing);

            // Refresh the RD display totals (both junctions hang off the same RD).
            RequirementDetailFundingRollupHelper.RecalculateRequirementDetail(service, debitRd.Id, tracing);
        }

        private void UpsertCreditPf(
            IOrganizationService service, ITracingService tracing,
            EntityReference creditPrio, EntityReference creditRf, decimal amount)
        {
            var existing = GetActiveJunction(service, EntityNames.PrioritizationFunding,
                PrioritizationFundingAttributes.Prioritization, creditPrio.Id,
                PrioritizationFundingAttributes.RequirementFunding, creditRf.Id,
                PrioritizationFundingAttributes.StateCode,
                PrioritizationFundingAttributes.FundedAmount, PrioritizationFundingAttributes.ValidatedAmount);

            if (existing != null)
            {
                decimal funded = existing.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m;
                decimal validated = existing.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.ValidatedAmount) ?? 0m;
                decimal newFunded = funded + amount;
                var upd = new Entity(EntityNames.PrioritizationFunding, existing.Id);
                upd[PrioritizationFundingAttributes.FundedAmount] = newFunded;
                if (validated < newFunded) upd[PrioritizationFundingAttributes.ValidatedAmount] = newFunded;
                service.Update(upd);
            }
            else
            {
                var create = new Entity(EntityNames.PrioritizationFunding);
                create[PrioritizationFundingAttributes.Prioritization] = creditPrio;
                create[PrioritizationFundingAttributes.RequirementFunding] = creditRf;
                create[PrioritizationFundingAttributes.FundedAmount] = amount;
                create[PrioritizationFundingAttributes.ValidatedAmount] = amount;
                service.Create(create);
            }
        }

        private void UpsertCreditRdf(
            IOrganizationService service, ITracingService tracing,
            EntityReference creditRd, EntityReference creditRf, decimal amount)
        {
            var existing = GetActiveJunction(service, EntityNames.RequirementDetailFunding,
                RequirementDetailFundingAttributes.RequirementDetail, creditRd.Id,
                RequirementDetailFundingAttributes.RequirementFunding, creditRf.Id,
                RequirementDetailFundingAttributes.StateCode,
                RequirementDetailFundingAttributes.FundedAmount, RequirementDetailFundingAttributes.ValidatedAmount);

            if (existing != null)
            {
                decimal funded = existing.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
                decimal validated = existing.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.ValidatedAmount) ?? 0m;
                decimal newFunded = funded + amount;
                var upd = new Entity(EntityNames.RequirementDetailFunding, existing.Id);
                upd[RequirementDetailFundingAttributes.FundedAmount] = newFunded;
                if (validated < newFunded) upd[RequirementDetailFundingAttributes.ValidatedAmount] = newFunded;
                service.Update(upd);
            }
            else
            {
                var create = new Entity(EntityNames.RequirementDetailFunding);
                create[RequirementDetailFundingAttributes.RequirementDetail] = creditRd;
                create[RequirementDetailFundingAttributes.RequirementFunding] = creditRf;
                create[RequirementDetailFundingAttributes.FundedAmount] = amount;
                create[RequirementDetailFundingAttributes.ValidatedAmount] = amount;
                service.Create(create);
            }
        }

        /// <summary>Returns the single active junction row for a (parentA, parentB) pair, or null.</summary>
        private static Entity GetActiveJunction(
            IOrganizationService service, string entity,
            string parentAAttr, Guid parentAId, string parentBAttr, Guid parentBId,
            string stateCodeAttr, params string[] columns)
        {
            var q = new QueryExpression(entity)
            {
                ColumnSet = new ColumnSet(columns),
                TopCount = 1,
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(parentAAttr, ConditionOperator.Equal, parentAId),
                        new ConditionExpression(parentBAttr, ConditionOperator.Equal, parentBId),
                        new ConditionExpression(stateCodeAttr, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            var r = service.RetrieveMultiple(q);
            return r.Entities.Count > 0 ? r.Entities[0] : null;
        }

        private static EntityReference GetRfLoa(IOrganizationService service, Guid rfId)
        {
            var rf = service.Retrieve(EntityNames.RequirementFunding, rfId,
                new ColumnSet(RequirementFundingAttributes.LineOfAccounting));
            return rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
        }

        private static decimal GetRfTdp(IOrganizationService service, Guid rfId)
        {
            var rf = service.Retrieve(EntityNames.RequirementFunding, rfId,
                new ColumnSet(RequirementFundingAttributes.TDP));
            return rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;
        }

        private static void BumpRfTdp(IOrganizationService service, ITracingService tracing, Guid rfId, decimal delta)
        {
            var tdp = GetRfTdp(service, rfId);
            var upd = new Entity(EntityNames.RequirementFunding, rfId);
            upd[RequirementFundingAttributes.TDP] = tdp + delta;
            service.Update(upd);
            tracing.Trace($"RF {rfId} TDP {tdp:N2} -> {(tdp + delta):N2}.");
        }

        private void ExecutePriorToPrior(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitPrior,
            EntityReference creditPrior,
            EntityReference debitRF,
            EntityReference creditRF,
            EntityReference debitLOA,
            EntityReference creditLOA,
            decimal amount)
        {
            // When the debit and credit sit on the SAME Requirement Funding AND
            // the SAME LOA, the money never leaves the RF or the LOA — it only
            // shifts between two child Prioritizations. The RF debit and RF
            // credit would net to zero on RF.TDP, and the child-sum recalc below
            // already restores RF.Funded, so touching the RF is pure churn (an
            // intermediate TDP dip-and-restore that needlessly trips the
            // "Funded vs TDP" business rule). Skip both RF writes in that case.
            bool sameRfAndLoa =
                debitRF.Id == creditRF.Id &&
                (debitLOA?.Id) == (creditLOA?.Id);

            var debit = service.Retrieve(
                EntityNames.Prioritization,
                debitPrior.Id,
                new ColumnSet(PrioritizationAttributes.FundedAmountTDP));

            decimal fundedDebit = debit.GetAttributeValue<decimal?>(PrioritizationAttributes.FundedAmountTDP) ?? 0m;

            // Do NOT clamp a short debit to zero. If the debit Prioritization no
            // longer holds enough funded amount to cover this realignment, the
            // credit side (below) still posts the full amount and the RF.Funded
            // children-sum recalc launders the shortfall into RF.Funded —
            // creating money and over-funding the RF. This is the over-funding
            // seen when a second realignment drains the source Prioritization
            // between this realignment's authoring and its approval: the source
            // had funds when queued but zero by approval time, and the old
            // clamp swallowed the difference silently. Abort instead so the
            // approver re-sources or lowers the amount.
            if (fundedDebit < amount)
                throw new InvalidPluginExecutionException(
                    $"Realignment cannot be executed: the debited Prioritization holds only {fundedDebit:N2} " +
                    $"but this realignment moves {amount:N2}. The source funding was likely reduced by another " +
                    $"realignment after this one was submitted. Re-source the realignment or lower the amount.");

            decimal newDebitAmount = fundedDebit - amount;

            var updDebit = new Entity(EntityNames.Prioritization, debitPrior.Id);
            updDebit[PrioritizationAttributes.FundedAmountTDP] = newDebitAmount;
            service.Update(updDebit);

            if (!sameRfAndLoa)
            {
                /* Now that Prioritization is debited; debit parent RF */
                ApplyDebitToRF(service, tracing, debitRF, amount, true);

                /* Add credit to credited RF before crediting Prioritization */
                ApplyCreditToRF(service, tracing, creditRF, amount);
            }
            else
            {
                tracing.Trace(
                    "Prior→Prior on same RF and same LOA — funds stay in house; " +
                    "skipping RF debit/credit (net-zero on RF.TDP).");
            }

            var credit = service.Retrieve(
                EntityNames.Prioritization,
                creditPrior.Id,
                new ColumnSet(PrioritizationAttributes.FundedAmountTDP,
                              PrioritizationAttributes.RequestedAmount));

            decimal fundedCredit = credit.GetAttributeValue<decimal?>(PrioritizationAttributes.FundedAmountTDP) ?? 0m;
            decimal requestCredit = credit.GetAttributeValue<decimal?>(PrioritizationAttributes.RequestedAmount) ?? 0m;

            decimal newCreditFunded = fundedCredit + amount;
            if (newCreditFunded > requestCredit)
                requestCredit = newCreditFunded;

            var updCredit = new Entity(EntityNames.Prioritization, creditPrior.Id);
            updCredit[PrioritizationAttributes.FundedAmountTDP] = newCreditFunded;
            updCredit[PrioritizationAttributes.RequestedAmount] = requestCredit;
            service.Update(updCredit);

            // The PrioritizationRollupToRequirementFunding plugin would normally
            // recompute RF.FundedAmount from child Prioritizations whenever a
            // Prioritization is updated, but it early-returns on Depth > 1 and
            // we are at depth 1 here (so its nested invocation is at depth 2).
            // Without these explicit calls, RF.FundedAmount on the credit RF
            // would stay stale and the difference would surface as phantom
            // withhold on the form. ApplyDebitToRF currently also adjusts the
            // debit RF.FundedAmount manually; calling the helper here makes
            // the children-sum the source of truth for both RFs.
            PrioritizationRollupHelper.RecalculateRFFunded(service, debitRF.Id, tracing);
            PrioritizationRollupHelper.RecalculateRFFunded(service, creditRF.Id, tracing);

            tracing.Trace("Prior→Prior funding movement completed.");
        }

        private void ExecuteRFtoRF(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitRF,
            EntityReference creditRF,
            decimal amount)
        {
            tracing.Trace("RF-to-RF: Applying debit logic.");
            ApplyDebitToRF(service, tracing, debitRF, amount, false);

            tracing.Trace("RF-to-RF: Applying credit logic.");
            ApplyCreditToRF(service, tracing, creditRF, amount);
        }

        private void ApplyDebitToRF(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitRFRef,
            decimal amount,
            bool priToPri)
        {
            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                debitRFRef.Id,
                new ColumnSet(RequirementFundingAttributes.FundedAmount,
                              RequirementFundingAttributes.TDP,
                              RequirementFundingAttributes.Withholding));

            decimal funded = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.FundedAmount) ?? 0m;
            decimal tdp = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;
            decimal withhold = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.Withholding) ?? 0m;

            bool hasChildren = RequirementFundingHelpers.HasActiveChildren(service, debitRFRef.Id);

            decimal remaining = amount;

            if (withhold > 0)
            {
                decimal used = Math.Min(withhold, remaining);
                withhold -= used;
                tdp -= used;
                remaining -= used;
                tracing.Trace($"RF Debit: Reduced withholding by {used}. Remaining debit: {remaining}");
            }

            if (remaining > 0)
            {
                if (hasChildren && !priToPri)
                {
                    throw new InvalidPluginExecutionException(
                        "Debited RF has no remaining withholding and has child Prioritizations. Realignment would affect child-funded amounts.");
                }

                // Same conservation rule as the Prio debit above: never clamp a
                // short RF debit to zero. If this leaf RF cannot cover the move,
                // the credit RF still receives its full TDP increase and we would
                // be fabricating funds that do not exist. Abort instead.
                if (remaining > funded || remaining > tdp)
                    throw new InvalidPluginExecutionException(
                        $"Realignment cannot be executed: the debited Requirement Funding holds only " +
                        $"{Math.Min(funded, tdp):N2} available (Funded {funded:N2}, TDP {tdp:N2}) but this " +
                        $"realignment moves {remaining:N2}. The source funding was likely reduced by another " +
                        $"realignment after this one was submitted. Re-source the realignment or lower the amount.");

                tdp -= remaining;
                funded -= remaining;

                remaining = 0;
                tracing.Trace("RF Debit: Reduced leaf-RF TDP and Funded.");
            }

            var upd = new Entity(EntityNames.RequirementFunding, debitRFRef.Id);
            upd[RequirementFundingAttributes.TDP] = tdp;
            upd[RequirementFundingAttributes.FundedAmount] = funded;
            service.Update(upd);

        }

        private void ApplyCreditToRF(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference creditRFRef,
            decimal amount)
        {
            // Credit RF gets an RF.TDP-only increase per the Option-B design (RF.Funded
            // for parent RFs is owned by PrioritizationRollupToRequirementFunding; this
            // processor must not touch it for RFs with children).
            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                creditRFRef.Id,
                new ColumnSet(RequirementFundingAttributes.TDP));

            decimal tdp = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;
            tdp += amount;

            var upd = new Entity(EntityNames.RequirementFunding, creditRFRef.Id);
            upd[RequirementFundingAttributes.TDP] = tdp;
            service.Update(upd);

            tracing.Trace($"RF Credit: TDP increased by {amount:N2} on RF {creditRFRef.Id}.");
        }

        private EntityReference ResolveAnchorFundCenter(
            IOrganizationService service,
            string entityName,
            EntityReference anchorRef,
            string fundCenterAttribute)
        {
            if (anchorRef == null)
                return null;

            var anchor = service.Retrieve(entityName, anchorRef.Id, new ColumnSet(fundCenterAttribute));
            return anchor.GetAttributeValue<EntityReference>(fundCenterAttribute);
        }

        // book_requirementfunding has no book_fundcenter of its own — unlike
        // Prioritization, which carries a backfilled copy. The RF's fund center
        // lives on its parent book_requirement, so hop RF → Requirement →
        // FundCenter to anchor the AFP/Allotment Distributions on an RF→RF move.
        private EntityReference ResolveRFFundCenter(
            IOrganizationService service,
            EntityReference rfRef)
        {
            if (rfRef == null)
                return null;

            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                rfRef.Id,
                new ColumnSet(RequirementFundingAttributes.Requirement));

            var reqRef = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.Requirement);
            if (reqRef == null)
                return null;

            var req = service.Retrieve(
                EntityNames.Requirements,
                reqRef.Id,
                new ColumnSet(RequirementsAttributes.FundCenter));

            return req.GetAttributeValue<EntityReference>(RequirementsAttributes.FundCenter);
        }

        private void FinalizeRealignment(IOrganizationService service, ITracingService tracing, Guid id)
        {
            tracing.Trace("Deactivating realignment.");

            var update = new Entity(EntityNames.Realignments, id);
            update["statecode"] = new OptionSetValue(StateCodeValues.Inactive);
            update["statuscode"] = new OptionSetValue(StatusCodeValues.InactiveDefault);

            service.Update(update);

            tracing.Trace("RealignmentProcessor completed.");
        }
    }
}