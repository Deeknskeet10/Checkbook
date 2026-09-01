using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Resolves the "active planning fiscal year" — the boundary that makes past
    /// FYs immutable. FY values throughout the app are the calendar year the
    /// federal FY ends in (FY27 = Oct 2026 → Sep 2027).
    ///
    /// Source of truth: the <c>book_activeplanningfy</c> environment variable
    /// (an admin can open a future year early or hold a prior year open). When
    /// unset/blank/unparsable it falls back to the computed federal FY.
    /// </summary>
    public static class FiscalYearHelper
    {
        /// <summary>
        /// The open planning FY. Records with FY &lt; this value are frozen.
        /// Never throws — a missing env var falls back to the computed FY so a
        /// mis-configured environment fails safe (current year), not closed.
        /// </summary>
        public static int GetActivePlanningFiscalYear(IOrganizationService service, ITracingService tracing = null)
        {
            try
            {
                var raw = EnvironmentVariableHelper.GetValue(service, EnvironmentVariableKeys.ActivePlanningFiscalYear);
                if (!string.IsNullOrWhiteSpace(raw) &&
                    int.TryParse(raw.Trim(), out var fy) && fy >= 1990 && fy <= 2200)
                    return fy;
                tracing?.Trace($"book_activeplanningfy unset/invalid ('{raw}'); using computed federal FY.");
            }
            catch (Exception ex)
            {
                // Definition absent, etc. — fall back rather than block writes.
                tracing?.Trace($"book_activeplanningfy lookup failed ({ex.Message}); using computed federal FY.");
            }

            return ComputeFederalFiscalYear(DateTime.UtcNow);
        }

        /// <summary>
        /// Federal FY for a date: Oct–Dec belong to next year's FY, Jan–Sep to
        /// the current year's. (DateTime.Month is 1-based, so Oct = 10.)
        /// </summary>
        public static int ComputeFederalFiscalYear(DateTime date)
        {
            return date.Month >= 10 ? date.Year + 1 : date.Year;
        }
    }
}
