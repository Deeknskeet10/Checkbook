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
        /// <summary>Fund's funded-program display name (FY27+ only).</summary>
        public string FundedProgramName;
        /// <summary>Label of the FT's <c>book_category</c> choice (FY27+ only).</summary>
        public string CategoryName;
        /// <summary>Fund's <c>book_appropriation</c> option-set value.</summary>
        public int Appropriation;
    }

    /// <summary>
    /// Builds the deterministic LOA (<c>book_fundingline.book_name</c>) string used as the
    /// alternate-key uniqueness handle.
    ///
    /// Format:
    ///   FY26 and earlier: <c>{OPR}-{Fund}-{BOC}-{DT}-{PG or SAG}-{MDEP}</c>
    ///   FY27 and later:   <c>{OPR}-{Fund}-{PG or SAG}-{FundedProgram}-{Category}</c>
    ///
    /// • The PG-or-SAG slot is <b>PG</b> for procurement/RDT&amp;E appropriations
    ///   (NGPA / NGPM / NGREA) and <b>SAG</b> for everything else — mirrors the
    ///   "APPN requires PG" branch in the legacy <c>LineofAccounting-Initialization</c>
    ///   XAML workflow. The rule applies in both eras.
    /// • FY27+ drops BOC / DollarType / MDEP entirely: BOC and DT are replaced by
    ///   the Fund's Funded Program plus the FT's Category choice (GFEBS-aligned
    ///   fund model), and LOAs intentionally collapse across MDEPs.
    ///
    /// Fiscal year is parsed from the <b>last two digits</b> of the Fund name
    /// (e.g. <c>...26 → 26</c>). Any character may precede those digits — the
    /// trailing-letter slot (D / F / X / etc.) carries other meaning and is
    /// not interpreted here.
    /// </summary>
    public static class LOANameBuilder
    {
        /// <summary>
        /// Highest FY (2-digit) using the legacy grain (BOC / DollarType / MDEP,
        /// composite alternate key). FY27+ uses Fund+FundedProgram+Category and
        /// identifies solely by canonical name.
        /// </summary>
        public const int LegacyGrainLastFy = 26;

        private static readonly Regex FyTrailer = new Regex(@"(\d{2})$", RegexOptions.Compiled);

        /// <summary>
        /// Builds the canonical name. Throws <see cref="ArgumentException"/> on
        /// missing required parts; the caller is expected to trace + skip.
        /// </summary>
        public static string Build(LOANameParts parts)
        {
            if (parts == null) throw new ArgumentNullException(nameof(parts));

            RequireNonEmpty(parts.OPRName,  "OPR");
            RequireNonEmpty(parts.FundName, "Fund");

            var fy = ParseFiscalYear(parts.FundName);
            var usesPg = AppropriationValues.RequiresPg(parts.Appropriation);

            string pgOrSag;
            if (usesPg)
            {
                RequireNonEmpty(parts.PGName, "PG (required for APPN " + parts.Appropriation + ")");
                pgOrSag = parts.PGName;
            }
            else
            {
                RequireNonEmpty(parts.SAGName, "SAG (required for APPN " + parts.Appropriation + ")");
                pgOrSag = parts.SAGName;
            }

            if (fy <= LegacyGrainLastFy)
            {
                RequireNonEmpty(parts.BOCName,        "BOC (required for FY" + fy + ")");
                RequireNonEmpty(parts.DollarTypeName, "DollarType (required for FY" + fy + ")");
                RequireNonEmpty(parts.MDEPName,       "MDEP (required for FY" + fy + ")");

                return string.Join("-",
                    parts.OPRName,
                    parts.FundName,
                    parts.BOCName,
                    parts.DollarTypeName,
                    pgOrSag,
                    parts.MDEPName);
            }

            RequireNonEmpty(parts.FundedProgramName, "FundedProgram (required for FY" + fy + ")");
            RequireNonEmpty(parts.CategoryName,      "Category (required for FY" + fy + ")");

            return string.Join("-",
                parts.OPRName,
                parts.FundName,
                pgOrSag,
                parts.FundedProgramName,
                parts.CategoryName);
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
                    $"Fund name '{fundName}' does not end in a 2-digit fiscal year.");
            return int.Parse(match.Groups[1].Value);
        }

        private static void RequireNonEmpty(string value, string label)
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new ArgumentException($"{label} name is required to build the LOA name.");
        }
    }
}
