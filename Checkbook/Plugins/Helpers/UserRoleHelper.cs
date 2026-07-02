using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Checks whether a Dataverse user holds any of a given set of security roles.
    /// Used by approval-gating plugins that need to enforce role-based authorization
    /// beyond what table-level privileges express — e.g. only "Book - State Approver"
    /// or "Book - State Administrator" can flip a Turn-In's State Approval flag,
    /// even though other State roles have write access to the table.
    ///
    /// Matching is case-insensitive on the role name; role names come straight
    /// from the Roles/*.xml source of truth (e.g. "Book - State Approver").
    /// </summary>
    public static class UserRoleHelper
    {
        /// <summary>
        /// Returns true if <paramref name="userId"/> is assigned to at least one role
        /// whose name matches (case-insensitive) any of <paramref name="roleNames"/>.
        /// Roles inherited via team membership are included.
        /// </summary>
        public static bool HasAnyRole(
            IOrganizationService service,
            ITracingService tracing,
            Guid userId,
            params string[] roleNames)
        {
            if (roleNames == null || roleNames.Length == 0) return false;
            if (userId == Guid.Empty) return false;

            // One FetchXml against role, filtering by name and by the user's
            // direct role assignments OR the user's team-role assignments.
            // Faster than two queries and matches how Dataverse resolves
            // "effective roles" for a user at runtime.
            var namesList = string.Join(
                string.Empty,
                roleNames.Select(n => $"<value>{System.Security.SecurityElement.Escape(n)}</value>"));

            var fetch = $@"
                <fetch top='1' distinct='true'>
                    <entity name='role'>
                        <attribute name='name'/>
                        <filter>
                            <condition attribute='name' operator='in'>{namesList}</condition>
                        </filter>
                        <link-entity name='systemuserroles' from='roleid' to='roleid' intersect='true'>
                            <filter>
                                <condition attribute='systemuserid' operator='eq' value='{userId}'/>
                            </filter>
                        </link-entity>
                    </entity>
                </fetch>";

            var direct = service.RetrieveMultiple(new FetchExpression(fetch));
            if (direct.Entities.Count > 0)
            {
                tracing?.Trace(
                    $"UserRoleHelper: user {userId} matched role '{direct.Entities[0].GetAttributeValue<string>("name")}' (direct).");
                return true;
            }

            // Team-derived roles — a user picks up roles from every team they belong to.
            var teamFetch = $@"
                <fetch top='1' distinct='true'>
                    <entity name='role'>
                        <attribute name='name'/>
                        <filter>
                            <condition attribute='name' operator='in'>{namesList}</condition>
                        </filter>
                        <link-entity name='teamroles' from='roleid' to='roleid' intersect='true'>
                            <link-entity name='teammembership' from='teamid' to='teamid' intersect='true'>
                                <filter>
                                    <condition attribute='systemuserid' operator='eq' value='{userId}'/>
                                </filter>
                            </link-entity>
                        </link-entity>
                    </entity>
                </fetch>";

            var team = service.RetrieveMultiple(new FetchExpression(teamFetch));
            if (team.Entities.Count > 0)
            {
                tracing?.Trace(
                    $"UserRoleHelper: user {userId} matched role '{team.Entities[0].GetAttributeValue<string>("name")}' (team).");
                return true;
            }

            tracing?.Trace(
                $"UserRoleHelper: user {userId} holds none of [{string.Join(", ", roleNames)}].");
            return false;
        }
    }
}
