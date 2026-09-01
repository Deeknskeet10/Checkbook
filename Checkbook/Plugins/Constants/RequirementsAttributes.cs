namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_requirements entity.
    /// </summary>
    public static class RequirementsAttributes
    {
        public const string Id = "book_requirementsid";
        public const string Name = "book_name";
        public const string ApprovalStatus = "book_approvalstatus";
        public const string Type = "book_type";
        public const string National = "book_national";

        /// <summary>
        /// Boolean — "child Prioritizations get individual (breakout) spend
        /// plans." Only meaningful for Distributed (non-<see cref="National"/>)
        /// requirements; default false ⇒ the Prios' funded amounts roll up by
        /// (State, Fund, SAG). Centrally managed requirements may not be
        /// breakout (enforced by RequirementBreakoutConsistencyGuard).
        /// </summary>
        public const string Breakout = "book_breakout";

        public const string FundCenter = "book_fundcenter";
        public const string StateCode = "statecode";
    }
}
