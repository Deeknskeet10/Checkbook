using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Creates ledger entries for Turn-Ins:
    /// - One debit ledger per unique LOA used in the Turn-In items
    /// - One single credit ledger for the Turn-In receiving LOA
    /// 
    /// Mirrors the Realignment LedgerCreator you provided, but adapted for Turn-Ins.
    /// </summary>
    public static class TurnInLedgerCreator
    {
        public static void CreateLedgerEntries(
            IOrganizationService service,
            ITracingService tracing,
            Guid turnInId,
            TurnInLOAResolution loaResolution)
        {
            tracing.Trace("TurnInLedgerCreator: creating ledger entries...");

            var creditLOA = loaResolution.CreditLOA;
            if (creditLOA == null)
                throw new InvalidPluginExecutionException("Credit LOA not resolved.");

            // --------------------------------------------------------------------
            // First, create all debit ledger entries.
            // --------------------------------------------------------------------
            var debitLedgerIds = new List<Guid>();

            foreach (var kvp in loaResolution.DebitLOAs)
            {
                var debitLOA = kvp.Key;
                var amount = kvp.Value;

                tracing.Trace($"Creating debit ledger for LOA {debitLOA.Id}, Amount {amount}");

                var debitLedger = new Entity(EntityNames.Ledger);
                debitLedger[LedgerAttributes.Amount] = amount;
                debitLedger[LedgerAttributes.LineOfAccounting] = debitLOA;
                debitLedger[LedgerAttributes.LedgerDirection] =
                    new OptionSetValue(LedgerDirectionValues.Debited);
                debitLedger[LedgerAttributes.LedgerType] =
                    new OptionSetValue(LedgerTypeValues.TurnIn);
                debitLedger[LedgerAttributes.TurnIn] =
                    new EntityReference(EntityNames.Turnin, turnInId);

                var debitId = service.Create(debitLedger);
                debitLedgerIds.Add(debitId);

                tracing.Trace($"Debit ledger created with ID {debitId}");
            }

            // --------------------------------------------------------------------
            // Create the credit ledger entry (single for entire Turn-In).
            // --------------------------------------------------------------------
            decimal creditAmount = loaResolution.TotalAmount;

            tracing.Trace($"Creating credit ledger for LOA {creditLOA.Id}, Amount {creditAmount}");

            var creditLedger = new Entity(EntityNames.Ledger);
            creditLedger[LedgerAttributes.Amount] = creditAmount;
            creditLedger[LedgerAttributes.LineOfAccounting] = creditLOA;
            creditLedger[LedgerAttributes.LedgerDirection] =
                new OptionSetValue(LedgerDirectionValues.Credited);
            creditLedger[LedgerAttributes.LedgerType] =
                new OptionSetValue(LedgerTypeValues.TurnIn);
            creditLedger[LedgerAttributes.TurnIn] =
                new EntityReference(EntityNames.Turnin, turnInId);

            // Link to first debit ledger for bi-directional reference
            if (debitLedgerIds.Count > 0)
                creditLedger[LedgerAttributes.RelatedEntry] =
                    new EntityReference(EntityNames.Ledger, debitLedgerIds[0]);

            var creditId = service.Create(creditLedger);

            tracing.Trace($"Credit ledger created with ID {creditId}");

            // --------------------------------------------------------------------
            // Link each debit ledger back to the credit ledger.
            // --------------------------------------------------------------------
            foreach (var debitId in debitLedgerIds)
            {
                tracing.Trace($"Linking Debit Ledger {debitId} → Credit Ledger {creditId}");

                var updateDebit = new Entity(EntityNames.Ledger, debitId);
                updateDebit[LedgerAttributes.RelatedEntry] =
                    new EntityReference(EntityNames.Ledger, creditId);

                service.Update(updateDebit);
            }

            tracing.Trace("All Turn-In ledger entries created and linked.");
        }
    }
}