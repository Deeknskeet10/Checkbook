using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Resolves the "does this user belong to that state?" question by comparing
    /// the user's business unit to the state's owning business unit. Assumes the
    /// convention that each book_state record is owned by its own state BU
    /// (per the "State is a book_state and are also BUs" model note).
    ///
    /// Used by role-gating plugins that need to prevent a State Approver in
    /// State X from approving a swap on behalf of State Y — the name-level
    /// role check alone is not sufficient there.
    ///
    /// Some states have restructured their BU tree so that no user sits at the
    /// state BU itself — they are segregated into child Fund Center BUs (e.g.
    /// A18TX under the TEXAS state BU). A user whose BU is the state BU OR any
    /// descendant of it is therefore treated as in-scope: the user's BU parent
    /// chain is walked upward looking for the state BU.
    /// </summary>
    public static class StateScopeHelper
    {
        // Backstop against a malformed/cyclic BU tree so the parent walk cannot
        // loop forever. Real BU trees are only a handful of levels deep.
        private const int MaxBusinessUnitDepth = 50;

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
                $"StateScopeHelper: user {userId} BU {userBu} vs state {stateRef.Id} BU {stateBu} → " +
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
                        $"StateScopeHelper: cycle detected walking BU parents at {current}; stopping.");
                    return false;
                }
                current = GetParentBusinessUnitId(service, tracing, current);
            }
            tracing?.Trace(
                $"StateScopeHelper: exceeded max BU depth ({MaxBusinessUnitDepth}) walking from {startBu}; stopping.");
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
                tracing?.Trace($"StateScopeHelper: could not resolve BU {businessUnitId}: {ex.Message}");
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
                tracing?.Trace($"StateScopeHelper: could not resolve user {userId}: {ex.Message}");
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
                    new ColumnSet("owningbusinessunit"));
                return state.GetAttributeValue<EntityReference>("owningbusinessunit")?.Id ?? Guid.Empty;
            }
            catch (Exception ex)
            {
                tracing?.Trace($"StateScopeHelper: could not resolve state {stateId}: {ex.Message}");
                return Guid.Empty;
            }
        }
    }
}
