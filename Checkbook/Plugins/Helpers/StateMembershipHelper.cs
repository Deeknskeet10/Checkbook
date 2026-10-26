using System;
using System.Collections.Generic;
using System.Security;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// "Is this user part of a state?" — two different questions:
    ///
    ///   • <see cref="IsRestrictedStateUser"/> — does the user sit on ANY geographic
    ///     state owner team (<c>"{ABBR} - State Approver/Administrator"</c>, see
    ///     <see cref="TeamNames"/>)? Non-geographic entities (PEC, WTC) are exempted by
    ///     the caller. Used for state-only rules.
    ///   • <see cref="IsUserInStateBU"/> — is the user in a SPECIFIC state's business
    ///     unit (the book_state's owning BU or any descendant)? Used to stop a State
    ///     Approver in State X acting for State Y — the role check alone is not enough.
    ///     Some states segregate users into child Fund Center BUs (e.g. A18TX under
    ///     TEXAS), so the user BU's parent chain is walked upward looking for the
    ///     state BU.
    /// </summary>
    public static class StateMembershipHelper
    {
        // Backstop against a malformed/cyclic BU tree so the parent walk cannot
        // loop forever. Real BU trees are only a handful of levels deep.
        private const int MaxBusinessUnitDepth = 50;

        /// <summary>
        /// True when <paramref name="userId"/> belongs to at least one
        /// <c>"{ABBR} - State Approver/Administrator"</c> owner team whose ABBR is NOT
        /// in <paramref name="exemptAbbreviations"/> (case-insensitive — Dataverse
        /// <c>like</c> is case-insensitive). Used to enforce state-only rules (e.g. a
        /// regular state may not turn in funds outside a Prioritization) while
        /// exempting non-geographic entities such as PEC and WTC. Users with no state
        /// owner team (Checkbook Administrators, Budget Executors, service accounts)
        /// return false.
        /// </summary>
        public static bool IsRestrictedStateUser(
            IOrganizationService service,
            ITracingService tracing,
            Guid userId,
            params string[] exemptAbbreviations)
        {
            if (userId == Guid.Empty) return false;

            // name LIKE '% - State Approver' OR '% - State Administrator'
            var suffixFilter = new StringBuilder();
            foreach (var suffix in TeamNames.StateTeamSuffixes)
                suffixFilter.Append(
                    $"<condition attribute='name' operator='like' value='% - {SecurityElement.Escape(suffix)}' />");

            // AND name NOT LIKE 'PEC - %' AND NOT LIKE 'WTC - %' (each exempt abbr).
            // The literal " - " after the abbreviation prevents a longer abbreviation
            // that merely starts with an exempt one from being excluded.
            var exemptFilter = new StringBuilder();
            foreach (var abbr in exemptAbbreviations ?? Array.Empty<string>())
                exemptFilter.Append(
                    $"<condition attribute='name' operator='not-like' value='{SecurityElement.Escape(abbr)} - %' />");

            var fetch = $@"
                <fetch top='1' distinct='true'>
                    <entity name='team'>
                        <attribute name='name' />
                        <filter type='and'>
                            <filter type='or'>
                                {suffixFilter}
                            </filter>
                            {exemptFilter}
                        </filter>
                        <link-entity name='teammembership' from='teamid' to='teamid' intersect='true'>
                            <filter>
                                <condition attribute='systemuserid' operator='eq' value='{userId}' />
                            </filter>
                        </link-entity>
                    </entity>
                </fetch>";

            var matches = service.RetrieveMultiple(new FetchExpression(fetch));
            if (matches.Entities.Count > 0)
            {
                tracing?.Trace(
                    $"StateMembershipHelper: user {userId} is a restricted state user via team " +
                    $"'{matches.Entities[0].GetAttributeValue<string>("name")}'.");
                return true;
            }

            tracing?.Trace(
                $"StateMembershipHelper: user {userId} holds no non-exempt state owner team.");
            return false;
        }


        /// <summary>
        /// Returns true when <paramref name="userId"/>'s business unit is the
        /// owning business unit of the given state, or any descendant of it
        /// (the state BU appears somewhere in the user BU's parent chain).
        /// Returns false when either lookup fails to resolve — the caller should
        /// treat that as "not scoped" and block the action.
        /// </summary>
        public static bool IsUserInStateBU(
            IOrganizationService service,
            ITracingService tracing,
            Guid userId,
            EntityReference stateRef)
        {
            if (userId == Guid.Empty || stateRef == null) return false;

            var userBu = GetUserBusinessUnitId(service, tracing, userId);
            if (userBu == Guid.Empty) return false;

            var stateBu = GetStateBusinessUnitId(service, tracing, stateRef.Id);
            if (stateBu == Guid.Empty) return false;

            var match = IsBusinessUnitInSubtree(service, tracing, userBu, stateBu);
            tracing?.Trace(
                $"StateMembershipHelper: user {userId} BU {userBu} vs state {stateRef.Id} BU {stateBu} → " +
                (match ? "in-scope (self or descendant)" : "out-of-scope"));
            return match;
        }

        /// <summary>
        /// Walks <paramref name="startBu"/>'s parent chain upward, returning true
        /// if <paramref name="ancestorBu"/> is the start BU itself or any of its
        /// ancestors. Guards against cycles via a visited set and a depth cap.
        /// </summary>
        private static bool IsBusinessUnitInSubtree(
            IOrganizationService service,
            ITracingService tracing,
            Guid startBu,
            Guid ancestorBu)
        {
            var current = startBu;
            var visited = new HashSet<Guid>();
            for (int depth = 0; depth < MaxBusinessUnitDepth; depth++)
            {
                if (current == Guid.Empty) return false;
                if (current == ancestorBu) return true;
                if (!visited.Add(current))
                {
                    tracing?.Trace(
                        $"StateMembershipHelper: cycle detected walking BU parents at {current}; stopping.");
                    return false;
                }
                current = GetParentBusinessUnitId(service, tracing, current);
            }
            tracing?.Trace(
                $"StateMembershipHelper: exceeded max BU depth ({MaxBusinessUnitDepth}) walking from {startBu}; stopping.");
            return false;
        }

        private static Guid GetParentBusinessUnitId(
            IOrganizationService service, ITracingService tracing, Guid businessUnitId)
        {
            try
            {
                var bu = service.Retrieve(
                    "businessunit", businessUnitId,
                    new ColumnSet("parentbusinessunitid"));
                return bu.GetAttributeValue<EntityReference>("parentbusinessunitid")?.Id ?? Guid.Empty;
            }
            catch (Exception ex)
            {
                tracing?.Trace($"StateMembershipHelper: could not resolve BU {businessUnitId}: {ex.Message}");
                return Guid.Empty;
            }
        }

        private static Guid GetUserBusinessUnitId(
            IOrganizationService service, ITracingService tracing, Guid userId)
        {
            try
            {
                var user = service.Retrieve(
                    "systemuser", userId,
                    new ColumnSet("businessunitid"));
                return user.GetAttributeValue<EntityReference>("businessunitid")?.Id ?? Guid.Empty;
            }
            catch (Exception ex)
            {
                tracing?.Trace($"StateMembershipHelper: could not resolve user {userId}: {ex.Message}");
                return Guid.Empty;
            }
        }

        private static Guid GetStateBusinessUnitId(
            IOrganizationService service, ITracingService tracing, Guid stateId)
        {
            try
            {
                var state = service.Retrieve(
                    EntityNames.State, stateId,
                    new ColumnSet(CommonAttributes.OwningBusinessUnit));
                return state.GetAttributeValue<EntityReference>(CommonAttributes.OwningBusinessUnit)?.Id ?? Guid.Empty;
            }
            catch (Exception ex)
            {
                tracing?.Trace($"StateMembershipHelper: could not resolve state {stateId}: {ex.Message}");
                return Guid.Empty;
            }
        }
    }
}
