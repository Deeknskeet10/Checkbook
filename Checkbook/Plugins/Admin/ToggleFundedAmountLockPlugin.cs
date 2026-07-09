using System.Linq;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Checkbook.Plugins.Admin
{
    /// <summary>
    /// Custom API handler for <c>book_ToggleFundedAmountLock</c>.
    ///
    /// Flips the <c>book_LockManualFundedEdits</c> environment variable value
    /// record. When it's on, <see cref="Validation.PrioritizationFundedAmountLock"/>
    /// blocks direct edits to Prioritization Funded Amount (TDP); when it's
    /// off, direct edits are allowed. Backs the "Lock Funding" / "Unlock
    /// Funding" command bar button in the Admin Center MDA.
    ///
    /// Only users holding <see cref="RoleNames.CheckbookAdministrator"/>
    /// (directly or via a team) may execute this API — enforced here rather
    /// than via Custom API "Allowed Custom Processing Step Type" so the error
    /// message is readable.
    ///
    /// Input parameters: none.
    /// Output parameters:
    ///   <c>IsLocked</c> (Boolean) — the toggle state AFTER this call. The
    ///                               button reads this to decide the toast text.
    /// </summary>
    public class ToggleFundedAmountLockPlugin : PluginBase
    {
        private const string MessageName    = "book_ToggleFundedAmountLock";
        private const string EnvVarSchema   = "book_LockManualFundedEdits";
        private const string OutputIsLocked = "IsLocked";

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
                    "to change the Funded Amount lock.");
            }

            var (definitionId, valueRecord, currentlyLocked) = LoadEnvVar(service);
            var nextLocked = !currentlyLocked;
            var nextValue = nextLocked ? "true" : "false";

            if (valueRecord == null)
            {
                var toCreate = new Entity("environmentvariablevalue");
                toCreate["environmentvariabledefinitionid"] = new EntityReference(
                    "environmentvariabledefinition", definitionId);
                toCreate["value"] = nextValue;
                service.Create(toCreate);
                tracing.Trace(
                    $"ToggleFundedAmountLock: created value record → {nextValue}.");
            }
            else
            {
                var toUpdate = new Entity("environmentvariablevalue", valueRecord.Id);
                toUpdate["value"] = nextValue;
                service.Update(toUpdate);
                tracing.Trace(
                    $"ToggleFundedAmountLock: updated value record → {nextValue}.");
            }

            context.OutputParameters[OutputIsLocked] = nextLocked;
        }

        private static (System.Guid defId, Entity valueRec, bool currentlyLocked) LoadEnvVar(
            IOrganizationService service)
        {
            var defQuery = new QueryExpression("environmentvariabledefinition")
            {
                ColumnSet = new ColumnSet("environmentvariabledefinitionid", "defaultvalue"),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression("schemaname", ConditionOperator.Equal, EnvVarSchema),
                    },
                },
                NoLock = true,
            };
            var definition = service.RetrieveMultiple(defQuery).Entities.FirstOrDefault();
            if (definition == null)
            {
                throw new InvalidPluginExecutionException(
                    $"Environment variable '{EnvVarSchema}' is not defined in this environment. " +
                    "Import it before enabling the Funded Amount lock button.");
            }

            var valQuery = new QueryExpression("environmentvariablevalue")
            {
                ColumnSet = new ColumnSet("environmentvariablevalueid", "value"),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            "environmentvariabledefinitionid",
                            ConditionOperator.Equal,
                            definition.Id),
                    },
                },
                NoLock = true,
            };
            var valRec = service.RetrieveMultiple(valQuery).Entities.FirstOrDefault();

            var effective = valRec != null
                ? valRec.GetAttributeValue<string>("value")
                : definition.GetAttributeValue<string>("defaultvalue");

            var currentlyLocked = ParseBool(effective);
            return (definition.Id, valRec, currentlyLocked);
        }

        private static bool ParseBool(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return false;
            switch (raw.Trim().ToLowerInvariant())
            {
                case "true":
                case "yes":
                case "1":
                    return true;
                default:
                    return false;
            }
        }
    }
}
