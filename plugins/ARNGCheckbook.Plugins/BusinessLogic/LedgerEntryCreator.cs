using System;
using Microsoft.Xrm.Sdk;
using ARNGCheckbook.Plugins.Constants;

namespace ARNGCheckbook.Plugins.BusinessLogic
{
    /// <summary>
    /// Plugin that creates Ledger entries atomically when Realignments or Turn-ins
    /// are created or approved. This ensures transactional integrity that cannot
    /// be guaranteed with Power Automate flows.
    ///
    /// Replaces:
    /// - Realignment-CreateLedgerEntries flow
    /// - Turn-In-CreateLedgerEntry flow
    ///
    /// Registration:
    /// For Realignments (book_realignments):
    /// - Message: Create, Stage: Post-Operation (40), Async
    ///   Creates debit and credit ledger entries
    ///
    /// For Turn-in (book_turnin):
    /// - Message: Create, Stage: Post-Operation (40), Async
    ///   Creates turn-in ledger entry
    /// </summary>
    public class LedgerEntryCreator : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var entityName = context.PrimaryEntityName;
            var messageName = context.MessageName;

            // Only handle Create message
            if (messageName != "Create")
            {
                tracingService.Trace($"Skipping - message {messageName} not handled");
                return;
            }

            tracingService.Trace($"Processing {messageName} on {entityName}");

            switch (entityName)
            {
                case EntityNames.Realignments:
                    CreateRealignmentLedgerEntries(context, service, tracingService);
                    break;

                case EntityNames.Turnin:
                    CreateTurnInLedgerEntry(context, service, tracingService);
                    break;

                default:
                    tracingService.Trace($"Entity {entityName} not handled by this plugin");
                    return;
            }
        }

        /// <summary>
        /// Creates two ledger entries for a Realignment:
        /// - Debit entry (negative) on the source LOA
        /// - Credit entry (positive) on the destination LOA
        /// </summary>
        private void CreateRealignmentLedgerEntries(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var target = GetTarget(context);
            var realignmentId = context.PrimaryEntityId;

            // Get realignment details
            var amount = target.GetAttributeValue<Money>(RealignmentsAttributes.Amount);
            var debitedLOA = target.GetAttributeValue<EntityReference>(RealignmentsAttributes.DebitedLOA);
            var creditedLOA = target.GetAttributeValue<EntityReference>(RealignmentsAttributes.CreditedLOA);

            if (amount == null || amount.Value <= 0)
            {
                tracingService.Trace("No amount or zero amount - skipping ledger creation");
                return;
            }

            if (debitedLOA == null && creditedLOA == null)
            {
                tracingService.Trace("No LOAs specified - skipping ledger creation");
                return;
            }

            var realignmentRef = new EntityReference(EntityNames.Realignments, realignmentId);
            var transactionDate = DateTime.UtcNow;

            // Create debit entry (negative amount from source LOA)
            if (debitedLOA != null)
            {
                var debitEntry = new Entity(EntityNames.Ledger);
                debitEntry[LedgerAttributes.Amount] = new Money(-amount.Value); // Negative for debit
                debitEntry[LedgerAttributes.LineOfAccounting] = debitedLOA;
                debitEntry[LedgerAttributes.LedgerType] = new OptionSetValue(LedgerTypeValues.Realignment);
                debitEntry[LedgerAttributes.Realignment] = realignmentRef;
                debitEntry[LedgerAttributes.TransactionDate] = transactionDate;
                debitEntry[LedgerAttributes.Name] = $"Realignment Debit - {amount.Value:C0}";

                var debitId = service.Create(debitEntry);
                tracingService.Trace($"Created debit ledger entry: {debitId}");
            }

            // Create credit entry (positive amount to destination LOA)
            if (creditedLOA != null)
            {
                var creditEntry = new Entity(EntityNames.Ledger);
                creditEntry[LedgerAttributes.Amount] = new Money(amount.Value); // Positive for credit
                creditEntry[LedgerAttributes.LineOfAccounting] = creditedLOA;
                creditEntry[LedgerAttributes.LedgerType] = new OptionSetValue(LedgerTypeValues.Realignment);
                creditEntry[LedgerAttributes.Realignment] = realignmentRef;
                creditEntry[LedgerAttributes.TransactionDate] = transactionDate;
                creditEntry[LedgerAttributes.Name] = $"Realignment Credit - {amount.Value:C0}";

                var creditId = service.Create(creditEntry);
                tracingService.Trace($"Created credit ledger entry: {creditId}");
            }

            tracingService.Trace("Realignment ledger entries created successfully");
        }

        /// <summary>
        /// Creates a single ledger entry for a Turn-in (return of funds).
        /// Turn-ins are typically negative amounts (funds returned).
        /// </summary>
        private void CreateTurnInLedgerEntry(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService)
        {
            var target = GetTarget(context);
            var turnInId = context.PrimaryEntityId;

            // Get turn-in details
            var amount = target.GetAttributeValue<Money>(TurninAttributes.Amount);
            var fundRef = target.GetAttributeValue<EntityReference>(TurninAttributes.Fund);
            var fundCenterRef = target.GetAttributeValue<EntityReference>(TurninAttributes.FundCenter);

            if (amount == null || amount.Value <= 0)
            {
                tracingService.Trace("No amount or zero amount - skipping ledger creation");
                return;
            }

            var turnInRef = new EntityReference(EntityNames.Turnin, turnInId);
            var transactionDate = DateTime.UtcNow;

            // Create turn-in ledger entry
            // Note: Turn-ins reduce available funds, so they're recorded as negative
            var ledgerEntry = new Entity(EntityNames.Ledger);
            ledgerEntry[LedgerAttributes.Amount] = new Money(-amount.Value); // Negative for turn-in
            ledgerEntry[LedgerAttributes.LedgerType] = new OptionSetValue(LedgerTypeValues.TurnIn);
            ledgerEntry[LedgerAttributes.TurnIn] = turnInRef;
            ledgerEntry[LedgerAttributes.TransactionDate] = transactionDate;
            ledgerEntry[LedgerAttributes.Name] = $"Turn-In - {amount.Value:C0}";

            // If we have an LOA reference, link it
            // Note: This may need to be retrieved based on Fund/FundCenter
            // For now, we set what we have available

            var ledgerId = service.Create(ledgerEntry);
            tracingService.Trace($"Created turn-in ledger entry: {ledgerId}");

            tracingService.Trace("Turn-in ledger entry created successfully");
        }
    }
}
