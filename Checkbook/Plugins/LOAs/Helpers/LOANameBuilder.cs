using System;
using System.Text.RegularExpressions;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.LOAs.Helpers
{
    /// <summary>
    /// Inputs for building a canonical LOA name. All names are the
    /// primary <c>book_name</c> string of each related lookup record.
    /// </summary>
    public class LOANameParts
    {
        public string OPRName;
        public string FundName;
        public string BOCName;
        public string DollarTypeName;
        public string PGName;
        public string SAGName;
        public string MDEPName;
        /// <summary>Fund's <c>book_appropriation</c> option-set value.</summary>
        public int Appropriation;
    }

    /// <summary>
    /// Builds the deterministic LOA (<c>book_fundingline.book_name</c>) string used as the
    /// alternate-key uniqueness handle.
    ///
    /// Format:
    ///   <c>{OPR}-{Fund}-{BOC}-{DT}-{PG or SAG}[-{MDEP}]</c>
    ///
    /// • The 5th slot is <b>PG</b> for procurement/RDT&amp;E appropriations
    ///   (NGPA / NGPM / NGREA) and <b>SAG</b> for everything else — mirrors the
    ///   "APPN requires PG" branch in the legacy <c>LineofAccounting-Initialization</c>
    ///   XAML workflow.
    /// • MDEP is appended only for fiscal years <see cref="MdepInNameLastFy"/> and earlier
    ///   (FY26 keeps the FY26 alternate-key composite intact; FY27+ drops it).
    ///
    /// Fiscal year is parsed from the <b>last two digits</b> of the Fund name,
    /// e.g. <c>206010D26 → 26</c> — the convention the user maintains for fund codes.
    /// </summary>
    public static class LOANameBuilder
    {
        /// <summary>Highest FY (2-digit) whose LOA names still carry MDEP.</summary>
        public const int MdepInNameLastFy = 26;

        private static readonly Regex FyTrailer = new Regex(@"(\d{2})$", RegexOptions.Compiled);

        /// <summary>
        /// Builds the canonical name. Throws <see cref="ArgumentException"/> on
        /// missing required parts; the caller is expected to trace + skip.
        /// </summary>
        public static string Build(LOANameParts parts)
        {
            if (parts == null) throw new ArgumentNullException(nameof(parts));

            RequireNonEmpty(parts.OPRName,        "OPR");
            RequireNonEmpty(parts.FundName,       "Fund");
            RequireNonEmpty(parts.BOCName,        "BOC");
            RequireNonEmpty(parts.DollarTypeName, "DollarType");

            var fy = ParseFiscalYear(parts.FundName);
            var usesPg = AppropriationValues.RequiresPg(parts.Appropriation);

            string fifth;
            if (usesPg)
            {
                RequireNonEmpty(parts.PGName, "PG (required for APPN " + parts.Appropriation + ")");
                fifth = parts.PGName;
            }
            else
            {
                RequireNonEmpty(parts.SAGName, "SAG (required for APPN " + parts.Appropriation + ")");
                fifth = parts.SAGName;
            }

            var includeMdep = fy <= MdepInNameLastFy;
            if (includeMdep)
                RequireNonEmpty(parts.MDEPName, "MDEP (required for FY" + fy + ")");

            var core = string.Join("-",
                parts.OPRName,
                parts.FundName,
                parts.BOCName,
                parts.DollarTypeName,
                fifth);

            return includeMdep ? core + "-" + parts.MDEPName : core;
        }

        /// <summary>
        /// Extracts the 2-digit fiscal year from a fund name's trailing digits.
        /// Throws if the convention isn't matched so the caller can skip the row.
        /// </summary>
        public static int ParseFiscalYear(string fundName)
        {
            var match = FyTrailer.Match(fundName ?? string.Empty);
            if (!match.Success)
                throw new ArgumentException(
                    $"Fund name '{fundName}' does not end in a 2-digit fiscal year " +
                    "(expected format like '206010D26').");
            return int.Parse(match.Groups[1].Value);
        }

        private static void RequireNonEmpty(string value, string label)
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new ArgumentException($"{label} name is required to build the LOA name.");
        }
    }
}
