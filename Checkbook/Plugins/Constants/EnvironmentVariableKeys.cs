namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Schema names of Dataverse environment variables read by plugin code
    /// (via <see cref="Helpers.EnvironmentVariableHelper"/>).
    /// </summary>
    public static class EnvironmentVariableKeys
    {
        /// <summary>
        /// Integer (calendar year, e.g. 2027) — the open planning fiscal year.
        /// Anything strictly below it is historical and immutable: flag-flip
        /// cascades never re-stamp it and the spend-plan immutability guard
        /// rejects direct edits. When unset, plugins fall back to the computed
        /// federal FY (Oct-start; see FiscalYearHelper).
        /// </summary>
        public const string ActivePlanningFiscalYear = "book_activeplanningfy";
    }
}
