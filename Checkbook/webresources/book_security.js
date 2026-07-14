"use strict";
var Book = Book || {};
// Book.Security — shared role-check library for ARNG Checkbook form scripts.
//
// Replaces the copy-pasted getUserTeams/getTeamRoles helpers duplicated in
// book_checkbookButtons, book_hidePriRealignments, book_hidePriTurnIns and
// book_realignmentFormProgression. Differences from those copies:
//   - Unions DIRECT roles (systemuserroles_association) with TEAM-derived
//     roles (teamroles_association via the user's teams). The old helpers
//     checked team roles only and missed directly-assigned roles.
//   - Matches role names by case-insensitive EQUALITY — no fragile substring
//     checks like includes("Administrator").
//   - Caches the role lookup for the page session; the old copies re-queried
//     on every button click.
//
// Usage (add book_security as a form/command library, then):
//   Book.Security.userHasAnyRole([Book.Security.ROLES.STATE_APPROVER])
//       .then(function (has) { ... });
Book.Security = (function () {

    // Canonical role names (must match the security role names exactly).
    var ROLES = {
        CHECKBOOK_ADMINISTRATOR: "Book - Checkbook Administrator",
        STATE_ADMINISTRATOR:     "Book - State Administrator",
        STATE_APPROVER:          "Book - State Approver",
        BUDGET_EXECUTOR:         "Book - Budget Executor",
        // Additional roles referenced by existing scripts, for rewiring:
        STATE_PM:                "Book - State PM",
        FC_REVIEWER:             "Book - FC Reviewer",
        NPM:                     "Book - NPM"
    };

    // Role membership doesn't change mid-session; cache the promise.
    var roleNamesPromise = null;

    function currentUserId() {
        return Xrm.Utility.getGlobalContext()
            .userSettings.userId.replace(/[{}]/g, "");
    }

    function getDirectRoleNames(userId) {
        return Xrm.WebApi.retrieveMultipleRecords(
            "role",
            "?$select=name&$filter=systemuserroles_association/any(u:u/systemuserid eq " + userId + ")"
        ).then(function (result) {
            return result.entities.map(function (r) { return r.name; });
        });
    }

    function getTeamRoleNames(userId) {
        return Xrm.WebApi.retrieveMultipleRecords(
            "team",
            "?$select=teamid" +
            "&$expand=teamroles_association($select=name)" +
            "&$filter=teammembership_association/any(u:u/systemuserid eq " + userId + ")"
        ).then(function (result) {
            var names = [];
            result.entities.forEach(function (team) {
                (team.teamroles_association || []).forEach(function (role) {
                    if (role.name) names.push(role.name);
                });
            });
            return names;
        });
    }

    /**
     * All security role names the current user holds — direct and
     * team-derived, deduplicated. → Promise<string[]>
     */
    function getUserRoleNames() {
        if (!roleNamesPromise) {
            var userId = currentUserId();
            roleNamesPromise = Promise.all([
                getDirectRoleNames(userId),
                getTeamRoleNames(userId)
            ]).then(function (results) {
                var seen = {};
                var union = [];
                results[0].concat(results[1]).forEach(function (name) {
                    var key = name.toLowerCase();
                    if (!seen[key]) {
                        seen[key] = true;
                        union.push(name);
                    }
                });
                return union;
            }).catch(function (error) {
                roleNamesPromise = null; // don't cache failures
                throw error;
            });
        }
        return roleNamesPromise;
    }

    /**
     * True when the user holds ANY of the given roles (direct or via team).
     * Exact name match, case-insensitive. → Promise<boolean>
     */
    function userHasAnyRole(roleNames) {
        var wanted = (roleNames || []).map(function (n) {
            return String(n).toLowerCase();
        });
        return getUserRoleNames().then(function (names) {
            return names.some(function (name) {
                return wanted.indexOf(name.toLowerCase()) !== -1;
            });
        });
    }

    return {
        ROLES: ROLES,
        getUserRoleNames: getUserRoleNames,
        userHasAnyRole: userHasAnyRole
    };
})();
