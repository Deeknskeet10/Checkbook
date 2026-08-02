namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_spendplan entity.
    /// FY27+ rows anchor on book_prioritizationfunding (book_prioritization
    /// stays empty — the book_uniquestatespendplan alternate key allows only
    /// one legacy row per Prio) and use the decimal month twins; legacy rows
    /// keep the float months and the Prioritization / Requirement / UFR
    /// lookups.
    /// </summary>
    public static class SpendPlanAttributes
    {
        public const string Id = "book_spendplanid";
        public const string Name = "book_name";

        // Legacy (FY26) anchors
        public const string Prioritization = "book_prioritization";
        public const string Requirement = "book_requirement";
        public const string RequirementFunding = "book_requirementfunding";
        public const string UnfundedRequest = "book_unfundedrequest";

        // FY27+ shape
        public const string PrioritizationFunding = "book_prioritizationfunding";
        public const string FundCenter = "book_fundcenter"; // null on rollup rows
        public const string RowType = "book_rowtype";       // 0 Planned, 1 Actual

        /// <summary>Decimal month twins in federal FY order (Oct → Sep).</summary>
        public static readonly string[] DecimalMonths =
        {
            "book_newoctober",
            "book_newnovember",
            "book_newdecember",
            "book_newjanuary",
            "book_newfebruary",
            "book_newmarch",
            "book_newapril",
            "book_newmay",
            "book_newjune",
            "book_newjuly",
            "book_newaugust",
            "book_newseptember",
        };

        public const string StateCode = "statecode";
    }

    /// <summary>book_spendplan.book_rowtype option values.</summary>
    public static class SpendPlanRowTypeValues
    {
        public const int Planned = 0;
        public const int Actual = 1;
    }
}
