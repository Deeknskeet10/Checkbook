using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Realignments
{
    /// <summary>
    /// Realignment validation + Fund/SAG (PG) flag.
    /// Rules:
    /// - RF→RF:
    ///     • If Debited RF has NO child Prioritizations: Available = RF.FundedAmount.
    ///     • If Debited RF HAS child Prioritizations: Available = RF.Withholding only.
    ///       If amount > Withholding, block and instruct user to increase RF.Withholding.
    /// - Prior→Prior:
    ///     • Debited/Credited Prior must be same State.
    ///     • Available = Debited Prior.FundedAmountTDP.
    /// - Fund/SAG (PG)flag: compare selected Debited/Credited LOAs (front-end requires both).
    /// </summary>
    public class SetSameFundSagFlagPlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (!string.Equals(context.PrimaryEntityName, EntityNames.Realignments, StringComparison.OrdinalIgnoreCase))
            {
                tracing.Trace($"Skipping: PrimaryEntityName != {EntityNames.Realignments}");
                return;
            }

            var target = GetTarget(context);
            var isUpdate = context.MessageName.Equals("Update", StringComparison.OrdinalIgnoreCase);
            var preImg = isUpdate ? GetPreImage(context, "PreImage") : null;

            // Effective inputs
            var amount = GetEffectiveDecimal(target, preImg, RealignmentsAttributes.Amount, 0m);
            var debitLoaRef = GetEffectiveEntityReference(target, preImg, RealignmentsAttributes.DebitedLOA);
            var creditLoaRef = GetEffectiveEntityReference(target, preImg, RealignmentsAttributes.CreditedLOA);

            var effDebitReq = GetEffectiveEntityReference(target, preImg, RealignmentsAttributes.DebitedRequirement);
            var effCreditReq = GetEffectiveEntityReference(target, preImg, RealignmentsAttributes.CreditedRequirement);
            var effDebitPrior = GetEffectiveEntityReference(target, preImg, RealignmentsAttributes.DebitedPrioritization);
            var effCreditPrior = GetEffectiveEntityReference(target, preImg, RealignmentsAttributes.CreditedPrioritization);

            if (debitLoaRef == null || creditLoaRef == null)
                throw new InvalidPluginExecutionException("Both Debited LOA and Credited LOA are required.");

            if (amount < 0m)
                throw new InvalidPluginExecutionException($"Realignment amount ({amount}) cannot be negative.");

            // ===== Chain consistency =====
            // Runs on every save so users can't bypass the form's cascading filters
            // by populating fields bottom-up (Prior → RF → LOA → Fund) and ending up
            // with selections that don't actually match the Prioritization's real
            // parents. The RealignmentProcessor trusts the form-selected RFs/LOAs to
            // apply debits/credits, so a mismatch here = silent corruption of the
            // real parent RF's rollups.
            var formFund = GetEffectiveEntityReference(target, preImg, RealignmentsAttributes.Fund);
            ValidateChainConsistency(
                service, tracing,
                effDebitPrior, effCreditPrior,
                effDebitReq, effCreditReq,
                debitLoaRef, creditLoaRef,
                formFund);

            // ===== Realignment type & funds-availability =====
            if (amount > 0m)
            {
                bool hasDebitedRF = effDebitReq != null;
                bool hasDebitedPrior = effDebitPrior != null;

                // Determine path: Prior→Prior takes precedence when a Debited Prioritization exists.
                if (hasDebitedPrior)
                {
                    ValidatePriorToPrior(service, tracing, effDebitPrior, effCreditPrior, amount);
                }
                else if (hasDebitedRF)
                {
                    ValidateRfToRf(service, tracing, effDebitReq, effCreditReq, amount);
                }
                else
                {
                    // Ambiguous or missing debited source — ask the user to choose the path explicitly
                    throw new InvalidPluginExecutionException(
                        "Specify either a Debited Requirement Funding (for RF→RF realignment) " +
                        "or a Debited Prioritization (for Prioritization→Prioritization realignment).");
                }
            }

            // ===== Fund/PG flag with explicit LOAs =====
            var debitLoa = service.Retrieve(EntityNames.FundingLine, debitLoaRef.Id, new ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.PG));
            var creditLoa = service.Retrieve(EntityNames.FundingLine, creditLoaRef.Id, new ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.PG));

            var debitFund = debitLoa.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
            var debitSag = debitLoa.GetAttributeValue<EntityReference>(FundingLineAttributes.PG);
            var creditFund = creditLoa.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
            var creditSag = creditLoa.GetAttributeValue<EntityReference>(FundingLineAttributes.PG);

            var sameFundAndSag =
                debitFund != null && creditFund != null && debitFund.Id == creditFund.Id &&
                debitSag != null && creditSag != null && debitSag.Id == creditSag.Id;

            target[RealignmentsAttributes.SameFundandSAG] = sameFundAndSag;
            tracing.Trace($"Set {RealignmentsAttributes.SameFundandSAG} = {sameFundAndSag} (debitLoa: {debitLoaRef.Id}, creditLoa: {creditLoaRef.Id})");
        }
        // ===== RF→RF validation (strict rules per updated policy) =====
        private void ValidateRfToRf(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitedReqRef,
            EntityReference creditedReqRef,
            decimal amount)
        {
            if (creditedReqRef == null)
                throw new InvalidPluginExecutionException("Credited Requirement Funding is required for an RF→RF realignment.");

            // Does the debited RF have child Prioritizations?
            bool hasChildren = RequirementFundingHelpers.HasActiveChildren(service, debitedReqRef.Id);
            tracing.Trace($"RF→RF: Debited RF {debitedReqRef.Id} has children? {hasChildren}");

            // Retrieve FundedAmount + Withholding
            var debitedReq = service.Retrieve(
                EntityNames.RequirementFunding,
                debitedReqRef.Id,
                new ColumnSet(
                    RequirementFundingAttributes.FundedAmount,
                    RequirementFundingAttributes.Withholding));

            var fundedAmount = NumericHelper.ToDecimal(debitedReq, RequirementFundingAttributes.FundedAmount, 0m) ?? 0m;
            var withholding = NumericHelper.ToDecimal(debitedReq, RequirementFundingAttributes.Withholding, 0m) ?? 0m;

            decimal available;

            if (hasChildren)
            {
                // RF with children → only Withholding is free to realign
                available = withholding;
                tracing.Trace($"RF→RF: RF HAS children → Withholding = {withholding}, Available = {available}");

                if (amount > available)
                {
                    throw new InvalidPluginExecutionException(
                        $"Insufficient Withholding on the debited Requirement Funding. " +
                        $"Only Withholding may be realigned because child Prioritizations exist. " +
                        $"Available Withholding = {withholding:N2}, requested = {amount:N2}.");
                }
            }
            else
            {
                // RF WITHOUT children → FundedAmount can shrink to increase Withholding
                available = fundedAmount + withholding;
                tracing.Trace($"RF→RF: RF has NO children → Funded={fundedAmount}, Withholding={withholding}, Combined Available={available}");

                if (amount > available)
                {
                    throw new InvalidPluginExecutionException(
                        $"The requested realignment exceeds the total available funds (Funded + Withholding) " +
                        $"on the debited Requirement Funding. " +
                        $"Requested = {amount:N2}, Available = {available:N2}. " +
                        $"Reduce the realignment amount or reallocate funding into this RF.");
                }
            }

            tracing.Trace($"RF→RF validation succeeded for amount {amount:N2} (available = {available:N2})");
        }
        // ===== Prior→Prior validation (updated strict rules) =====
        private void ValidatePriorToPrior(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitedPriorRef,
            EntityReference creditedPriorRef,
            decimal amount)
        {
            if (creditedPriorRef == null)
                throw new InvalidPluginExecutionException("Credited Prioritization is required for a Prior→Prior realignment.");

            // Retrieve both debit and credit Prioritizations
            var priorDebit = service.Retrieve(
                EntityNames.Prioritization,
                debitedPriorRef.Id,
                new ColumnSet(PrioritizationAttributes.FundedAmountTDP, PrioritizationAttributes.State));

            var priorCredit = service.Retrieve(
                EntityNames.Prioritization,
                creditedPriorRef.Id,
                new ColumnSet(PrioritizationAttributes.State));

            var fundedTdp = NumericHelper.ToDecimal(priorDebit, PrioritizationAttributes.FundedAmountTDP, 0m) ?? 0m;

            var debitStateRef = priorDebit.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);
            var creditStateRef = priorCredit.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);

            tracing.Trace($"Prior→Prior: Debited Prior {debitedPriorRef.Id} FundedAmountTDP={fundedTdp:N2}, State={debitStateRef?.Id}");
            tracing.Trace($"Prior→Prior: Credited Prior {creditedPriorRef.Id} State={creditStateRef?.Id}");

            // 1. State must match
            if (debitStateRef?.Id != creditStateRef?.Id)
            {
                throw new InvalidPluginExecutionException(
                    "Cross-state Prioritization realignments are not allowed. " +
                    "Both the Debited and Credited Prioritizations must belong to the same State.");
            }

            // 2. Must NOT exceed FundedAmountTDP (strict)
            if (amount > fundedTdp)
            {
                throw new InvalidPluginExecutionException(
                    $"Insufficient TDP-funded amount on the debited Prioritization. " +
                    $"Requested = {amount:N2}, Available FundedAmountTDP = {fundedTdp:N2}.");
            }

            tracing.Trace($"Prior→Prior validation succeeded for amount {amount:N2} (available = {fundedTdp:N2})");
        }

        // ===== Chain consistency validation =====
        private void ValidateChainConsistency(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitPrior,
            EntityReference creditPrior,
            EntityReference debitRF,
            EntityReference creditRF,
            EntityReference debitLOA,
            EntityReference creditLOA,
            EntityReference formFund)
        {
            ValidateOneSideChain(service, tracing, "Debited", debitPrior, debitRF, debitLOA, formFund);
            ValidateOneSideChain(service, tracing, "Credited", creditPrior, creditRF, creditLOA, formFund);
        }

        private void ValidateOneSideChain(
            IOrganizationService service,
            ITracingService tracing,
            string side,
            EntityReference priorRef,
            EntityReference rfRef,
            EntityReference loaRef,
            EntityReference formFund)
        {
            // Prior → RF (and Prior → LOA, if the Prior carries one)
            if (priorRef != null)
            {
                if (rfRef == null)
                    throw new InvalidPluginExecutionException(
                        $"{side} Requirement Funding must be selected when a {side} Prioritization is provided.");

                var prior = service.Retrieve(
                    EntityNames.Prioritization,
                    priorRef.Id,
                    new ColumnSet(
                        PrioritizationAttributes.RequirementFunding,
                        PrioritizationAttributes.LineOfAccounting));

                var priorRf = prior.GetAttributeValue<EntityReference>(PrioritizationAttributes.RequirementFunding);
                if (priorRf == null || priorRf.Id != rfRef.Id)
                    throw new InvalidPluginExecutionException(
                        $"{side} chain mismatch: the {side} Prioritization's parent Requirement Funding " +
                        $"does not match the {side} Requirement Funding selected on the form. " +
                        $"Re-select the chain top-down so the selections agree.");

                var priorLoa = prior.GetAttributeValue<EntityReference>(PrioritizationAttributes.LineOfAccounting);
                if (priorLoa != null && loaRef != null && priorLoa.Id != loaRef.Id)
                    throw new InvalidPluginExecutionException(
                        $"{side} chain mismatch: the {side} Prioritization's Line of Accounting " +
                        $"does not match the {side} LOA selected on the form.");
            }

            // RF → LOA
            if (rfRef != null && loaRef != null)
            {
                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    rfRef.Id,
                    new ColumnSet(RequirementFundingAttributes.LineOfAccounting));

                var rfLoa = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
                if (rfLoa == null || rfLoa.Id != loaRef.Id)
                    throw new InvalidPluginExecutionException(
                        $"{side} chain mismatch: the {side} Requirement Funding's Line of Accounting " +
                        $"does not match the {side} LOA selected on the form.");
            }

            // LOA → Fund (only enforced when the form has a Fund populated, so historical
            // records without a Fund selection still validate)
            if (loaRef != null && formFund != null)
            {
                var loa = service.Retrieve(
                    EntityNames.FundingLine,
                    loaRef.Id,
                    new ColumnSet(FundingLineAttributes.Fund));

                var loaFund = loa.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
                if (loaFund == null || loaFund.Id != formFund.Id)
                    throw new InvalidPluginExecutionException(
                        $"{side} chain mismatch: the {side} LOA's Fund " +
                        $"does not match the Fund selected on the form.");
            }

            tracing.Trace($"{side} chain consistency validated.");
        }

    }
}