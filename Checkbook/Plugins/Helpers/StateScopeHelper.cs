using System;
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
    /// </summary>
    public static class StateScopeHelper
    {
        /// <summary>
        /// Returns true when <paramref name="userId"/>'s business unit matches
        /// the owning business unit of the given state. Returns false when
        /// either lookup fails to resolve — the caller should treat that as
        /// "not scoped" and block the action.
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

            var match = userBu == stateBu;
            tracing?.Trace(
                $"StateScopeHelper: user {userId} BU {userBu} vs state {stateRef.Id} BU {stateBu} → " +
                (match ? "match" : "mismatch"));
            return match;
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
