using System;
using System.Collections.Generic;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.StateSwaps.Helpers
{
    /// <summary>
    /// Grants (or revokes) Read/Write/AppendTo access on a State Swap for the
    /// State Approver + State Administrator owner-teams belonging to a given state.
    /// Teams are looked up by name — <c>"{StateAbbreviation} - {RoleSuffix}"</c>,
    /// e.g. <c>"AL - State Approver"</c> and <c>"AL - State Administrator"</c>.
    /// Missing teams are logged and skipped so record creation isn't blocked by
    /// an environment misconfiguration.
    /// </summary>
    public static class SwapTeamShareHelper
    {
        // Suffixes match what appears in the team name after the abbreviation
        // and separator. Kept in sync with <see cref="RoleNames"/> but *without*
        // the "Book - " prefix since teams follow the schema doc's convention.
        public const string ApproverSuffix = "State Approver";
        public const string AdministratorSuffix = "State Administrator";

        private static readonly AccessRights SwapAccessRights =
            AccessRights.ReadAccess | AccessRights.WriteAccess | AccessRights.AppendToAccess;

        /// <summary>
        /// Grants swap access rights to both state teams (Approver + Administrator)
        /// for the given state. Silently skips any team the environment does not have.
        /// </summary>
        public static void GrantAccessForState(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference swapRef,
            EntityReference stateRef)
        {
            if (swapRef == null || stateRef == null) return;

            var abbr = ResolveStateAbbreviation(service, tracing, stateRef.Id);
            if (string.IsNullOrWhiteSpace(abbr)) return;

            foreach (var suffix in TeamSuffixes())
            {
                var teamRef = FindTeamByName(service, tracing, $"{abbr} - {suffix}");
                if (teamRef == null) continue;

                var grant = new GrantAccessRequest
                {
                    Target = swapRef,
                    PrincipalAccess = new PrincipalAccess
                    {
                        Principal = teamRef,
                        AccessMask = SwapAccessRights,
                    },
                };
                service.Execute(grant);
                tracing.Trace(
                    $"SwapTeamShareHelper: granted access to '{abbr} - {suffix}' on swap {swapRef.Id}.");
            }
        }

        /// <summary>
        /// Revokes swap access from both state teams for the given state. Used when
        /// a StateA / StateB lookup changes on an existing swap.
        /// </summary>
        public static void RevokeAccessForState(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference swapRef,
            EntityReference stateRef)
        {
            if (swapRef == null || stateRef == null) return;

            var abbr = ResolveStateAbbreviation(service, tracing, stateRef.Id);
            if (string.IsNullOrWhiteSpace(abbr)) return;

            foreach (var suffix in TeamSuffixes())
            {
                var teamRef = FindTeamByName(service, tracing, $"{abbr} - {suffix}");
                if (teamRef == null) continue;

                var revoke = new RevokeAccessRequest
                {
                    Target = swapRef,
                    Revokee = teamRef,
                };
                service.Execute(revoke);
                tracing.Trace(
                    $"SwapTeamShareHelper: revoked access from '{abbr} - {suffix}' on swap {swapRef.Id}.");
            }
        }

        private static IEnumerable<string> TeamSuffixes()
        {
            yield return ApproverSuffix;
            yield return AdministratorSuffix;
        }

        private static string ResolveStateAbbreviation(
            IOrganizationService service, ITracingService tracing, Guid stateId)
        {
            try
            {
                var state = service.Retrieve(
                    EntityNames.State, stateId,
                    new ColumnSet(StateAttributes.Abbreviation));
                return state.GetAttributeValue<string>(StateAttributes.Abbreviation);
            }
            catch (Exception ex)
            {
                tracing.Trace($"SwapTeamShareHelper: could not resolve State {stateId}: {ex.Message}");
                return null;
            }
        }

        private static EntityReference FindTeamByName(
            IOrganizationService service, ITracingService tracing, string teamName)
        {
            // Team is owner-team (teamtype 0) — access teams (2) have different
            // sharing semantics we don't want here.
            var query = new QueryExpression("team")
            {
                ColumnSet = new ColumnSet("teamid", "name"),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression("name", ConditionOperator.Equal, teamName),
                        new ConditionExpression("teamtype", ConditionOperator.Equal, 0),
                    },
                },
            };

            var results = service.RetrieveMultiple(query).Entities;
            if (results.Count == 0)
            {
                tracing.Trace(
                    $"SwapTeamShareHelper: team '{teamName}' not found — skipping share.");
                return null;
            }
            return results[0].ToEntityReference();
        }
    }
}
