using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.TurnIns.Helpers
{
    /// <summary>
    /// Creates AFP and Allotment Distributions for an approved Turn-In.
    ///
    /// AFP and Allotment are the only ledger types that flow through book_distributions.
    /// TDP isn't a Distribution — it moves via TurnInLedgerCreator and the RF / Prio /
    /// LOA updates in the orchestrator.
    ///
    /// Reads pre-computed book_afpamount and book_allotmentamount off the Turn-In header
    /// (set by TurnInAmountCalculator for Kind A records and by GenerateDistributions
    /// for Kind B records). For each non-zero amount, emits one debit/credit pair:
    ///   • Debit  FC = the Turn-In's own FundCenter (state, e.g. A18MN)
    ///   • Credit FC = the A18 root (single active FundCenter with no parent)
    ///   • Fund + PG = the Turn-In header's Fund + PG (matches the FundingDetails row
    ///     that produced the percentage)
    /// Both sides carry book_fundingevent so the formula column book_fundingtype resolves.
    /// </summary>
    public static class TurnInDistributionCreator
    {
        public static void CreateDistributions(
            IOrganizationService service,
            ITracingService tracing,
            Entity turnIn)
        {
            tracing.Trace("TurnInDistributionCreator: creating AFP/Allotment distributions...");

            var turnInFundCenter = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.FundCenter);
            var turnInFund       = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.Fund);
            var turnInPg         = turnIn.GetAttributeValue<EntityReference>(TurninAttributes.PG);
            if (turnInFundCenter == null || turnInFund == null || turnInPg == null)
            {
                throw new InvalidPluginExecutionException(
                    "Turn-In is missing FundCenter / Fund / PG — cannot create distributions.");
            }

            var afpAmount   = NumericHelper.ToDecimal(turnIn, TurninAttributes.AFPAmount) ?? 0m;
            var allotAmount = NumericHelper.ToDecimal(turnIn, TurninAttributes.AllotmentAmount) ?? 0m;

            if (afpAmount <= 0m && allotAmount <= 0m)
            {
                tracing.Trace("Both AFP and Allotment amounts ≤ 0 — no Distributions to create.");
                return;
            }

            var turnInRef = turnIn.ToEntityReference();
            var creditFundCenter = ResolveRootFundCenter(service, tracing);
            var asOf = DateTime.UtcNow.Date;

            int created = 0;
            if (afpAmount > 0m)
            {
                created += EmitPair(service, tracing, turnInRef, turnInFund, turnInPg,
                                    turnInFundCenter, creditFundCenter,
                                    FundingTypeValues.AFP, "AFP", afpAmount, asOf);
            }
            if (allotAmount > 0m)
            {
                created += EmitPair(service, tracing, turnInRef, turnInFund, turnInPg,
                                    turnInFundCenter, creditFundCenter,
                                    FundingTypeValues.Allotment, "Allotment", allotAmount, asOf);
            }

            tracing.Trace($"TurnInDistributionCreator: {created} distribution row(s) created.");
        }

        private static int EmitPair(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference turnInRef,
            EntityReference fundRef,
            EntityReference pgRef,
            EntityReference debitFc,
            EntityReference creditFc,
            int fundingType,
            string typeName,
            decimal amount,
            DateTime asOf)
        {
            var resolution = FundingPercentageHelper.Resolve(
                service, tracing, fundRef.Id, pgRef.Id, fundingType, asOf);
            if (resolution == null)
            {
                tracing.Trace(
                    $"  {typeName} amount = {amount:C} but no active {typeName} FundingEvent for " +
                    $"(Fund={fundRef.Id}, PG={pgRef.Id}) at {asOf:yyyy-MM-dd}. Skipping pair — " +
                    $"the column should not have been populated without an active event.");
                return 0;
            }

            var debit = new Entity(EntityNames.Distributions);
            debit[DistributionsAttributes.Amount]                = amount;
            debit[DistributionsAttributes.Fund]                  = fundRef;
            debit[DistributionsAttributes.PGSAG]                 = pgRef;
            debit[DistributionsAttributes.FundCenter]            = debitFc;
            debit[DistributionsAttributes.FundingEvent]          = resolution.FundingEvent;
            debit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Debit);
            debit[DistributionsAttributes.Remarks]               = $"Turn-In {typeName} Debit";
            debit[DistributionsAttributes.TurnIn]                = turnInRef;
            var debitId = service.Create(debit);

            var credit = new Entity(EntityNames.Distributions);
            credit[DistributionsAttributes.Amount]                = amount;
            credit[DistributionsAttributes.Fund]                  = fundRef;
            credit[DistributionsAttributes.PGSAG]                 = pgRef;
            credit[DistributionsAttributes.FundCenter]            = creditFc;
            credit[DistributionsAttributes.FundingEvent]          = resolution.FundingEvent;
            credit[DistributionsAttributes.DisbursementDirection] = new OptionSetValue(DisbursementDirectionValues.Credit);
            credit[DistributionsAttributes.Remarks]               = $"Turn-In {typeName} Credit";
            credit[DistributionsAttributes.TurnIn]                = turnInRef;
            credit[DistributionsAttributes.DebitedDistribution]   = new EntityReference(EntityNames.Distributions, debitId);
            var creditId = service.Create(credit);

            tracing.Trace(
                $"  → {typeName} pair Debit={debitId} Credit={creditId} Amount={amount:C} " +
                $"Fund={fundRef.Id} PG={pgRef.Id} FE={resolution.FundingEvent.Id}");
            return 2;
        }

        private static EntityReference ResolveRootFundCenter(
            IOrganizationService service, ITracingService tracing)
        {
            var query = new QueryExpression(EntityNames.FundCenter)
            {
                ColumnSet = new ColumnSet(FundCenterAttributes.Name),
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundCenterAttributes.ParentFundCenter, ConditionOperator.Null),
                        new ConditionExpression(FundCenterAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    }
                },
                TopCount = 2,
            };

            var roots = service.RetrieveMultiple(query).Entities;
            if (roots.Count == 0)
            {
                throw new InvalidPluginExecutionException(
                    "Could not resolve the root (A18 main) Fund Center: no active Fund Center " +
                    "exists with a null parent.");
            }
            if (roots.Count > 1)
            {
                var names = string.Join(", ", roots.Select(e => e.GetAttributeValue<string>(FundCenterAttributes.Name)));
                throw new InvalidPluginExecutionException(
                    $"Ambiguous root Fund Center: more than one active Fund Center has a null " +
                    $"parent ({names}).");
            }

            var root = roots[0];
            tracing.Trace($"Resolved root Fund Center: {root.Id} '{root.GetAttributeValue<string>(FundCenterAttributes.Name)}'");
            return root.ToEntityReference();
        }
    }
}
