using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Makes past fiscal years immutable by construction. Rejects any Update that
    /// would change the spend-plan stamp of a Prioritization Funding, or the
    /// planning values of a book_spendplan row, once that record's FY is below
    /// the active planning FY — no matter the path (bulk edit, import, a
    /// mis-scoped cascade, a future refactor). The flag-flip cascades are already
    /// FY-gated; this is the invariant that backs them up.
    ///
    /// Legacy (FY26) spend-plan rows — anchored on book_prioritization /
    /// book_requirement / book_unfundedrequest with no FY27 markers — are out of
    /// scope; their freeze is the separate "FY26 untouched" rule.
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, Update on:
    ///   • book_prioritizationfunding — filter: book_centrallymanaged,
    ///     book_spendplanmode, book_lineofaccounting.
    ///   • book_spendplan — filter: the FY27 planning fields (see PfProtected /
    ///     SpendPlanProtected below).
    /// No pre-image required — resolves FY from live related records.
    /// </remarks>
    public class SpendPlanImmutabilityGuard : PluginBase
    {
        private static readonly string[] PfProtected =
        {
            PrioritizationFundingAttributes.CentrallyManaged,
            PrioritizationFundingAttributes.SpendPlanMode,
            PrioritizationFundingAttributes.LineOfAccounting,
        };

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var activeFy = FiscalYearHelper.GetActivePlanningFiscalYear(service, tracing);

            if (context.PrimaryEntityName == EntityNames.PrioritizationFunding)
                GuardPf(service, tracing, target, activeFy);
            else if (context.PrimaryEntityName == EntityNames.SpendPlan)
                GuardSpendPlan(service, tracing, target, activeFy);
        }

        private static void GuardPf(
            IOrganizationService service, ITracingService tracing, Entity target, int activeFy)
        {
            if (!TouchesAny(target, PfProtected))
                return;

            var fy = ResolvePfFiscalYear(service, target.Id);
            if (fy == null)
            {
                tracing.Trace("PF FY unknown; not blocking.");
                return;
            }
            if (fy.Value < activeFy)
                throw new InvalidPluginExecutionException(
                    $"This Prioritization Funding belongs to FY {fy} (before the active planning " +
                    $"year {activeFy}) and its spend-plan classification is locked. Past fiscal " +
                    "years cannot be changed.");
        }

        private static void GuardSpendPlan(
            IOrganizationService service, ITracingService tracing, Entity target, int activeFy)
        {
            var protectedFields = SpendPlanProtected();
            if (!TouchesAny(target, protectedFields))
                return;

            var fy = ResolveSpendPlanFiscalYear(service, target);
            if (fy == null)
            {
                tracing.Trace("Spend-plan row is legacy or FY unknown; not blocking (out of scope).");
                return;
            }
            if (fy.Value < activeFy)
                throw new InvalidPluginExecutionException(
                    $"This spend plan belongs to FY {fy} (before the active planning year " +
                    $"{activeFy}) and is locked. Past fiscal years cannot be changed.");
        }

        private static string[] SpendPlanProtected()
        {
            return SpendPlanAttributes.DecimalMonths.Concat(new[]
            {
                SpendPlanAttributes.PrioritizationFunding,
                SpendPlanAttributes.FundCenter,
                SpendPlanAttributes.RowType,
                SpendPlanAttributes.State,
                SpendPlanAttributes.Fund,
                SpendPlanAttributes.Sag,
                SpendPlanAttributes.FiscalYear,
                SpendPlanAttributes.FundedAmount,
            }).ToArray();
        }

        private static bool TouchesAny(Entity target, string[] attrs)
        {
            return attrs.Any(target.Contains);
        }

        /// <summary>PF → Prio → FY, falling back to PF → RF → FY.</summary>
        private static int? ResolvePfFiscalYear(IOrganizationService service, Guid pfId)
        {
            var pf = service.Retrieve(EntityNames.PrioritizationFunding, pfId,
                new ColumnSet(
                    PrioritizationFundingAttributes.Prioritization,
                    PrioritizationFundingAttributes.RequirementFunding));

            var prioRef = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization);
            if (prioRef != null)
            {
                var fy = RetrieveOptionSet(service, EntityNames.Prioritization, prioRef.Id,
                    PrioritizationAttributes.FiscalYear);
                if (fy != null) return fy;
            }

            var rfRef = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.RequirementFunding);
            if (rfRef != null)
                return RetrieveOptionSet(service, EntityNames.RequirementFunding, rfRef.Id,
                    RequirementFundingAttributes.FiscalYear);

            return null;
        }

        /// <summary>
        /// FY for a spend-plan row by anchor: Mode-C rows carry it directly;
        /// Mode-B via PF → Prio; Mode-A via RF. Legacy rows return null (skip).
        /// </summary>
        private static int? ResolveSpendPlanFiscalYear(IOrganizationService service, Entity target)
        {
            // Need the effective anchors — read the live row and overlay target.
            var row = service.Retrieve(EntityNames.SpendPlan, target.Id, new ColumnSet(
                SpendPlanAttributes.FiscalYear,
                SpendPlanAttributes.PrioritizationFunding,
                SpendPlanAttributes.RequirementFunding,
                SpendPlanAttributes.State,
                SpendPlanAttributes.Fund,
                SpendPlanAttributes.Sag));

            var fy = Effective(target, row, SpendPlanAttributes.FiscalYear);
            var stateRef = EffectiveRef(target, row, SpendPlanAttributes.State);
            if (fy is OptionSetValue fyOs && stateRef != null)
                return fyOs.Value; // Mode C — explicit FY

            var pfRef = EffectiveRef(target, row, SpendPlanAttributes.PrioritizationFunding);
            if (pfRef != null) // Mode B
            {
                var prioFy = ResolvePfFiscalYear(service, pfRef.Id);
                if (prioFy != null) return prioFy;
            }

            var rfRef = EffectiveRef(target, row, SpendPlanAttributes.RequirementFunding);
            if (rfRef != null) // Mode A
                return RetrieveOptionSet(service, EntityNames.RequirementFunding, rfRef.Id,
                    RequirementFundingAttributes.FiscalYear);

            // Explicit FY with no recognizable anchor still counts (defensive).
            if (fy is OptionSetValue os) return os.Value;
            return null;
        }

        private static int? RetrieveOptionSet(
            IOrganizationService service, string entity, Guid id, string attr)
        {
            var e = service.Retrieve(entity, id, new ColumnSet(attr));
            return e.GetAttributeValue<OptionSetValue>(attr)?.Value;
        }

        private static object Effective(Entity target, Entity row, string attr)
        {
            if (target.Contains(attr)) return target[attr];
            return row.Contains(attr) ? row[attr] : null;
        }

        private static EntityReference EffectiveRef(Entity target, Entity row, string attr)
        {
            return Effective(target, row, attr) as EntityReference;
        }
    }
}
