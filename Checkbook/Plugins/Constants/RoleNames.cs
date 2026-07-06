namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Dataverse security role names used by role-gating plugins (see
    /// <see cref="Helpers.UserRoleHelper"/>). Names must match the role's
    /// display name exactly, since UserRoleHelper does a case-insensitive
    /// name lookup against the <c>role</c> entity.
    /// Source of truth: src/ARNGCheckbook/Roles/*.xml.
    /// </summary>
    public static class RoleNames
    {
        // APMO-scoped roles (APMO publisher; broader-than-state administrators).
        public const string APMOCheckbookAdministrator = "APMO - Checkbook Administrator";
        public const string APMOCheckbookUser          = "APMO - Checkbook User";

        // Book-scoped roles (ARNGCheckbook publisher; the Checkbook app's day-to-day).
        public const string BudgetExecutor       = "Book - Budget Executor";
        public const string CheckbookAdministrator = "Book - Checkbook Administrator";
        public const string CSOR                 = "Book - CSOR";
        public const string FCReviewer           = "Book - FC Reviewer";
        public const string LINManager           = "Book - LIN Manager";
        public const string NPM                  = "Book - NPM";
        public const string PEC                  = "Book - PEC";
        public const string ReadOnly             = "Book - Read Only";
        public const string ResourceIntegrator   = "Book - Resource Integrator";
        public const string StateAdministrator   = "Book - State Administrator";
        public const string StateApprover        = "Book - State Approver";
        public const string StatePM              = "Book - State PM";
    }
}
