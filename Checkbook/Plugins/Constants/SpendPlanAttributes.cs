namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_spendplan entity.
    /// FY27+ rows anchor on book_prioritizationfunding and use the decimal
    /// month twins; book_prioritization is now also stamped on FY27 rows as an
    /// informational lookup (many rows per Prio — one per PF/FC/RowType — since
    /// the single-Prio book_uniquestatespendplan alternate key was retired).
    /// Legacy (FY26) rows keep the float months and the Prioritization /
    /// Requirement / UFR lookups as their anchor.
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

        /// <summary>
        /// Lookup to book_lineofaccountingloa. Informational stamp copied from
        /// the anchor (PF.book_lineofaccounting) on FY27 Breakout rows so State
        /// users can pull the LOA off the spend plan row without walking the PF.
        /// </summary>
        public const string LineOfAccountingLOA = "book_lineofaccountingloa";

        // FY27 Mode-C (State-Rollup) anchor — a (State, Fund, SAG) bucket that
        // aggregates across every distributed non-breakout PF in the state.
        // Coarser than one LOA, so it cannot hang off book_lineofaccountingloa.
        public const string State = "book_state";
        public const string Fund = "book_fund";
        public const string Sag = "book_sag";

        /// <summary>
        /// FY option value (calendar year, e.g. 2027). Stored explicitly on
        /// Mode-C rows — they have no PF/RF to infer it from.
        /// </summary>
        public const string FiscalYear = "book_newfiscalyear";

        /// <summary>
        /// Decimal — the anchor's funded amount. On Mode-C rows this is the
        /// rollup written by SpendPlanStateRollup (Σ of the bucket's PF funded
        /// amounts); the Planned cap validates against it.
        /// </summary>
        public const string FundedAmount = "book_fundedamount";

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
