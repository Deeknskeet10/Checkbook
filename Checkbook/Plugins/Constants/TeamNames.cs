namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Per-state owner-team naming convention: <c>"{ABBR} - {suffix}"</c>,
    /// e.g. <c>"TX - State Approver"</c>. Suffixes match <see cref="RoleNames"/>
    /// without the "Book - " prefix. Used for state-only rules
    /// (<see cref="Helpers.StateMembershipHelper"/>) and State Swap sharing.
    /// </summary>
    public static class TeamNames
    {
        public const string StateApproverSuffix = "State Approver";
        public const string StateAdministratorSuffix = "State Administrator";

        /// <summary>Both state owner-team suffixes.</summary>
        public static readonly System.Collections.Generic.IReadOnlyList<string> StateTeamSuffixes =
            new[] { StateApproverSuffix, StateAdministratorSuffix };

        public static string StateTeam(string stateAbbreviation, string suffix)
            => $"{stateAbbreviation} - {suffix}";
    }
}
