using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Keeps the Mode-C (State-Rollup) spend-plan bucket's funded amount in sync
    /// with its Prioritization Funding rows. A bucket is a (State, Fund, SAG, FY)
    /// aggregate that spans every distributed non-breakout PF in the state; its
    /// funded amount is Σ of those PFs' book_fundedamount, written to any
    /// existing book_spendplan rows for the bucket (book_fundedamount). The
    /// bucket's monthly Planned/Actual cells are owned by the State PM, not this
    /// plugin — it only maintains the funded figure the Planned cap validates
    /// against.
    ///
    /// A PF that moves buckets (LOA / Prioritization / mode change) or leaves
    /// State-Rollup recomputes BOTH its old and new bucket, so no bucket keeps a
    /// stale contribution. Only buckets that already have spend-plan rows are
    /// touched — until the State PM opens a bucket (creates its rows) there is
    /// nothing to store the funded amount on.
    /// </summary>
    /// <remarks>
    /// Register: PostOperation, Sync, book_prioritizationfunding —
    ///   Create; Update (filter: book_fundedamount, book_spendplanmode,
    ///   book_lineofaccounting, book_prioritization, statecode); Delete.
    /// Pre-image "PreImage" (Update + Delete): book_prioritization,
    ///   book_lineofaccounting, book_spendplanmode, book_fundedamount, statecode.
    /// </remarks>
    public class SpendPlanStateRollup : PluginBase
    {
        private struct Bucket
        {
            public Guid State, Fund, Sag;
            public int Fy;
            public override bool Equals(object obj) => obj is Bucket b &&
                b.State == State && b.Fund == Fund && b.Sag == Sag && b.Fy == Fy;
            public override int GetHashCode() =>
                State.GetHashCode() ^ Fund.GetHashCode() ^ Sag.GetHashCode() ^ Fy;
        }

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.PrioritizationFunding)
                return;

            var target = context.MessageName == "Delete" ? null : TryGetTarget(context);
            var preImage = TryGetPreImage(context);

            var affected = new HashSet<Bucket>();

            // New/current bucket — only when the PF is (still) a State-Rollup row.
            if (context.MessageName != "Delete")
            {
                var pfId = target?.Id ?? context.PrimaryEntityId;
                var currentMode = GetEffectiveOptionSetValue(
                    target, preImage, PrioritizationFundingAttributes.SpendPlanMode)?.Value;
                if (currentMode == SpendPlanModeValues.StateRollup)
                    AddBucket(service, tracing, affected, ResolvePfBucket(service, pfId));
            }

            // Old bucket — decrement the contribution the PF used to make.
            if (preImage != null)
            {
                var oldMode = preImage.GetAttributeValue<OptionSetValue>(
                    PrioritizationFundingAttributes.SpendPlanMode)?.Value;
                if (oldMode == SpendPlanModeValues.StateRollup)
                {
                    var oldPrio = preImage.GetAttributeValue<EntityReference>(
                        PrioritizationFundingAttributes.Prioritization);
                    var oldLoa = preImage.GetAttributeValue<EntityReference>(
                        PrioritizationFundingAttributes.LineOfAccounting);
                    AddBucket(service, tracing, affected, ResolveBucket(service, oldPrio, oldLoa));
                }
            }

            foreach (var bucket in affected)
                RecomputeBucket(service, tracing, bucket);
        }

        private static void AddBucket(
            IOrganizationService service, ITracingService tracing,
            HashSet<Bucket> set, Bucket? bucket)
        {
            if (bucket != null) set.Add(bucket.Value);
        }

        /// <summary>Resolve the bucket for a live PF by id (retrieves Prio + LOA).</summary>
        private static Bucket? ResolvePfBucket(IOrganizationService service, Guid pfId)
        {
            var pf = service.Retrieve(
                EntityNames.PrioritizationFunding, pfId,
                new ColumnSet(
                    PrioritizationFundingAttributes.Prioritization,
                    PrioritizationFundingAttributes.LineOfAccounting));
            return ResolveBucket(service,
                pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization),
                pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.LineOfAccounting));
        }

        /// <summary>Prio → (State, FY); LOA → (Fund, SAG). Null if any part is missing.</summary>
        private static Bucket? ResolveBucket(
            IOrganizationService service, EntityReference prioRef, EntityReference loaRef)
        {
            if (prioRef == null || loaRef == null)
                return null;

            var prio = service.Retrieve(EntityNames.Prioritization, prioRef.Id,
                new ColumnSet(PrioritizationAttributes.State, PrioritizationAttributes.FiscalYear));
            var loa = service.Retrieve(EntityNames.FundingLine, loaRef.Id,
                new ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.SAG));

            var state = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);
            var fy = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FiscalYear)?.Value;
            var fund = loa.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund);
            var sag = loa.GetAttributeValue<EntityReference>(FundingLineAttributes.SAG);

            if (state == null || fund == null || sag == null || fy == null)
                return null;

            return new Bucket { State = state.Id, Fund = fund.Id, Sag = sag.Id, Fy = fy.Value };
        }

        private static void RecomputeBucket(
            IOrganizationService service, ITracingService tracing, Bucket bucket)
        {
            var rows = FindBucketRows(service, bucket);
            if (rows.Entities.Count == 0)
            {
                tracing.Trace(
                    $"Bucket (state {bucket.State}, fund {bucket.Fund}, sag {bucket.Sag}, " +
                    $"FY {bucket.Fy}) has no spend-plan rows yet; nothing to update.");
                return;
            }

            var funded = SumBucketFunded(service, bucket);
            foreach (var row in rows.Entities)
            {
                var current = NumericHelper.ToDecimal(
                    row.Contains(SpendPlanAttributes.FundedAmount)
                        ? row[SpendPlanAttributes.FundedAmount] : null, 0m);
                if (Math.Abs(current - funded) < 0.005m)
                    continue;

                service.Update(new Entity(EntityNames.SpendPlan, row.Id)
                {
                    [SpendPlanAttributes.FundedAmount] = funded,
                });
            }
            tracing.Trace($"Bucket funded recomputed = {funded} across {rows.Entities.Count} row(s).");
        }

        /// <summary>Σ book_fundedamount over active State-Rollup PFs in the bucket.</summary>
        private static decimal SumBucketFunded(IOrganizationService service, Bucket bucket)
        {
            var query = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(PrioritizationFundingAttributes.FundedAmount),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationFundingAttributes.SpendPlanMode,
                            ConditionOperator.Equal, SpendPlanModeValues.StateRollup),
                        new ConditionExpression(
                            PrioritizationFundingAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };

            var loaLink = query.AddLink(
                EntityNames.FundingLine,
                PrioritizationFundingAttributes.LineOfAccounting,
                FundingLineAttributes.Id, JoinOperator.Inner);
            loaLink.LinkCriteria.AddCondition(FundingLineAttributes.Fund, ConditionOperator.Equal, bucket.Fund);
            loaLink.LinkCriteria.AddCondition(FundingLineAttributes.SAG, ConditionOperator.Equal, bucket.Sag);

            var prioLink = query.AddLink(
                EntityNames.Prioritization,
                PrioritizationFundingAttributes.Prioritization,
                PrioritizationAttributes.Id, JoinOperator.Inner);
            prioLink.LinkCriteria.AddCondition(PrioritizationAttributes.State, ConditionOperator.Equal, bucket.State);
            prioLink.LinkCriteria.AddCondition(PrioritizationAttributes.FiscalYear, ConditionOperator.Equal, bucket.Fy);

            decimal sum = 0m;
            foreach (var pf in service.RetrieveMultiple(query).Entities)
                sum += NumericHelper.ToDecimal(
                    pf.Contains(PrioritizationFundingAttributes.FundedAmount)
                        ? pf[PrioritizationFundingAttributes.FundedAmount] : null, 0m);
            return sum;
        }

        private static EntityCollection FindBucketRows(IOrganizationService service, Bucket bucket)
        {
            var query = new QueryExpression(EntityNames.SpendPlan)
            {
                ColumnSet = new ColumnSet(SpendPlanAttributes.FundedAmount),
                NoLock = true,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(SpendPlanAttributes.State, ConditionOperator.Equal, bucket.State),
                        new ConditionExpression(SpendPlanAttributes.Fund, ConditionOperator.Equal, bucket.Fund),
                        new ConditionExpression(SpendPlanAttributes.Sag, ConditionOperator.Equal, bucket.Sag),
                        new ConditionExpression(SpendPlanAttributes.FiscalYear, ConditionOperator.Equal, bucket.Fy),
                        new ConditionExpression(SpendPlanAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
            };
            return service.RetrieveMultiple(query);
        }

        private static Entity TryGetTarget(IPluginExecutionContext context)
        {
            return context.InputParameters.TryGetValue("Target", out var t) && t is Entity e ? e : null;
        }
    }
}
