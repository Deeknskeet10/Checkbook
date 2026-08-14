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

                TDPCalculationHelper.RecalculateLOATDP(service, debitLOA.Id, tracing);
                TDPCalculationHelper.RecalculateLOATDP(service, creditLOA.Id, tracing);
            }

            if (isPriorPath)
            {
                tracing.Trace("Executing Prior→Prior realignment.");
                ExecutePriorToPrior(service, tracing, debitPrior, creditPrior, debitRF, creditRF, amount);
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
                    : ResolveAnchorFundCenter(service, EntityNames.RequirementFunding, debitRF, RequirementFundingAttributes.FundCenter);
                var creditAnchorFc = isPriorPath
                    ? ResolveAnchorFundCenter(service, EntityNames.Prioritization, creditPrior, PrioritizationAttributes.FundCenter)
                    : ResolveAnchorFundCenter(service, EntityNames.RequirementFunding, creditRF, RequirementFundingAttributes.FundCenter);

                RealignmentDistributionCreator.CreateDistributions(
                    service, tracing, context.PrimaryEntityId,
                    debitAnchorFc, creditAnchorFc, debitLOA, creditLOA, amount);
            }

            FinalizeRealignment(service, tracing, context.PrimaryEntityId);
        }

        private void ExecutePriorToPrior(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitPrior,
            EntityReference creditPrior,
            EntityReference debitRF,
            EntityReference creditRF,
            decimal amount)
        {
            var debit = service.Retrieve(
                EntityNames.Prioritization,
                debitPrior.Id,
                new ColumnSet(PrioritizationAttributes.FundedAmountTDP));

            decimal fundedDebit = debit.GetAttributeValue<decimal?>(PrioritizationAttributes.FundedAmountTDP) ?? 0m;
            decimal newDebitAmount = fundedDebit - amount;
            if (newDebitAmount < 0)
                newDebitAmount = 0;

            var updDebit = new Entity(EntityNames.Prioritization, debitPrior.Id);
            updDebit[PrioritizationAttributes.FundedAmountTDP] = newDebitAmount;
            service.Update(updDebit);

            /* Now that Prioritization is debited; debit parent RF */
            ApplyDebitToRF(service, tracing, debitRF, amount, true);

            /* Add credit to credited RF before crediting Prioritization */
            ApplyCreditToRF(service, tracing, creditRF, amount);

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

                tdp -= remaining;
                funded -= remaining;

                if (tdp < 0) tdp = 0;
                if (funded < 0) funded = 0;

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