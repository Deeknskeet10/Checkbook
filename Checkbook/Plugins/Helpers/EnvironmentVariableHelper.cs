using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Reads Dataverse environment variables from plugin code.
    ///
    /// Each env variable has two records:
    ///   environmentvariabledefinition — schema + default value (always present)
    ///   environmentvariablevalue     — per-environment override (optional)
    ///
    /// Looks up the definition by <c>schemaname</c>, then prefers the override
    /// over the default. Missing definitions throw; missing overrides quietly
    /// fall back to the default.
    /// </summary>
    public static class EnvironmentVariableHelper
    {
        /// <summary>
        /// Returns the env-var value (override if present, else default).
        /// Throws when no definition matches the schema name.
        /// </summary>
        public static string GetValue(IOrganizationService service, string schemaName)
        {
            if (string.IsNullOrWhiteSpace(schemaName))
                throw new ArgumentException("Schema name is required.", nameof(schemaName));

            var defQuery = new QueryExpression("environmentvariabledefinition")
            {
                ColumnSet = new ColumnSet("environmentvariabledefinitionid", "defaultvalue"),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions = { new ConditionExpression("schemaname", ConditionOperator.Equal, schemaName) },
                },
                NoLock = true,
            };
            var definition = service.RetrieveMultiple(defQuery).Entities.FirstOrDefault();
            if (definition == null)
                throw new InvalidPluginExecutionException(
                    $"Environment variable '{schemaName}' is not defined in this environment.");

            var valueQuery = new QueryExpression("environmentvariablevalue")
            {
                ColumnSet = new ColumnSet("value"),
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
            var overrideRecord = service.RetrieveMultiple(valueQuery).Entities.FirstOrDefault();

            return overrideRecord != null
                ? overrideRecord.GetAttributeValue<string>("value")
                : definition.GetAttributeValue<string>("defaultvalue");
        }

        /// <summary>
        /// Reads an env var that holds a GUID (e.g. an LOA / OPR record id).
        /// Throws with a clear, actionable message if the value is missing or unparsable.
        /// </summary>
        public static Guid GetGuid(IOrganizationService service, string schemaName)
        {
            var raw = GetValue(service, schemaName);
            if (string.IsNullOrWhiteSpace(raw))
                throw new InvalidPluginExecutionException(
                    $"Environment variable '{schemaName}' is empty. Set its value to a record GUID.");

            if (!Guid.TryParse(raw.Trim(), out var id))
                throw new InvalidPluginExecutionException(
                    $"Environment variable '{schemaName}' value '{raw}' is not a valid GUID.");

            return id;
        }
    }
}
