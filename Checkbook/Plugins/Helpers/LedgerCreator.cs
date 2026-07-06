using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Unified entry point for creating paired ledger rows. Three callers today:
    ///   • Realignments: one debit + one credit, 1:1 LOA mapping.
    ///   • Turn-Ins: N debits + M credits (usually one credit), with same-LOA
    ///     pairing when both sides include a matching LOA.
    ///   • State Swaps: one debit + one credit per swap item, 1:1 LOA mapping
    ///     (like Realignment but per-item within a multi-item parent).
    /// All flows share the per-row construction in <see cref="CreateLedgerEntry"/>
    /// (parent FK + type + direction + amount + LOA), but the orchestration
    /// differs enough that exposing top-level methods per caller is clearer than
    /// forcing a single mega-API.
    /// </summary>
    public static class LedgerCreator
    {
        /// <summary>
        /// Creates a single debit/credit ledger pair for a Realignment and
        /// cross-links them via book_relatedentry.
        /// </summary>
        public static void CreateRealignmentPair(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitLOA,
            EntityReference creditLOA,
            decimal amount,
            Guid realignmentId)
        {
            tracing.Trace("Creating Realignment ledger pair.");

            var realignmentRef = new EntityReference(EntityNames.Realignments, realignmentId);

            var debitId = CreateLedgerEntry(
                service, debitLOA, amount,
                LedgerTypeValues.Realignment, LedgerDirectionValues.Debited,
                LedgerAttributes.Realignment, realignmentRef,
                relatedEntry: null);

            var creditId = CreateLedgerEntry(
                service, creditLOA, amount,
                LedgerTypeValues.Realignment, LedgerDirectionValues.Credited,
                LedgerAttributes.Realignment, realignmentRef,
                relatedEntry: new EntityReference(EntityNames.Ledger, debitId));

            service.Update(new Entity(EntityNames.Ledger, debitId)
            {
                [LedgerAttributes.RelatedEntry] = new EntityReference(EntityNames.Ledger, creditId),
            });

            tracing.Trace("Realignment ledger pair created and linked.");
        }

        /// <summary>
        /// Creates a single debit/credit ledger pair for one State Swap item and
        /// cross-links them via book_relatedentry. Callers skip this for same-LOA
        /// items (net-zero at the LOA level).
        /// </summary>
        public static void CreateStateSwapPair(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitLOA,
            EntityReference creditLOA,
            decimal amount,
            Guid stateSwapId)
        {
            tracing.Trace($"Creating State Swap ledger pair (amount {amount}).");

            var swapRef = new EntityReference(EntityNames.StateSwap, stateSwapId);

            var debitId = CreateLedgerEntry(
                service, debitLOA, amount,
                LedgerTypeValues.Swap, LedgerDirectionValues.Debited,
                LedgerAttributes.StateSwap, swapRef,
                relatedEntry: null);

            var creditId = CreateLedgerEntry(
                service, creditLOA, amount,
                LedgerTypeValues.Swap, LedgerDirectionValues.Credited,
                LedgerAttributes.StateSwap, swapRef,
                relatedEntry: new EntityReference(EntityNames.Ledger, debitId));

            service.Update(new Entity(EntityNames.Ledger, debitId)
            {
                [LedgerAttributes.RelatedEntry] = new EntityReference(EntityNames.Ledger, creditId),
            });

            tracing.Trace($"State Swap ledger pair created: debit {debitId} / credit {creditId}.");
        }

        /// <summary>
        /// Creates ledger entries for a Turn-In: one debit per unique source
        /// LOA (from <paramref name="debits"/>) and one credit per credit LOA
        /// (from <paramref name="credits"/>). Empty credits indicates the
        /// "funds stay on source LOA" fallback — both sides are skipped.
        ///
        /// Linking strategy: each debit's RelatedEntry points to the same-LOA
        /// credit when one exists (FY26 RISK-missing fallback case where
        /// debit and credit share the source LOA); otherwise to the first
        /// credit so the chain is still queryable. Each credit gets the
        /// inverse link.
        /// </summary>
        public static void CreateTurnInEntries(
            IOrganizationService service,
            ITracingService tracing,
            Guid turnInId,
            IReadOnlyDictionary<EntityReference, decimal> debits,
            IReadOnlyDictionary<EntityReference, decimal> credits)
        {
            tracing.Trace("Creating Turn-In ledger entries.");

            if (credits.Count == 0)
            {
                tracing.Trace("No credit LOAs resolved — skipping ledger creation (funds remain in place).");
                return;
            }

            var turnInRef = new EntityReference(EntityNames.Turnin, turnInId);

            // ---- Create debits ----
            var debitIdByLoa = new Dictionary<Guid, Guid>();
            var debitOrder = new List<Guid>();
            foreach (var debit in debits)
            {
                var debitId = CreateLedgerEntry(
                    service, debit.Key, debit.Value,
                    LedgerTypeValues.TurnIn, LedgerDirectionValues.Debited,
                    LedgerAttributes.TurnIn, turnInRef,
                    relatedEntry: null);
                debitIdByLoa[debit.Key.Id] = debitId;
                debitOrder.Add(debitId);
                tracing.Trace($"Debit ledger {debitId} for LOA {debit.Key.Id}, Amount {debit.Value}.");
            }

            // ---- Create credits, pairing each to same-LOA debit when available ----
            var creditIdByLoa = new Dictionary<Guid, Guid>();
            var creditOrder = new List<Guid>();
            foreach (var credit in credits)
            {
                EntityReference pairedDebitRef = null;
                if (debitIdByLoa.TryGetValue(credit.Key.Id, out var sameLoaDebit))
                    pairedDebitRef = new EntityReference(EntityNames.Ledger, sameLoaDebit);
                else if (debitOrder.Count > 0)
                    pairedDebitRef = new EntityReference(EntityNames.Ledger, debitOrder[0]);

                var creditId = CreateLedgerEntry(
                    service, credit.Key, credit.Value,
                    LedgerTypeValues.TurnIn, LedgerDirectionValues.Credited,
                    LedgerAttributes.TurnIn, turnInRef,
                    relatedEntry: pairedDebitRef);
                creditIdByLoa[credit.Key.Id] = creditId;
                creditOrder.Add(creditId);
                tracing.Trace($"Credit ledger {creditId} for LOA {credit.Key.Id}, Amount {credit.Value}.");
            }

            // ---- Link each debit back to its paired credit ----
            foreach (var debit in debits)
            {
                var debitId = debitIdByLoa[debit.Key.Id];
                var pairedCreditId =
                    creditIdByLoa.TryGetValue(debit.Key.Id, out var sameLoaCredit)
                        ? sameLoaCredit
                        : creditOrder[0];

                service.Update(new Entity(EntityNames.Ledger, debitId)
                {
                    [LedgerAttributes.RelatedEntry] = new EntityReference(EntityNames.Ledger, pairedCreditId),
                });
                tracing.Trace($"Linked Debit {debitId} → Credit {pairedCreditId}.");
            }

            tracing.Trace("All Turn-In ledger entries created and linked.");
        }

        private static Guid CreateLedgerEntry(
            IOrganizationService service,
            EntityReference loa,
            decimal amount,
            int ledgerType,
            int direction,
            string parentAttribute,
            EntityReference parent,
            EntityReference relatedEntry)
        {
            var ledger = new Entity(EntityNames.Ledger);
            ledger[LedgerAttributes.Amount] = amount;
            ledger[LedgerAttributes.LineOfAccounting] = loa;
            ledger[LedgerAttributes.LedgerType] = new OptionSetValue(ledgerType);
            ledger[LedgerAttributes.LedgerDirection] = new OptionSetValue(direction);
            ledger[parentAttribute] = parent;
            if (relatedEntry != null)
                ledger[LedgerAttributes.RelatedEntry] = relatedEntry;
            return service.Create(ledger);
        }
    }
}
