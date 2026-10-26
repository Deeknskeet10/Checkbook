namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Platform column names present on every user/team-owned Dataverse table.
    /// Use these instead of bare string literals.
    /// </summary>
    public static class CommonAttributes
    {
        public const string StateCode = "statecode";
        public const string StatusCode = "statuscode";
        public const string OwnerId = "ownerid";
        public const string OwningBusinessUnit = "owningbusinessunit";
    }
}
