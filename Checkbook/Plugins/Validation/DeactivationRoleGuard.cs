using System;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Validation guard that blocks record deactivation on every
    /// <c>book_*</c> table unless the initiating user holds the
    /// "Book - State Administrator" or "Book - Checkbook Administrator" role.
    ///
    /// Only *direct user* deactivations are gated. Automated deactivations are
    /// allowed through:
    ///   • pipeline depth &gt; 1 — our own plugins (TurnInDeactivator, the
    ///     Realignment/Swap/Distribution processors) deactivate records as a
    ///     side effect of an approval the user is authorized to perform;
    ///   • a surviving ParentContext — Custom APIs and other server-side
    ///     operations wrap their child Updates in a parent context.
    /// Platform wrapper messages (SetState conversion, ExecuteMultiple /
    /// ExecuteTransaction batches) are NOT treated as automated — a grid
    /// bulk-deactivate arrives as ExecuteMultiple and legacy clients still
    /// send SetState, and both are direct user actions.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update | Entity: none (global step — fires for all tables)
    ///   • Stage:   PreValidation (10) | Mode: Sync | Rank: 1
    ///   • No filtering attributes (not supported on global steps) and no
    ///     images — the plugin exits immediately unless Target carries
    ///     statecode = Inactive on a book_* table.
    /// </summary>
    public class DeactivationRoleGuard : PluginBase
    {
        private const string BookPrefix = "book_";
        private const int InactiveStateCode = 1;

        private const string BlockedMessage =
            "Only State Administrators and Checkbook Administrators can " +
            "deactivate Checkbook records. Contact an administrator if this " +
            "record needs to be deactivated.";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != "Update") return;

            var entityName = context.PrimaryEntityName;
            if (entityName == null ||
                !entityName.StartsWith(BookPrefix, StringComparison.Ordinal))
                return;

            // Global step: never assume Target shape — bail quietly instead of
            // throwing like GetTarget does.
            if (!(context.InputParameters.TryGetValue("Target", out var raw) &&
                  raw is Entity target))
                return;

            var stateCode = target.GetAttributeValue<OptionSetValue>("statecode");
            if (stateCode == null || stateCode.Value != InactiveStateCode) return;

            if (context.Depth > 1)
            {
                tracing.Trace(
                    $"DeactivationRoleGuard: depth {context.Depth} — plugin-initiated, allow.");
                return;
            }

            var ancestor = context.ParentContext;
            while (ancestor != null && IsPlatformWrapper(ancestor.MessageName))
                ancestor = ancestor.ParentContext;

            if (ancestor != null)
            {
                tracing.Trace(
                    $"DeactivationRoleGuard: parent operation '{ancestor.MessageName}' — automated, allow.");
                return;
            }

            // System Administrator is allowed so cascade-deactivation flows
            // (Requirement-Deactivation etc.) keep working when their Dataverse
            // connection runs under a service account.
            if (UserRoleHelper.HasAnyRole(
                    service, tracing, context.InitiatingUserId,
                    RoleNames.StateAdministrator,
                    RoleNames.CheckbookAdministrator,
                    RoleNames.SystemAdministrator))
            {
                tracing.Trace("DeactivationRoleGuard: user holds an admin role — allow.");
                return;
            }

            tracing.Trace(
                $"DeactivationRoleGuard: blocking deactivation of {entityName} " +
                $"{context.PrimaryEntityId} by user {context.InitiatingUserId}.");
            throw new InvalidPluginExecutionException(BlockedMessage);
        }
    }
}
