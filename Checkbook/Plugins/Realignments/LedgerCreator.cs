using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Realignments
{
    public static class LedgerCreator
    {
        public static void CreateLedgerEntries(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference debitLOA,
            EntityReference creditLOA,
            decimal amount,
            Guid realignmentId)
        {
            tracing.Trace("Creating Debit/Credit Ledger entries.");

            // -----------------------------
            // Debit Ledger Entry
            // -----------------------------
            var debit = new Entity(EntityNames.Ledger);
            debit[LedgerAttributes.Amount] = amount;
            debit[LedgerAttributes.LineOfAccounting] = debitLOA;
            debit[LedgerAttributes.Realignment] =
                new EntityReference(EntityNames.Realignments, realignmentId);

            debit[LedgerAttributes.LedgerType] =
                new OptionSetValue(LedgerTypeValues.Realignment);

            debit[LedgerAttributes.LedgerDirection] =
                new OptionSetValue(LedgerDirectionValues.Debited);

            var debitId = service.Create(debit);

            // -----------------------------
            // Credit Ledger Entry
            // -----------------------------
            var credit = new Entity(EntityNames.Ledger);
            credit[LedgerAttributes.Amount] = amount;
            credit[LedgerAttributes.LineOfAccounting] = creditLOA;
            credit[LedgerAttributes.Realignment] =
                new EntityReference(EntityNames.Realignments, realignmentId);

            credit[LedgerAttributes.LedgerType] =
                new OptionSetValue(LedgerTypeValues.Realignment);

            credit[LedgerAttributes.LedgerDirection] =
                new OptionSetValue(LedgerDirectionValues.Credited);

            credit[LedgerAttributes.RelatedEntry] =
                new EntityReference(EntityNames.Ledger, debitId);

            var creditId = service.Create(credit);

            // Link back from debit to credit
            var updateDebit = new Entity(EntityNames.Ledger, debitId);
            updateDebit[LedgerAttributes.RelatedEntry] =
                new EntityReference(EntityNames.Ledger, creditId);

            service.Update(updateDebit);

            tracing.Trace("Ledger entries created and linked.");
        }
    }
}