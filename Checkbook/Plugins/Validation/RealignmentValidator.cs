using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-operation gate on book_realignments Update. Fires when an approval or
    /// denial choice value is written to book_newstateapproved / book_bedecision.
    ///
    /// Enforces, in order:
    ///   1. Role gating (the "control" this validator gained when the BPF was
    ///      retired) — a State stage action (approve or deny book_newstateapproved)
    ///      requires State Approver / State Administrator / Checkbook Administrator,
    ///      scoped to the DEBITING state's business unit (unless Checkbook Admin);
    ///      a BE stage action (approve or deny book_bedecision) requires Budget
    ///      Executor / Checkbook Administrator. Modeled on
    ///      <see cref="Checkbook.Plugins.StateSwaps.SwapValidator"/>.EnforceApprovalRoles.
    ///   2. Shape-based prerequisites (unchanged Case 1/2/3) — the right approval
    ///      must be present for the realignment's shape (RF-level vs Prio-to-Prio,
    ///      Same Fund/SAG vs Cross Fund/SAG).
    ///
    /// After the checks pass, stamps the audit fields for each approval that
    /// transitions to Approved this Update (book_newstateapprovedby/on,
    /// book_bedecisionby/on = initiating user + UtcNow). Transition-based so a
    /// re-save that re-drives a stuck approval keeps the original stamp. Denials
    /// carry their reason in book_denialreason (written by the approval PCF); this
    /// validator does not require one.
    ///
    /// Role/scope + stamps are the State-Swap parity work; the money movement and
    /// deactivation still live in RealignmentProcessor (post-op).
    /// </summary>
    public class RealignmentValidator : PluginBase
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

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            // ---- Transition detection (approvals and denials, both fields) ----
            bool stateApprovedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Approved);
            bool stateDeniedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Denied);
            bool beApprovedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Approved);
            bool beDeniedTx = ApprovalTransitionDetector.DetectOptionSetTransition(
                target, preImage, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Denied);

            // RealignmentProcessor executes on value-in-payload + record-active (so a
            // re-save re-drives a stuck approval). The gate must fire on the same
            // condition, or a re-save carrying an already-stored Approved would move
            // money without passing role/shape/balance checks. Stamps below stay
            // transition-based so a re-drive keeps the original approver.
            bool recordActive =
                (preImage?.GetAttributeValue<OptionSetValue>(CommonAttributes.StateCode)?.Value
                 ?? StateCodeValues.Active) == StateCodeValues.Active;
            bool stateApproved = stateApprovedTx || (recordActive &&
                ApprovalTransitionDetector.PayloadHasOptionSetValue(
                    target, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Approved));
            bool stateDenied = stateDeniedTx || (recordActive &&
                ApprovalTransitionDetector.PayloadHasOptionSetValue(
                    target, RealignmentsAttributes.StateApproved, RealignmentBEDecisionValues.Denied));
            bool beApproved = beApprovedTx || (recordActive &&
                ApprovalTransitionDetector.PayloadHasOptionSetValue(
                    target, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Approved));
            bool beDenied = beDeniedTx || (recordActive &&
                ApprovalTransitionDetector.PayloadHasOptionSetValue(
                    target, RealignmentsAttributes.BEDecision, RealignmentBEDecisionValues.Denied));

            // No approval/denial value in the payload — an ordinary edit/save.
            if (!stateApproved && !stateDenied && !beApproved && !beDenied)
            {
                tracing.Trace("No approval/denial value in payload — skipping RealignmentValidator.");
                return;
            }

            // ---- 1. Role gating ----
            // InitiatingUserId, NOT context.UserId: this step runs under the elevated
            // CDS service account. context.UserId is that account — it resolves as an
            // admin (skipping the cross-state BU-scope check below) and belongs to no
            // state BU, so gating on it both rubber-stamps the role and defeats the
            // State-X-cannot-approve-for-State-Y protection. The initiating user is the
            // actual approver. (See plugins-run-as-sysadmin: role checks are about the
            // initiating user, never the execution identity.)
            EnforceApprovalRoles(
                service, tracing, context.InitiatingUserId,
                stateApproved || stateDenied,
                beApproved || beDenied,
                context.PrimaryEntityId);

            // Denials are allowed regardless of shape prerequisites — a denied
            // realignment can be in any state. RealignmentProcessor deactivates it.
            if (stateDenied || beDenied)
            {
                tracing.Trace("Denial — role gate passed; skipping shape prerequisite checks.");
                return;
            }

            // ---- 2. Shape-based prerequisites (unchanged Case 1/2/3) ----
            var sameFundSAG = GetEffectiveBool(target, preImage, RealignmentsAttributes.SameFundandSAG);

            // FY27 multi-line: when the realignment carries child items, the shape
            // comes from the item rollup (all-same-Fund/SAG) + entry mode, not the
            // single parent Prioritization lookups. Legacy single-row realignments
            // keep the lookup-based shape below.
            bool hasItems = HasActiveItems(service, context.PrimaryEntityId);
            bool itemPriorPath = false;
            if (hasItems)
            {
                var shape = service.Retrieve(EntityNames.Realignments, context.PrimaryEntityId,
                    new ColumnSet(RealignmentsAttributes.AllSameFundSAG, RealignmentsAttributes.EntryMode));
                sameFundSAG = shape.GetAttributeValue<bool>(RealignmentsAttributes.AllSameFundSAG);
                itemPriorPath = shape.GetAttributeValue<OptionSetValue>(RealignmentsAttributes.EntryMode)?.Value
                    == RealignmentEntryModeValues.State;

                // FY27 itemized-debit balance (docs/Prioritization-Funding-Reconciliation.md §5):
                // when items pull funding out of PF junctions on an Itemized Prioritization,
                // Σ PF drops below the Prio total; the NPM must reduce selected ItemizedDetails
                // by the same amount so the invariant holds on both sides. Block any approval of
                // an unbalanced itemized-debit realignment. Runs before the stamp; the processor
                // applies the reductions after approval.
                EnforceItemizedDebitBalance(service, tracing, context.PrimaryEntityId);

                // Mirror on the credit side: crediting into an Itemized Prioritization raises its
                // PF junctions, which would push Σ PF above the detail-driven total. The NPM must
                // pick credit details to INCREASE by the same total; the processor raises them
                // before the credit PF upsert so the Prio total is already up.
                EnforceItemizedCreditBalance(service, tracing, context.PrimaryEntityId);

                // OPR (RF→RF) mirror for direct-funded Requirements: the debit RF's
                // Requirement Detail Funding junctions must drop by whatever Withholding
                // cannot cover, and credit-side RD increases may not exceed the landing amount.
                EnforceRdfDebitBalance(service, tracing, context.PrimaryEntityId);
                EnforceRdfCreditBalance(service, tracing, context.PrimaryEntityId);
            }

            int? statePre = preImage?.GetAttributeValue<OptionSetValue>(
                RealignmentsAttributes.StateApproved)?.Value;
            int? statePost = target.Contains(RealignmentsAttributes.StateApproved)
                ? target.GetAttributeValue<OptionSetValue>(RealignmentsAttributes.StateApproved)?.Value
                : statePre;
            bool isStateApproved = statePost == RealignmentBEDecisionValues.Approved;

            var beDecision = GetEffectiveOptionSetValue(target, preImage, RealignmentsAttributes.BEDecision);
            var beDecisionValue = beDecision?.Value;

            var debitPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.DebitedPrioritization);
            var creditPrior = GetEffectiveEntityReference(target, preImage, RealignmentsAttributes.CreditedPrioritization);

            tracing.Trace(
                $"Validator: SameFundSAG={sameFundSAG}, IsStateApproved={isStateApproved}, " +
                $"BEDecisionSet={beDecisionValue != null}, DebitPrior={debitPrior != null}, " +
                $"CreditPrior={creditPrior != null}");

            // If State approves a non-Same SAG/Fund realignment; continue forward
            // until BE Decision (State approval alone cannot finalize it).
            if (stateApproved && !beApproved && !sameFundSAG)
            {
                tracing.Trace("State Approved - Not same SAG or Fund - requires BE Approval.");
                // fall through to the stamp; no prerequisite is violated.
            }
            else
            {
                // Case 1: RF-level realignment (NO prioritizations) — State Approval
                // NOT required; BE Decision IS required. For item-based realignments
                // the shape is the entry mode (OPR → RF-level); for legacy single-row
                // it's the absence of both Prioritization lookups.
                bool isPrioShape = hasItems
                    ? itemPriorPath
                    : (debitPrior != null || creditPrior != null);
                if (!isPrioShape)
                {
                    tracing.Trace("Validator: RF-level realignment detected.");
                    if (beDecisionValue == null)
                    {
                        throw new InvalidPluginExecutionException(
                            "This RF-level realignment requires a BE Decision before it can be executed.");
                    }
                    tracing.Trace("Validator: RF-level BE-approved realignment; approved.");
                }
                else
                {
                    // Case 2: Prioritization-to-Prioritization — State Approval ALWAYS required.
                    if (!isStateApproved)
                    {
                        throw new InvalidPluginExecutionException(
                            "This realignment requires State Approval before it can be executed.");
                    }

                    // Case 3: BE Decision required only when SameFund/SAG = NO.
                    if (!sameFundSAG && beDecisionValue == null)
                    {
                        throw new InvalidPluginExecutionException(
                            "This realignment requires a BE Decision because Fund or SAG changes.");
                    }

                    tracing.Trace("Validator: Prioritization-based realignment fully approved.");
                }
            }

            // ---- Stamp Approved By / On (pre-op target mutation) ----
            // Transition-based so a re-save that re-drives a stuck approval keeps
            // the original stamp; the stamp and the choice value commit together.
            if (stateApprovedTx)
                StampApproval(context, target, tracing,
                    RealignmentsAttributes.StateApprovedBy, RealignmentsAttributes.StateApprovedOn);
            if (beApprovedTx)
                StampApproval(context, target, tracing,
                    RealignmentsAttributes.BEDecisionBy, RealignmentsAttributes.BEDecisionOn);
        }

        private static void StampApproval(
            IPluginExecutionContext context,
            Entity target,
            ITracingService tracing,
            string byAttribute,
            string onAttribute)
        {
            target[byAttribute] = new EntityReference(EntityNames.SystemUser, context.InitiatingUserId);
            target[onAttribute] = DateTime.UtcNow;
            tracing.Trace(
                $"RealignmentValidator: stamped {byAttribute}/{onAttribute} for user {context.InitiatingUserId}.");
        }

        /// <summary>True when the realignment has at least one active child item (FY27).</summary>
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

        private const decimal BalanceEpsilon = 0.005m;

        /// <summary>
        /// Itemized-debit balance gate (FY27 §5). For every active item that debits a
        /// Prioritization Funding whose parent Prioritization is in Itemized funding mode,
        /// the realignment pulls that amount out of the PF junctions — dropping Σ PF below
        /// the Prio's detail-driven total. The NPM must reduce selected ItemizedDetails on
        /// those debit Prioritization(s) by the SAME total (via book_realignmentdetailreduction
        /// child rows) before this can be approved. Enforces
        ///   Σ(active detail reductions)  ==  Σ(item amount for itemized-debit PF items),
        /// and that each reduced detail belongs to one of the realignment's itemized debit
        /// Prioritizations. Direct-mode debit (no details) and RF/RDF debit contribute nothing.
        /// </summary>
        private static void EnforceItemizedDebitBalance(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            // 1. Sum the amount pulled out of Itemized Prioritizations via PF-debit items,
            //    collecting the set of itemized debit Prioritizations.
            var items = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentItemAttributes.Amount,
                    RealignmentItemAttributes.DebitPrioritizationFunding),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(RealignmentItemAttributes.DebitPrioritizationFunding, ConditionOperator.NotNull),
                    },
                },
            };

            decimal itemizedDebit = 0m;
            var itemizedPrios = new System.Collections.Generic.HashSet<Guid>();
            foreach (var item in service.RetrieveMultiple(items).Entities)
            {
                var pfRef = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitPrioritizationFunding);
                if (pfRef == null) continue;

                var pf = service.Retrieve(EntityNames.PrioritizationFunding, pfRef.Id,
                    new ColumnSet(PrioritizationFundingAttributes.Prioritization));
                var prioRef = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization);
                if (prioRef == null) continue;

                var prio = service.Retrieve(EntityNames.Prioritization, prioRef.Id,
                    new ColumnSet(PrioritizationAttributes.FundingMode));
                var mode = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode)?.Value;
                if (mode != FundingModeValues.Itemized) continue;

                itemizedDebit += item.GetAttributeValue<decimal?>(RealignmentItemAttributes.Amount) ?? 0m;
                itemizedPrios.Add(prioRef.Id);
            }

            if (itemizedDebit <= 0m)
            {
                tracing.Trace("RealignmentValidator: no itemized-debit amount; detail-reduction balance not required.");
                return;
            }

            // 2. Sum the active detail reductions and validate their details belong to a debit Prio.
            var reductions = new QueryExpression(RealignmentDetailReductionAttributes.EntityLogicalName)
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

            decimal reduced = 0m;
            foreach (var r in service.RetrieveMultiple(reductions).Entities)
            {
                var detailRef = r.GetAttributeValue<EntityReference>(RealignmentDetailReductionAttributes.ItemizedDetail);
                if (detailRef == null)
                    throw new InvalidPluginExecutionException(
                        "A Realignment Detail Reduction has no Itemized Detail selected.");

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.Prioritization));
                var detailPrio = detail.GetAttributeValue<EntityReference>(ItemizedDetailsAttributes.Prioritization);
                if (detailPrio == null || !itemizedPrios.Contains(detailPrio.Id))
                    throw new InvalidPluginExecutionException(
                        "A selected Itemized Detail does not belong to a Prioritization this realignment debits. " +
                        "Reduce only details on the debiting Prioritization.");

                reduced += r.GetAttributeValue<decimal?>(RealignmentDetailReductionAttributes.Amount) ?? 0m;
            }

            tracing.Trace($"RealignmentValidator: itemized-debit balance — reduced={reduced:N2}, required={itemizedDebit:N2}.");

            if (Math.Abs(reduced - itemizedDebit) >= BalanceEpsilon)
                throw new InvalidPluginExecutionException(
                    $"This realignment pulls {itemizedDebit:N2} out of an itemized Prioritization. Before it can be " +
                    $"approved, select Itemized Details on the debiting Prioritization and reduce them by a total of " +
                    $"{itemizedDebit:N2} (currently {reduced:N2}).");
        }

        /// <summary>
        /// Credit-side mirror of <see cref="EnforceItemizedDebitBalance"/>. All items of a
        /// State-path realignment credit the parent's single crediting Prioritization. When that
        /// Prioritization is Itemized, the credit PF upsert would push Σ PF above its detail-driven
        /// total, so the NPM must INCREASE selected ItemizedDetails on it by the realignment total.
        /// Enforces Σ(active detail increases) == Σ(all active item amounts), and that each increased
        /// detail belongs to the crediting Prioritization. Direct-mode credit needs none.
        /// </summary>
        private static void EnforceItemizedCreditBalance(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var realignment = service.Retrieve(EntityNames.Realignments, realignmentId,
                new ColumnSet(RealignmentsAttributes.CreditedPrioritization));
            var creditPrioRef = realignment.GetAttributeValue<EntityReference>(
                RealignmentsAttributes.CreditedPrioritization);
            if (creditPrioRef == null)
            {
                tracing.Trace("RealignmentValidator: no crediting Prioritization; credit balance not required.");
                return;
            }

            var creditPrio = service.Retrieve(EntityNames.Prioritization, creditPrioRef.Id,
                new ColumnSet(PrioritizationAttributes.FundingMode));
            if (creditPrio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FundingMode)?.Value
                != FundingModeValues.Itemized)
            {
                tracing.Trace("RealignmentValidator: crediting Prioritization is Direct; no detail increases required.");
                return;
            }

            // Target = everything landing on the credit Prio = Σ(all active item amounts).
            var items = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(RealignmentItemAttributes.Amount),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            decimal creditTotal = 0m;
            foreach (var item in service.RetrieveMultiple(items).Entities)
                creditTotal += item.GetAttributeValue<decimal?>(RealignmentItemAttributes.Amount) ?? 0m;

            if (creditTotal <= 0m)
                return;

            var increases = new QueryExpression(RealignmentDetailIncreaseAttributes.EntityLogicalName)
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

            decimal raised = 0m;
            foreach (var r in service.RetrieveMultiple(increases).Entities)
            {
                var detailRef = r.GetAttributeValue<EntityReference>(RealignmentDetailIncreaseAttributes.ItemizedDetail);
                if (detailRef == null)
                    throw new InvalidPluginExecutionException(
                        "A Realignment Detail Increase has no Itemized Detail selected.");

                var detail = service.Retrieve(EntityNames.ItemizedDetails, detailRef.Id,
                    new ColumnSet(ItemizedDetailsAttributes.Prioritization));
                var detailPrio = detail.GetAttributeValue<EntityReference>(ItemizedDetailsAttributes.Prioritization);
                if (detailPrio == null || detailPrio.Id != creditPrioRef.Id)
                    throw new InvalidPluginExecutionException(
                        "A selected Itemized Detail does not belong to the crediting Prioritization. " +
                        "Increase only details on the Prioritization receiving the funds.");

                raised += r.GetAttributeValue<decimal?>(RealignmentDetailIncreaseAttributes.Amount) ?? 0m;
            }

            tracing.Trace($"RealignmentValidator: itemized-credit balance — raised={raised:N2}, required={creditTotal:N2}.");

            if (Math.Abs(raised - creditTotal) >= BalanceEpsilon)
                throw new InvalidPluginExecutionException(
                    $"This realignment adds {creditTotal:N2} to an itemized Prioritization. Before it can be " +
                    $"approved, select Itemized Details on the crediting Prioritization and increase them by a total " +
                    $"of {creditTotal:N2} (currently {raised:N2}).");
        }

        /// <summary>
        /// OPR debit balance gate (FY27 §9.9). An RF→RF item lowers its debit RF the way
        /// RequirementFundingHelper.ApplyDebit does: Withholding first, then Funded + TDP together. On a
        /// direct-funded RF, Funded == Σ active Requirement Detail Funding, so the part of the
        /// move Withholding cannot cover must come out of those junctions. Per debit RF:
        ///   Σ(active RDF reductions on that RF) == max(0, Σ item amount − RF.Withholding)
        /// when the RF has active RDF junctions, and no reductions otherwise. Each reduction
        /// must target an RDF of an RF this realignment debits and not exceed its funded.
        /// A Prioritization-funded debit RF may only give up Withholding.
        /// </summary>
        private static void EnforceRdfDebitBalance(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var items = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentItemAttributes.Amount,
                    RealignmentItemAttributes.DebitRequirementFunding),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(RealignmentItemAttributes.DebitRequirementFunding, ConditionOperator.NotNull),
                    },
                },
            };

            var moved = new System.Collections.Generic.Dictionary<Guid, decimal>();
            foreach (var item in service.RetrieveMultiple(items).Entities)
            {
                var rfRef = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.DebitRequirementFunding);
                decimal amt = item.GetAttributeValue<decimal?>(RealignmentItemAttributes.Amount) ?? 0m;
                moved[rfRef.Id] = (moved.TryGetValue(rfRef.Id, out var m) ? m : 0m) + amt;
            }

            var reductions = new QueryExpression(RealignmentRdfReductionAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentRdfReductionAttributes.Amount,
                    RealignmentRdfReductionAttributes.RequirementDetailFunding),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentRdfReductionAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentRdfReductionAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var reduced = new System.Collections.Generic.Dictionary<Guid, decimal>();
            foreach (var r in service.RetrieveMultiple(reductions).Entities)
            {
                var rdfRef = r.GetAttributeValue<EntityReference>(RealignmentRdfReductionAttributes.RequirementDetailFunding);
                if (rdfRef == null)
                    throw new InvalidPluginExecutionException(
                        "A Realignment RD Funding Reduction has no Requirement Detail Funding selected.");

                decimal amt = r.GetAttributeValue<decimal?>(RealignmentRdfReductionAttributes.Amount) ?? 0m;
                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, rdfRef.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.RequirementFunding,
                                  RequirementDetailFundingAttributes.FundedAmount));
                var rfRef = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
                if (rfRef == null || !moved.ContainsKey(rfRef.Id))
                    throw new InvalidPluginExecutionException(
                        "A selected Requirement Detail Funding is not on a Requirement Funding this realignment debits. " +
                        "Reduce only Requirement Details funded by the debiting Requirement Funding.");

                decimal funded = rdf.GetAttributeValue<decimal?>(RequirementDetailFundingAttributes.FundedAmount) ?? 0m;
                if (amt > funded + BalanceEpsilon)
                    throw new InvalidPluginExecutionException(
                        $"A Requirement Detail Funding holds {funded:N2} funded but a reduction of {amt:N2} was entered.");

                reduced[rfRef.Id] = (reduced.TryGetValue(rfRef.Id, out var x) ? x : 0m) + amt;
            }

            foreach (var kv in moved)
            {
                var rf = service.Retrieve(EntityNames.RequirementFunding, kv.Key,
                    new ColumnSet(RequirementFundingAttributes.Withholding, RequirementFundingAttributes.Name));
                decimal withholding = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.Withholding) ?? 0m;
                bool hasRdf = FundingRollupHelper.SumRequirementDetailFundingForRF(service, kv.Key).funded > 0m;

                // An RF funded through Prioritizations (FY27 PF junctions or FY26 direct
                // links) can only give up Withholding on the OPR path — its Funded belongs to
                // the Prioritizations and moves with a State realignment instead.
                bool prioFunded =
                    FundingRollupHelper.SumPrioritizationFundingForRF(service, kv.Key).funded > 0m ||
                    RequirementFundingHelper.HasActiveChildren(service, kv.Key);
                if (prioFunded && kv.Value > withholding + BalanceEpsilon)
                    throw new InvalidPluginExecutionException(
                        $"{rf.GetAttributeValue<string>(RequirementFundingAttributes.Name)} is funded through Prioritizations, " +
                        $"so this realignment can move at most its Withholding ({withholding:N2}), not {kv.Value:N2}. " +
                        "Use a State realignment to move Prioritization funding.");
                decimal required = hasRdf ? Math.Max(0m, kv.Value - withholding) : 0m;
                decimal got = reduced.TryGetValue(kv.Key, out var g) ? g : 0m;

                tracing.Trace(
                    $"RealignmentValidator: RDF debit balance on RF {kv.Key} — moved={kv.Value:N2}, " +
                    $"withholding={withholding:N2}, required={required:N2}, reduced={got:N2}.");

                if (Math.Abs(got - required) >= BalanceEpsilon)
                    throw new InvalidPluginExecutionException(
                        $"This realignment moves {kv.Value:N2} out of {rf.GetAttributeValue<string>(RequirementFundingAttributes.Name)}, " +
                        $"which has {withholding:N2} in Withholding. Before it can be approved, reduce its Requirement Detail " +
                        $"funding by a total of {required:N2} (currently {got:N2}).");
            }
        }

        /// <summary>
        /// OPR credit gate (FY27 §9.9). Optional Requirement Detail increases on the credit
        /// side fund RD ↔ credit RF junctions from the landing amount. Each row's RD must
        /// belong to its credit RF's Requirement, the RF must be credited by this realignment,
        /// and Σ increases per credit RF may not exceed the amount landing on it (the rest
        /// stays on the RF as Withholding).
        /// </summary>
        private static void EnforceRdfCreditBalance(
            IOrganizationService service, ITracingService tracing, Guid realignmentId)
        {
            var increases = new QueryExpression(RealignmentRdfIncreaseAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentRdfIncreaseAttributes.Amount,
                    RealignmentRdfIncreaseAttributes.RequirementDetail,
                    RealignmentRdfIncreaseAttributes.RequirementFunding),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentRdfIncreaseAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentRdfIncreaseAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            var rows = service.RetrieveMultiple(increases).Entities;
            if (rows.Count == 0) return;

            var items = new QueryExpression(RealignmentItemAttributes.EntityLogicalName)
            {
                ColumnSet = new ColumnSet(
                    RealignmentItemAttributes.Amount,
                    RealignmentItemAttributes.CreditRequirementFunding),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(RealignmentItemAttributes.Realignment, ConditionOperator.Equal, realignmentId),
                        new ConditionExpression(RealignmentItemAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(RealignmentItemAttributes.DebitRequirementFunding, ConditionOperator.NotNull),
                    },
                },
            };
            var landing = new System.Collections.Generic.Dictionary<Guid, decimal>();
            foreach (var item in service.RetrieveMultiple(items).Entities)
            {
                var rfRef = item.GetAttributeValue<EntityReference>(RealignmentItemAttributes.CreditRequirementFunding);
                if (rfRef == null) continue;
                decimal amt = item.GetAttributeValue<decimal?>(RealignmentItemAttributes.Amount) ?? 0m;
                landing[rfRef.Id] = (landing.TryGetValue(rfRef.Id, out var m) ? m : 0m) + amt;
            }

            var raised = new System.Collections.Generic.Dictionary<Guid, decimal>();
            foreach (var r in rows)
            {
                var rdRef = r.GetAttributeValue<EntityReference>(RealignmentRdfIncreaseAttributes.RequirementDetail);
                var rfRef = r.GetAttributeValue<EntityReference>(RealignmentRdfIncreaseAttributes.RequirementFunding);
                if (rdRef == null || rfRef == null)
                    throw new InvalidPluginExecutionException(
                        "A Realignment RD Funding Increase needs both a Requirement Detail and a credit Requirement Funding.");
                if (!landing.ContainsKey(rfRef.Id))
                    throw new InvalidPluginExecutionException(
                        "A Requirement Detail increase targets a Requirement Funding this realignment does not credit.");

                var rd = service.Retrieve(EntityNames.RequirementDetails, rdRef.Id,
                    new ColumnSet(RequirementDetailsAttributes.Requirement));
                var rf = service.Retrieve(EntityNames.RequirementFunding, rfRef.Id,
                    new ColumnSet(RequirementFundingAttributes.Requirement));
                var rdReq = rd.GetAttributeValue<EntityReference>(RequirementDetailsAttributes.Requirement);
                var rfReq = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.Requirement);
                if (rdReq == null || rfReq == null || rdReq.Id != rfReq.Id)
                    throw new InvalidPluginExecutionException(
                        "A Requirement Detail selected for increase does not belong to the credit Requirement Funding's Requirement.");

                decimal amt = r.GetAttributeValue<decimal?>(RealignmentRdfIncreaseAttributes.Amount) ?? 0m;
                raised[rfRef.Id] = (raised.TryGetValue(rfRef.Id, out var x) ? x : 0m) + amt;
            }

            foreach (var kv in raised)
            {
                tracing.Trace($"RealignmentValidator: RDF credit on RF {kv.Key} — raised={kv.Value:N2}, landing={landing[kv.Key]:N2}.");
                if (kv.Value > landing[kv.Key] + BalanceEpsilon)
                    throw new InvalidPluginExecutionException(
                        $"Requirement Detail increases total {kv.Value:N2} but only {landing[kv.Key]:N2} lands on that " +
                        "Requirement Funding. Lower the increases.");
            }
        }

        /// <summary>
        /// Stage-ownership role gate. A State stage action (approve or deny
        /// book_newstateapproved) requires a State role scoped to the debiting
        /// state's BU; a BE stage action (approve or deny book_bedecision)
        /// requires the Budget Executor role. Checkbook Administrators bypass both
        /// the role and the BU scope.
        /// </summary>
        private static void EnforceApprovalRoles(
            IOrganizationService service,
            ITracingService tracing,
            Guid userId,
            bool stateStageAction,
            bool beStageAction,
            Guid realignmentId)
        {
            bool isCheckbookAdmin = UserRoleHelper.HasAnyRole(
                service, tracing, userId, RoleNames.CheckbookAdministrator);

            if (stateStageAction)
            {
                bool hasStateRole = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.StateApprover, RoleNames.StateAdministrator);
                if (!hasStateRole && !isCheckbookAdmin)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the State Approver, State Administrator, or Checkbook " +
                        "Administrator roles may act on the State Approval of a Realignment.");
                }

                if (!isCheckbookAdmin)
                {
                    var debitState = ResolveDebitingState(service, tracing, realignmentId);
                    if (debitState != null &&
                        !StateMembershipHelper.IsUserInStateBU(service, tracing, userId, debitState))
                    {
                        throw new InvalidPluginExecutionException(
                            "You cannot act on the State Approval of this Realignment — your account " +
                            "does not belong to the debiting state's business unit.");
                    }
                    if (debitState == null)
                    {
                        // No debiting Prioritization to scope by (RF-level or
                        // unset). State approval is anomalous on that shape; the
                        // role check above still applies, BU scope is skipped.
                        tracing.Trace(
                            "RealignmentValidator: no debiting state resolved; BU scope skipped for State stage.");
                    }
                }
            }

            if (beStageAction)
            {
                bool allowed = UserRoleHelper.HasAnyRole(
                    service, tracing, userId,
                    RoleNames.BudgetExecutor, RoleNames.CheckbookAdministrator);
                if (!allowed)
                {
                    throw new InvalidPluginExecutionException(
                        "Only users in the Budget Executor or Checkbook Administrator roles " +
                        "may act on the BE Decision of a Realignment.");
                }
            }
        }

        /// <summary>
        /// Resolves the debiting state from the realignment's debit Prioritization
        /// (a direct book_state lookup on book_prioritization — no fund-center
        /// walk needed). Read live from the record, mirroring how SwapValidator
        /// retrieves State A / State B. Returns null when there is no debiting
        /// Prioritization or it has no state.
        /// </summary>
        private static EntityReference ResolveDebitingState(
            IOrganizationService service,
            ITracingService tracing,
            Guid realignmentId)
        {
            // No try/catch: a lookup failure must not fail open (null skips the
            // cross-state BU scope check).
            var realignment = service.Retrieve(
                EntityNames.Realignments, realignmentId,
                new ColumnSet(RealignmentsAttributes.DebitedPrioritization));
            var debitPrior = realignment.GetAttributeValue<EntityReference>(
                RealignmentsAttributes.DebitedPrioritization);
            if (debitPrior == null) return null;

            var prio = service.Retrieve(
                EntityNames.Prioritization, debitPrior.Id,
                new ColumnSet(PrioritizationAttributes.State));
            return prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);
        }
    }
}
