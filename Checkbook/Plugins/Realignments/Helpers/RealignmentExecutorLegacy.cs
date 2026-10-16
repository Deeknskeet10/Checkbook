using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Realignments.Helpers
{
    /// <summary>
    /// Executes an approved legacy (FY26) single-row realignment — the
    /// Prioritization→Prioritization or RF→RF move described by the header's own
    /// debit/credit lookups (Ledger-first, credit RF gets a TDP-only increase).
    /// Called by <see cref="RealignmentProcessor"/> when the realignment has no
    /// items; item-based realignments run <see cref="RealignmentExecutor"/>.
    /// </summary>
    public static class RealignmentExecutorLegacy
    {
        public static void Execute(
            IOrganizationService service,
            ITracingService tracing,
            Guid realignmentId,
            decimal amount,
            EntityReference debitPrior,
            EntityReference creditPrior,
            EntityReference debitRF,
            EntityReference creditRF,
            EntityReference debitLOA,
            EntityReference creditLOA,
            bool sameFundSAG,
            bool isPriorPath,
            bool isRFPath)
        {
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
                    realignmentId);

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
                    ? FundCenterWalkHelper.GetAnchorFundCenter(service, EntityNames.Prioritization, debitPrior, PrioritizationAttributes.FundCenter)
                    : FundCenterWalkHelper.GetRequirementFundingFundCenter(service, debitRF);
                var creditAnchorFc = isPriorPath
                    ? FundCenterWalkHelper.GetAnchorFundCenter(service, EntityNames.Prioritization, creditPrior, PrioritizationAttributes.FundCenter)
                    : FundCenterWalkHelper.GetRequirementFundingFundCenter(service, creditRF);

                RealignmentDistributionCreator.CreateDistributions(
                    service, tracing, realignmentId,
                    debitAnchorFc, creditAnchorFc, debitLOA, creditLOA, amount);
            }
        }

        private static void ExecutePriorToPrior(
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
                RequirementFundingHelper.ApplyDebit(service, tracing, debitRF, amount, true, "Realignment");

                /* Add credit to credited RF before crediting Prioritization */
                RequirementFundingHelper.BumpTdp(service, tracing, creditRF.Id, amount);
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
            // withhold on the form. RequirementFundingHelper.ApplyDebit currently also adjusts the
            // debit RF.FundedAmount manually; calling the helper here makes
            // the children-sum the source of truth for both RFs.
            FundingRollupHelper.RecalculateRFFunded(service, debitRF.Id, tracing);
            FundingRollupHelper.RecalculateRFFunded(service, creditRF.Id, tracing);

            tracing.Trace("Prior→Prior funding movement completed.");
        }

        private static void ExecuteRFtoRF(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitRF,
            EntityReference creditRF,
            decimal amount)
        {
            tracing.Trace("RF-to-RF: Applying debit logic.");
            RequirementFundingHelper.ApplyDebit(service, tracing, debitRF, amount, false, "Realignment");

            tracing.Trace("RF-to-RF: Applying credit logic.");
            RequirementFundingHelper.BumpTdp(service, tracing, creditRF.Id, amount);
        }
    }
}
