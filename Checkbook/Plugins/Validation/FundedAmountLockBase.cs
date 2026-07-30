using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Shared Pre-Operation guard that blocks direct REDUCTIONS of a funded
    /// amount field when the admin toggle <c>book_LockManualFundedEdits</c>
    /// is on. Increases (and no-op writes) are always allowed — the lock only
    /// protects against funding being manually taken away outside the
    /// authorized tools: Turn-Ins, Realignments, State Swaps, the Distribution
    /// generator, and the roll-up plugins that recompute funded totals.
    ///
    /// "Am I inside an authorized operation?" is answered by walking
    /// <see cref="IPluginExecutionContext.ParentContext"/> — the same pattern
    /// <see cref="RequirementFundingTDPValidator"/> uses. A direct manual edit
    /// (form save, bulk edit, Excel import, Web API call) has no parent
    /// context, so it never matches. SharedVariables is deliberately avoided;
    /// see the note at the top of <c>RealignmentProcessor</c> for why.
    ///
    /// Subclasses supply the entity, the locked attribute, and any extra
    /// authorized ancestors (the entities whose roll-up plugins write the
    /// field). See <see cref="PrioritizationFundedAmountLock"/> and
    /// <see cref="RequirementFundingFundedAmountLock"/> for registration
    /// intent.
    /// </summary>
    public abstract class FundedAmountLockBase : PluginBase
    {
        private const string LockEnvVar = "book_LockManualFundedEdits";

        /// <summary>Logical name of the entity this guard protects.</summary>
        protected abstract string EntityName { get; }

        /// <summary>Logical name of the locked funded amount attribute.</summary>
        protected abstract string LockedAttribute { get; }

        /// <summary>Display label used in the blocked-save error message.</summary>
        protected abstract string FieldLabel { get; }

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityName) return;
            if (context.MessageName != "Update") return;

            var target = GetTarget(context);
            if (!target.Contains(LockedAttribute)) return;

            // Ancestor-walk first — cheap and covers the "authorized tool /
            // roll-up" path without needing the pre-image or the env var at
            // all when the answer is already yes.
            if (IsInsideAuthorizedOperation(context, tracing))
            {
                tracing.Trace("FundedAmountLock: authorized ancestor found — allow.");
                return;
            }

            // Only reductions are locked. Form save-all often ships the field
            // unchanged in Target, so this also handles the no-op case.
            var newValue = NumericHelper.ToDecimal(target[LockedAttribute], 0m);
            var oldValue = GetCurrentValue(context, service);
            if (newValue >= oldValue)
            {
                tracing.Trace(
                    $"FundedAmountLock: {oldValue} -> {newValue} is not a reduction — allow.");
                return;
            }

            if (!EnvironmentVariableHelper.GetBool(service, LockEnvVar))
            {
                tracing.Trace("FundedAmountLock: toggle is OFF — allow.");
                return;
            }

            tracing.Trace(
                $"FundedAmountLock: blocking direct reduction {oldValue} -> {newValue} " +
                $"by user {context.InitiatingUserId} on {EntityName} {context.PrimaryEntityId}.");
            throw new InvalidPluginExecutionException(
                $"{FieldLabel} cannot be reduced directly. Reductions must come " +
                "through Turn-Ins, Realignments, State Swaps, or the Distribution " +
                "generator; increases are allowed. A Checkbook Administrator can " +
                "unlock this temporarily from the Admin Center.");
        }

        /// <summary>
        /// True when <paramref name="message"/> on <paramref name="entityName"/>
        /// anywhere up the parent chain marks this write as system-generated.
        /// Base covers the four funding tools; subclasses add the roll-up
        /// source entities that legitimately recompute their locked field.
        /// </summary>
        protected virtual bool IsAuthorizedAncestor(string message, string entityName)
        {
            if (message == "Update" && (
                    entityName == EntityNames.Turnin ||
                    entityName == EntityNames.Realignments ||
                    entityName == EntityNames.StateSwap))
                return true;

            // book_GenerateDistributions is a bound-none Custom API; the
            // MessageName on its context matches the API's unique name.
            return message == "book_GenerateDistributions";
        }

        /// <summary>Helper for subclasses: any writing message on a roll-up source.</summary>
        protected static bool IsRollupSourceWrite(string message, string entityName, string sourceEntity)
        {
            return entityName == sourceEntity &&
                   (message == "Create" || message == "Update" || message == "Delete");
        }

        private bool IsInsideAuthorizedOperation(
            IPluginExecutionContext ctx, ITracingService tracing)
        {
            for (var ancestor = ctx.ParentContext; ancestor != null; ancestor = ancestor.ParentContext)
            {
                if (IsAuthorizedAncestor(ancestor.MessageName, ancestor.PrimaryEntityName))
                {
                    tracing?.Trace(
                        $"FundedAmountLock: ancestor authorized — {ancestor.MessageName} " +
                        $"on {ancestor.PrimaryEntityName}.");
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// The stored (pre-write) value: from the registered pre-image when
        /// available, otherwise retrieved — Pre-Operation runs before the
        /// write, so the database still holds the old value.
        /// </summary>
        private decimal GetCurrentValue(IPluginExecutionContext context, IOrganizationService service)
        {
            var preImage = TryGetPreImage(context);
            var record = preImage ?? service.Retrieve(
                EntityName, context.PrimaryEntityId, new ColumnSet(LockedAttribute));
            return NumericHelper.ToDecimal(
                record.Contains(LockedAttribute) ? record[LockedAttribute] : null, 0m);
        }
    }
}
