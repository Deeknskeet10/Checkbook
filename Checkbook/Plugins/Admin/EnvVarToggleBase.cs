using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Admin
{
    /// <summary>
    /// Shared body for the Admin Center "lock / unlock" Custom APIs: gate on
    /// <see cref="RoleNames.CheckbookAdministrator"/> (directly or via a team —
    /// enforced here rather than via the Custom API's allowed step type so the
    /// error is readable), flip a Boolean environment variable, and return the new
    /// state.
    ///
    /// Input parameters: none.
    /// Output parameters:
    ///   <c>IsLocked</c> (Boolean) — the toggle state AFTER this call. The
    ///                               button reads this to decide the toast text.
    /// </summary>
    public abstract class EnvVarToggleBase : PluginBase
    {
        private const string OutputIsLocked = "IsLocked";

        /// <summary>The Custom API unique name this handler serves.</summary>
        protected abstract string MessageName { get; }

        /// <summary>Schema name of the Boolean environment variable to flip.</summary>
        protected abstract string EnvVarSchema { get; }

        /// <summary>Lock name for messages, e.g. "Spend Plan".</summary>
        protected abstract string LockLabel { get; }

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != MessageName) return;

            if (!UserRoleHelper.HasAnyRole(
                    service, tracing, context.InitiatingUserId,
                    RoleNames.CheckbookAdministrator))
            {
                throw new InvalidPluginExecutionException(
                    $"You must have the '{RoleNames.CheckbookAdministrator}' role " +
                    $"to change the {LockLabel} lock.");
            }

            var nextLocked = EnvironmentVariableHelper.ToggleBool(service, tracing, EnvVarSchema);
            context.OutputParameters[OutputIsLocked] = nextLocked;
        }
    }
}
