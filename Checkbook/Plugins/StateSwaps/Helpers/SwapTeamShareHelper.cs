using System;
using System.Collections.Generic;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.StateSwaps.Helpers
{
    /// <summary>
    /// Grants (or revokes) Read/Write/AppendTo access on a target record (a State
    /// Swap or a Swap Item) for the State Approver + State Administrator owner-teams
    /// belonging to a given state.
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
        /// for the given state on the target record. Silently skips any team the
        /// environment does not have.
        /// </summary>
        public static void GrantAccessForState(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference targetRef,
            EntityReference stateRef)
        {
            if (targetRef == null || stateRef == null) return;

            var abbr = ResolveStateAbbreviation(service, tracing, stateRef.Id);
            if (string.IsNullOrWhiteSpace(abbr)) return;

            foreach (var suffix in TeamSuffixes())
            {
                var teamRef = FindTeamByName(service, tracing, $"{abbr} - {suffix}");
                if (teamRef == null) continue;

                var grant = new GrantAccessRequest
                {
                    Target = targetRef,
                    PrincipalAccess = new PrincipalAccess
                    {
                        Principal = teamRef,
                        AccessMask = SwapAccessRights,
                    },
                };
                service.Execute(grant);
                tracing.Trace(
                    $"SwapTeamShareHelper: granted access to '{abbr} - {suffix}' on " +
                    $"{targetRef.LogicalName} {targetRef.Id}.");
            }
        }

        /// <summary>
        /// Revokes swap access from both state teams for the given state on the
        /// target record. Used when a StateA / StateB lookup changes on an existing
        /// swap.
        /// </summary>
        public static void RevokeAccessForState(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference targetRef,
            EntityReference stateRef)
        {
            if (targetRef == null || stateRef == null) return;

            var abbr = ResolveStateAbbreviation(service, tracing, stateRef.Id);
            if (string.IsNullOrWhiteSpace(abbr)) return;

            foreach (var suffix in TeamSuffixes())
            {
                var teamRef = FindTeamByName(service, tracing, $"{abbr} - {suffix}");
                if (teamRef == null) continue;

                var revoke = new RevokeAccessRequest
                {
                    Target = targetRef,
                    Revokee = teamRef,
                };
                service.Execute(revoke);
                tracing.Trace(
                    $"SwapTeamShareHelper: revoked access from '{abbr} - {suffix}' on " +
                    $"{targetRef.LogicalName} {targetRef.Id}.");
            }
        }

        /// <summary>
        /// Re-shares every child swap item under <paramref name="swapRef"/> with
        /// both states' teams. Backfills items that predate per-item sharing (or
        /// that were added after the parent's point-in-time cascade already fired),
        /// so a re-save of the swap header repairs their visibility. Shares
        /// explicitly rather than trusting the parent 1:N cascade, so it holds even
        /// if the relationship's Share behavior is ever changed. Idempotent —
        /// re-granting an existing share is a no-op.
        /// </summary>
        public static void ShareAllItemsForStates(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference swapRef,
            EntityReference stateA,
            EntityReference stateB)
        {
            if (swapRef == null) return;

            var query = new QueryExpression(EntityNames.SwapItem)
            {
                ColumnSet = new ColumnSet(false), // ids only
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            SwapItemAttributes.StateSwap, ConditionOperator.Equal, swapRef.Id),
                    },
                },
            };

            var items = service.RetrieveMultiple(query).Entities;
            tracing.Trace(
                $"SwapTeamShareHelper: re-sharing {items.Count} item(s) under swap {swapRef.Id}.");

            foreach (var item in items)
            {
                var itemRef = item.ToEntityReference();
                GrantAccessForState(service, tracing, itemRef, stateA);
                GrantAccessForState(service, tracing, itemRef, stateB);
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
