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
    /// Auto-allocates a Prioritization's funded/validated total to its single
    /// Requirement Funding when the Requirement has exactly ONE active RF for the
    /// Prioritization's Fiscal Year (FY27+ model).
    ///
    /// Removes the "type the Funded amount, then re-type it in Allocate to RFs"
    /// double entry: whenever the NPM sets the Prioritization's funded/validated
    /// total, this materializes / syncs the one book_prioritizationfunding
    /// junction row so the RF roll-up reflects it without a second manual step.
    ///
    /// Covers BOTH funding modes, because both deposit the total onto the same
    /// two Prioritization fields this step filters on:
    ///   • Direct   — the NPM types book_newfundedamounttdp / book_validatedamount
    ///                directly (V&amp;F editor), firing this step at depth 1.
    ///   • Itemized — the NPM funds each book_itemizeddetails child;
    ///                PrioritizationItemizedRollup sums them onto the same two
    ///                Prioritization fields, firing this step at the nested depth.
    ///
    /// Single-RF only. When the Requirement has 2+ active RFs for the FY the NPM
    /// must split the total across them by hand via the "Allocate to RFs" dialog,
    /// so this step no-ops and leaves the junctions untouched. Reducing a junction
    /// (or the Prio total) returns the delta to the RF's withhold automatically via
    /// the RF roll-up — no special handling here.
    ///
    /// Re-entrancy: this step never writes the Prioritization back (it only writes
    /// the junction + recalculates the RF). The one plugin that would write the
    /// Prio from the junction — PrioritizationFundingRollup — self-guards on
    /// Depth &gt; 1, and our junction write always lands at depth ≥ 2, so it does
    /// not fire. That is also why we recalculate the parent RF directly here
    /// (mirroring PrioritizationFundingRollup's own RF leg) rather than relying on
    /// it. An idempotent no-op guard (junction already equals the target) is the
    /// final backstop against an echo.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Create | Entity: book_prioritization | Post-Operation | Sync
    ///         Filtering attributes: (none)
    ///   • Message: Update | Entity: book_prioritization | Post-Operation | Sync
    ///         Filtering attributes: book_newfundedamounttdp, book_validatedamount
    ///     Rank: after PrioritizationRollupToRequirementFunding. No pre-image
    ///     needed — the post-operation Retrieve reads the committed totals.
    /// </summary>
    public class PrioritizationSingleRfAutoAllocate : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization)
                return;

            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            // Runaway backstop — re-entry is structurally prevented (see class
            // remarks), so this only ever trips on an unforeseen nested chain.
            if (context.Depth > 8)
            {
                tracing.Trace("Depth > 8 — auto-allocation backstop; skipping.");
                return;
            }

            var prioId = context.PrimaryEntityId;
            if (prioId == Guid.Empty)
            {
                var target = GetTarget(context);
                prioId = target.Id;
            }
            if (prioId == Guid.Empty)
            {
                tracing.Trace("No Prioritization id — nothing to allocate.");
                return;
            }

            // Post-operation Retrieve reflects the committed totals + parents.
            var prio = service.Retrieve(
                EntityNames.Prioritization,
                prioId,
                new ColumnSet(
                    PrioritizationAttributes.ApprovalStatus,
                    PrioritizationAttributes.Requirement,
                    PrioritizationAttributes.RequirementFunding,
                    PrioritizationAttributes.FiscalYear,
                    PrioritizationAttributes.FundedAmountTDP,
                    PrioritizationAttributes.ValidatedAmount,
                    "owningbusinessunit"));

            // ---- Gate 1: only a Prio that is HOLDING funding (NPM Review) ----
            // Below status 4 the funding guards block the write anyway, and the
            // FinalApproved-only RF roll-up would not count it. This also makes
            // the step a clean no-op on pull-back (status has left 4), so it never
            // collides with PrioritizationPullbackFundingCleanup.
            var status = prio
                .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.ApprovalStatus)?.Value;
            if (status != ApprovalStatusValues.FinalApproved)
            {
                tracing.Trace(
                    $"Prio {prioId} ApprovalStatus {(status?.ToString() ?? "null")} != NPM Review — skipping.");
                return;
            }

            // ---- Gate 2: FY26 model — a Prio that already funds an RF via the
            // legacy direct lookup is out of scope. This is the load-bearing
            // FY26/FY27 discriminator: the RF roll-up UNIONs the direct-lookup
            // path (prioFunded) with the junction path (pfFunded) on the
            // assumption they are mutually exclusive per RF
            // (PrioritizationRollupHelper.BuildRFFundedUpdate). If we materialize
            // a junction for a Prio that ALSO carries book_requirementfunding, the
            // Prio lands in BOTH sums and the RF double-counts it — exactly the
            // Funded > TDP failure this guard exists to prevent. Keying off the
            // direct lookup (rather than the Fiscal Year option value) is
            // self-correcting: whatever the FY picklist integers are, a Prio with
            // a direct RF is the FY26 shape and never gets a junction.
            var directRf = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.RequirementFunding);
            if (directRf != null)
            {
                tracing.Trace(
                    $"Prio {prioId} funds RF {directRf.Id} via the direct book_requirementfunding " +
                    "lookup (FY26 model) — junction auto-allocation would double-count it; skipping.");
                return;
            }

            // ---- FY27 model requires a direct Requirement lookup to scope RFs ----
            var reqRef = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.Requirement);
            if (reqRef == null)
            {
                tracing.Trace("No Requirement on Prio (FY26 / direct-RF model) — skipping.");
                return;
            }

            var fy = prio.GetAttributeValue<OptionSetValue>(PrioritizationAttributes.FiscalYear)?.Value;
            if (fy == null)
            {
                tracing.Trace("No Fiscal Year on Prio — cannot scope RFs; skipping.");
                return;
            }

            // ---- Single-RF gate: exactly one active RF for (Requirement, FY) ----
            var rfIds = GetActiveRfIds(service, reqRef.Id, fy.Value);
            if (rfIds.Count != 1)
            {
                tracing.Trace(
                    $"Requirement {reqRef.Id} has {rfIds.Count} active RF(s) for FY {fy.Value} — " +
                    "not single-RF; manual Allocate to RFs required. Skipping.");
                return;
            }
            var rfId = rfIds[0];

            var targetFunded = prio.GetAttributeValue<decimal?>(PrioritizationAttributes.FundedAmountTDP) ?? 0m;
            var targetValidated = prio.GetAttributeValue<decimal?>(PrioritizationAttributes.ValidatedAmount) ?? 0m;

            // ---- Existing active junctions for this Prio ----
            var junctions = GetActiveJunctions(service, prioId);

            if (junctions.Count == 0)
            {
                if (targetFunded == 0m && targetValidated == 0m)
                {
                    tracing.Trace("No junction and nothing to allocate (funded + validated = 0) — skipping.");
                    return;
                }

                tracing.Trace(
                    $"Creating junction Prio {prioId} ↔ RF {rfId}: " +
                    $"funded={targetFunded}, validated={targetValidated}.");
                var create = new Entity(EntityNames.PrioritizationFunding);
                create[PrioritizationFundingAttributes.Prioritization] =
                    new EntityReference(EntityNames.Prioritization, prioId);
                create[PrioritizationFundingAttributes.RequirementFunding] =
                    new EntityReference(EntityNames.RequirementFunding, rfId);
                create[PrioritizationFundingAttributes.FundedAmount] = targetFunded;
                create[PrioritizationFundingAttributes.ValidatedAmount] = targetValidated;

                // Scope the junction to the state that owns the parent Prio, not the
                // NPM whose Funded-set triggered us. Requires "record ownership across
                // business units" (modernized BUs) so owningbusinessunit is settable
                // independently of the (NPM) owner; states then read their own via
                // Business-Unit-depth read without an org-wide leak.
                var prioBu = prio.GetAttributeValue<EntityReference>("owningbusinessunit");
                if (prioBu != null)
                    create["owningbusinessunit"] = prioBu;

                service.Create(create);

                RecalcRf(service, tracing, rfId);
                return;
            }

            if (junctions.Count == 1 && junctions[0].RfId == rfId)
            {
                var j = junctions[0];
                if (j.Funded == targetFunded && j.Validated == targetValidated)
                {
                    tracing.Trace("Single junction already in sync — no write (idempotent).");
                    return;
                }

                tracing.Trace(
                    $"Updating junction {j.Id}: funded {j.Funded} → {targetFunded}, " +
                    $"validated {j.Validated} → {targetValidated}.");
                var update = new Entity(EntityNames.PrioritizationFunding, j.Id);
                update[PrioritizationFundingAttributes.FundedAmount] = targetFunded;
                update[PrioritizationFundingAttributes.ValidatedAmount] = targetValidated;
                service.Update(update);

                RecalcRf(service, tracing, rfId);
                return;
            }

            // Single junction to a DIFFERENT RF, or 2+ junctions — ambiguous
            // layout the NPM built by hand. Never silently re-point or collapse
            // it; leave the split to the Allocate to RFs dialog.
            tracing.Trace(
                $"Prio {prioId} has {junctions.Count} junction(s) not matching the single RF {rfId} — " +
                "ambiguous; leaving to manual allocation.");
        }

        private static void RecalcRf(IOrganizationService service, ITracingService tracing, Guid rfId)
        {
            tracing.Trace($"Recalculating RF {rfId} from the junction split.");
            PrioritizationRollupHelper.RecalculateRFFunded(service, rfId, tracing);
        }

        /// <summary>Active RF ids on a Requirement for a given Fiscal Year.</summary>
        private static List<Guid> GetActiveRfIds(IOrganizationService service, Guid requirementId, int fiscalYear)
        {
            var query = new QueryExpression(EntityNames.RequirementFunding)
            {
                ColumnSet = new ColumnSet(false),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            query.Criteria.AddCondition(
                RequirementFundingAttributes.Requirement, ConditionOperator.Equal, requirementId);
            query.Criteria.AddCondition(
                RequirementFundingAttributes.FiscalYear, ConditionOperator.Equal, fiscalYear);
            query.Criteria.AddCondition(
                RequirementFundingAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var result = service.RetrieveMultiple(query);
            var ids = new List<Guid>();
            foreach (var e in result.Entities)
                ids.Add(e.Id);
            return ids;
        }

        private struct JunctionRow
        {
            public Guid Id;
            public Guid RfId;
            public decimal Funded;
            public decimal Validated;
        }

        /// <summary>Active junction rows for a Prioritization.</summary>
        private static List<JunctionRow> GetActiveJunctions(IOrganizationService service, Guid prioId)
        {
            var query = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(
                    PrioritizationFundingAttributes.RequirementFunding,
                    PrioritizationFundingAttributes.FundedAmount,
                    PrioritizationFundingAttributes.ValidatedAmount),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            query.Criteria.AddCondition(
                PrioritizationFundingAttributes.Prioritization, ConditionOperator.Equal, prioId);
            query.Criteria.AddCondition(
                PrioritizationFundingAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active);

            var result = service.RetrieveMultiple(query);
            var rows = new List<JunctionRow>();
            foreach (var e in result.Entities)
            {
                var rfRef = e.GetAttributeValue<EntityReference>(
                    PrioritizationFundingAttributes.RequirementFunding);
                if (rfRef == null)
                    continue;
                rows.Add(new JunctionRow
                {
                    Id = e.Id,
                    RfId = rfRef.Id,
                    Funded = e.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m,
                    Validated = e.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.ValidatedAmount) ?? 0m,
                });
            }
            return rows;
        }
    }
}
