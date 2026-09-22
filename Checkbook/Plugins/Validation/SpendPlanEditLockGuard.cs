using System.Linq;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Admin edit-lock for spend plans. When the environment variable
    /// <c>book_LockSpendPlanEdits</c> is on, this Pre-Operation guard blocks
    /// direct user Create / Update / Delete of book_spendplan rows so a
    /// Checkbook Administrator can freeze all planning while (for example) a
    /// review or a roll-forward is in progress. Toggled from the Admin Center
    /// via <see cref="Admin.ToggleSpendPlanLockPlugin"/>.
    ///
    /// "Direct user write" means a top-level operation — a form save, the
    /// Spend Plan PCF, bulk edit, an Excel import, or a raw Web API call. Those
    /// have no <see cref="IPluginExecutionContext.ParentContext"/>. Writes made
    /// by other plugins (the roll-ups that recompute book_fundedamount, the
    /// future automated Actual process, a Turn-In / Realignment cascade) run
    /// under a parent context and pass through untouched — same ancestor-walk
    /// idea as <see cref="FundedAmountLockBase"/>.
    ///
    /// Only user-editable plan content is guarded (the 12 decimal months, the
    /// anchors, Fund Center and Row Type). A top-level write that touches only
    /// the roll-up-maintained book_fundedamount is left alone, so an async
    /// roll-up workflow is never caught by the lock. Delete is always blocked
    /// while locked.
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, book_spendplan — Create, Update, Delete.
    /// No filtering attributes, no images required.
    /// </remarks>
    public class SpendPlanEditLockGuard : PluginBase
    {
        /// <summary>User-editable plan-content fields. A write touching any of
        /// these is a "plan edit" and is subject to the lock.</summary>
        private static readonly string[] GuardedFields =
            SpendPlanAttributes.DecimalMonths.Concat(new[]
            {
                SpendPlanAttributes.PrioritizationFunding,
                SpendPlanAttributes.RequirementFunding,
                SpendPlanAttributes.State,
                SpendPlanAttributes.Fund,
                SpendPlanAttributes.Sag,
                SpendPlanAttributes.FiscalYear,
                SpendPlanAttributes.FundCenter,
                SpendPlanAttributes.RowType,
            }).ToArray();

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.SpendPlan) return;

            var message = context.MessageName;
            if (message != "Create" && message != "Update" && message != "Delete")
                return;

            // System-generated write (roll-up, cascade, automated Actual process)
            // — always allowed. Only top-level user writes are lockable.
            if (context.ParentContext != null)
            {
                tracing.Trace("SpendPlanEditLock: parent context present — system write, allow.");
                return;
            }

            // A pure roll-up correction touches only book_fundedamount; leave it.
            if (message == "Update")
            {
                var target = GetTarget(context);
                if (!GuardedFields.Any(target.Contains))
                {
                    tracing.Trace("SpendPlanEditLock: no guarded plan field changed — allow.");
                    return;
                }
            }

            if (!EnvironmentVariableHelper.GetBool(
                    service, EnvironmentVariableKeys.LockSpendPlanEdits))
            {
                tracing.Trace("SpendPlanEditLock: toggle is OFF — allow.");
                return;
            }

            tracing.Trace(
                $"SpendPlanEditLock: blocking direct {message} by user " +
                $"{context.InitiatingUserId} while the spend plan lock is on.");
            throw new InvalidPluginExecutionException(
                "Spend plans are currently locked by a Checkbook Administrator and " +
                "cannot be edited. Try again after the lock is lifted from the Admin Center.");
        }
    }
}
