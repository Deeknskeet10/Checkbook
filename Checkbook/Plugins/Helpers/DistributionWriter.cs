using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Shared plumbing for the system-generated book_distributions rows written by
    /// approval pipelines (Turn-In, State Swap, Realignment). Each pipeline keeps its
    /// own routing (which FCs, which Fund/PG, how items group); this class owns the
    /// row shape, the holding-FC lookup and the percentage sizing so every pipeline
    /// writes rows the GenerateDistributions reconcile classifies the same way.
    ///
    /// Every row is stamped ManualEntry = false and linked to its parent record via
    /// <c>parentAttribute</c> (book_turnin / book_stateswap / book_realignment). The
    /// reconcile treats parent-linked rows as immutable — keep that link on every row.
    /// </summary>
    public static class DistributionWriter
    {
        /// <summary>
        /// The A18 holding Fund Center (env var
        /// <see cref="EnvironmentVariableKeys.DistributionHoldingFundCenter"/>) — the
        /// same FC the reconcile nets against. Never resolve A18 any other way.
        /// </summary>
        public static EntityReference GetHoldingFundCenter(IOrganizationService service)
        {
            return new EntityReference(
                EntityNames.FundCenter,
                EnvironmentVariableHelper.GetGuid(service, EnvironmentVariableKeys.DistributionHoldingFundCenter));
        }

        /// <summary>Amount × FundingDetails percentage, rounded to cents.</summary>
        public static decimal Size(decimal baseAmount, decimal percentage)
        {
            return Math.Round(baseAmount * percentage / 100m, 2);
        }

        /// <summary>
        /// Creates a debit row at <paramref name="debitFc"/> and a credit row at
        /// <paramref name="creditFc"/> (credit points back via book_debiteddistribution).
        /// Returns the number of rows created (2).
        /// </summary>
        public static int CreatePair(
            IOrganizationService service,
            string parentAttribute,
            EntityReference parent,
            EntityReference fund,
            EntityReference pg,
            EntityReference fundingEvent,
            decimal amount,
            EntityReference debitFc,
            EntityReference creditFc,
            string debitRemarks,
            string creditRemarks)
        {
            var debitId = CreateRow(service, parentAttribute, parent, fund, pg, fundingEvent, amount,
                debitFc, DisbursementDirectionValues.Debit, debitRemarks, null);
            CreateRow(service, parentAttribute, parent, fund, pg, fundingEvent, amount,
                creditFc, DisbursementDirectionValues.Credit, creditRemarks, debitId);
            return 2;
        }

        public static Guid CreateRow(
            IOrganizationService service,
            string parentAttribute,
            EntityReference parent,
            EntityReference fund,
            EntityReference pg,
            EntityReference fundingEvent,
            decimal amount,
            EntityReference fundCenter,
            int direction,
            string remarks,
            Guid? debitedDistributionId)
        {
            var row = new Entity(EntityNames.Distributions);
            row[DistributionsAttributes.Amount]                = amount;
            row[DistributionsAttributes.Fund]                  = fund;
            row[DistributionsAttributes.PGSAG]                 = pg;
            row[DistributionsAttributes.FundCenter]            = fundCenter;
            row[DistributionsAttributes.FundingEvent]          = fundingEvent;
            row[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(direction);
            row[DistributionsAttributes.ManualEntry]           = false;
            row[DistributionsAttributes.Remarks]               = remarks;
            row[parentAttribute]                               = parent;
            if (debitedDistributionId.HasValue)
                row[DistributionsAttributes.DebitedDistribution] =
                    new EntityReference(EntityNames.Distributions, debitedDistributionId.Value);
            return service.Create(row);
        }
    }
}
