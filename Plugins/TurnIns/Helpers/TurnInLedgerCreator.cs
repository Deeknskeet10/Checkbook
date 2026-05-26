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

            // Empty CreditLOAs signals the "funds stay on source LOA" fallback
            // (see TurnInLOAResolver — FY26 RISK missing). Skip both debit and
            // credit ledger creation since they would net to zero on each LOA.
            if (loaResolution.CreditLOAs.Count == 0)
            {
                tracing.Trace("No credit LOAs resolved — skipping ledger creation (funds remain in place).");
                return;
            }

            // --------------------------------------------------------------------
            // Create all debit ledger entries, keyed by debit LOA so we can pair
            // them with the matching credit LOA in the RISK-missing fallback case
            // (where credit LOAs mirror debit LOAs 1:1).
            // --------------------------------------------------------------------
            var debitLedgerIdsByLoa = new Dictionary<Guid, Guid>();
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
                debitLedgerIdsByLoa[debitLOA.Id] = debitId;

                tracing.Trace($"Debit ledger created with ID {debitId}");
            }

            // --------------------------------------------------------------------
            // Create credit ledger entries — usually one (RISK / BE OPR), or one
            // per source LOA in the FY26 RISK-missing fallback. Each credit links
            // back to its matching debit when one exists (same-LOA pairing),
            // otherwise to the first debit so the chain is still queryable.
            // --------------------------------------------------------------------
            var creditLedgerIds = new List<Guid>();
            foreach (var kvp in loaResolution.CreditLOAs)
            {
                var creditLOA = kvp.Key;
                var creditAmount = kvp.Value;

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

                Guid? pairedDebitId =
                    debitLedgerIdsByLoa.TryGetValue(creditLOA.Id, out var sameLoaDebit)
                        ? sameLoaDebit
                        : (debitLedgerIds.Count > 0 ? debitLedgerIds[0] : (Guid?)null);

                if (pairedDebitId.HasValue)
                    creditLedger[LedgerAttributes.RelatedEntry] =
                        new EntityReference(EntityNames.Ledger, pairedDebitId.Value);

                var creditId = service.Create(creditLedger);
                creditLedgerIds.Add(creditId);

                tracing.Trace($"Credit ledger created with ID {creditId}");
            }

            // --------------------------------------------------------------------
            // Link each debit ledger back to its paired credit ledger. In the
            // single-credit case all debits point at the same credit; in the
            // fallback case each debit pairs with the same-LOA credit (which
            // shares the source LOA), falling back to the first credit.
            // --------------------------------------------------------------------
            var creditLedgerIdsByLoa = new Dictionary<Guid, Guid>();
            {
                int i = 0;
                foreach (var creditKey in loaResolution.CreditLOAs.Keys)
                {
                    creditLedgerIdsByLoa[creditKey.Id] = creditLedgerIds[i++];
                }
            }

            foreach (var debitKvp in loaResolution.DebitLOAs)
            {
                var debitLoaId = debitKvp.Key.Id;
                var debitId = debitLedgerIdsByLoa[debitLoaId];

                Guid pairedCreditId =
                    creditLedgerIdsByLoa.TryGetValue(debitLoaId, out var sameLoaCredit)
                        ? sameLoaCredit
                        : creditLedgerIds[0];

                tracing.Trace($"Linking Debit Ledger {debitId} → Credit Ledger {pairedCreditId}");

                var updateDebit = new Entity(EntityNames.Ledger, debitId);
                updateDebit[LedgerAttributes.RelatedEntry] =
                    new EntityReference(EntityNames.Ledger, pairedCreditId);

                service.Update(updateDebit);
            }

            tracing.Trace("All Turn-In ledger entries created and linked.");
        }
    }
}