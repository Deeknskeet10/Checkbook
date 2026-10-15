namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_realignmentrdfreduction (FY27 OPR path).
    /// Child of book_realignments: one row = one Requirement Detail Funding junction on
    /// the debit RF that the user reduces. An OPR (RF→RF) realignment consumes the debit
    /// RF's Withholding first; whatever Withholding cannot cover comes out of the RF's
    /// Funded, which on a direct-funded RF is Σ RDF — so those junctions must drop by the
    /// same total or RF.Funded and Σ RDF drift apart. Validated by
    /// RealignmentValidator.EnforceRdfDebitBalance, applied by RealignmentProcessor
    /// (authorized reducer for the RDF FundedAmountLock).
    /// See docs/Realignment-FY27-Redesign.md §9.9.
    /// </summary>
    public static class RealignmentRdfReductionAttributes
    {
        public const string EntityLogicalName = "book_realignmentrdfreduction";

        public const string Id = "book_realignmentrdfreductionid";
        public const string Name = "book_name";
        public const string Realignment = "book_realignment";
        public const string RequirementDetailFunding = "book_requirementdetailfunding";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_realignmentrdfincrease (FY27 OPR path).
    /// Child of book_realignments: one row = one Requirement Detail on the credit RF's
    /// Requirement that the user funds from the incoming amount (RD ↔ credit RF junction,
    /// get-or-create). Optional — whatever is not pushed into details stays on the credit
    /// RF as Withholding. Σ increases per credit RF must not exceed the amount landing on it.
    /// See docs/Realignment-FY27-Redesign.md §9.9.
    /// </summary>
    public static class RealignmentRdfIncreaseAttributes
    {
        public const string EntityLogicalName = "book_realignmentrdfincrease";

        public const string Id = "book_realignmentrdfincreaseid";
        public const string Name = "book_name";
        public const string Realignment = "book_realignment";
        public const string RequirementDetail = "book_requirementdetail";
        public const string RequirementFunding = "book_requirementfunding";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }
}
