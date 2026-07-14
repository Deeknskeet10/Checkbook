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
        // Only roles actually referenced by role-gating plugins live here;
        // the full role list is src/ARNGCheckbook/Roles/. Add a constant when
        // a plugin starts gating on a new role, not before.
        public const string BudgetExecutor         = "Book - Budget Executor";
        public const string CheckbookAdministrator = "Book - Checkbook Administrator";
        public const string StateAdministrator     = "Book - State Administrator";
        public const string StateApprover          = "Book - State Approver";
    }
}
