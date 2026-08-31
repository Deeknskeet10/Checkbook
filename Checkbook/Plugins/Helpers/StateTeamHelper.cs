using System;
using System.Security;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Answers "does this user belong to a geographic-state owner team?" using the
    /// per-state owner-team naming convention <c>"{ABBR} - State Approver"</c> /
    /// <c>"{ABBR} - State Administrator"</c> (e.g. <c>"TX - State Approver"</c>).
    /// States are modeled as owner teams whose name carries the state abbreviation;
    /// a user picks up the <c>Book - State Approver</c>/<c>Administrator</c> role by
    /// membership in one such team. (Same convention the State Swap owner teams use —
    /// see PLUGIN-REGISTRATION.md, State Swaps section.)
    ///
    /// Certain abbreviations (PEC, WTC) are non-geographic entities that are exempt
    /// from state-only rules — callers pass the exempt set. Distinct from
    /// <see cref="StateScopeHelper"/>, which answers a different question (is the user
    /// in a *specific* state's business unit) via the BU tree rather than team names.
    /// </summary>
    public static class StateTeamHelper
    {
        // Team-name suffixes that mark a state owner team. Kept in sync with the
        // owner-team convention documented in PLUGIN-REGISTRATION.md (State Swaps).
        private static readonly string[] StateTeamSuffixes =
        {
            "State Approver",
            "State Administrator",
        };

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
            foreach (var suffix in StateTeamSuffixes)
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
                    $"StateTeamHelper: user {userId} is a restricted state user via team " +
                    $"'{matches.Entities[0].GetAttributeValue<string>("name")}'.");
                return true;
            }

            tracing?.Trace(
                $"StateTeamHelper: user {userId} holds no non-exempt state owner team.");
            return false;
        }
    }
}
