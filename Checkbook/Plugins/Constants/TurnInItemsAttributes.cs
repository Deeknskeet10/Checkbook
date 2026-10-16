namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_turninitems entity.
    /// Child line items on a Turn-In: which Prioritization (or RF) is being turned in,
    /// for how much. LOA is not stored on the item — it is derived from the linked
    /// Prioritization or Requirement Funding at load time.
    /// </summary>
    public static class TurnInItemsAttributes
    {
        public const string Id = "book_turninitemsid";
        public const string Name = "book_name";
        // Decimal column. Replaces the previously-referenced "book_amounttaken"
        // which does NOT exist in this env.
        public const string Amount = "book_newturninamount";
        public const string Turnin = "book_turnin";
        public const string Prioritization = "book_prioritization";
        public const string RequirementFunding = "book_requirementfunding";

        // ---- FY27 (docs/TurnIn-FY27-Redesign.md) ----
        // The Prioritization Funding junction (Prio ↔ RF = one Fund/SAG) the item turns
        // in from. Set on every Prio-backed FY27 item, alongside book_prioritization and
        // book_requirementfunding (which must match the junction's own lookups).
        public const string PrioritizationFunding = "book_prioritizationfunding";
        // FY27 Turn-Ins have no header Fund/PG — one Turn-In can span several Fund/SAGs —
        // so AFP / Allotment are sized per item (item amount × the item LOA's current
        // percentage) by TurnInItemAmountCalculator and rolled up to the header by
        // TurnInItemRollup. Sticky per-item override flags mirror the header's.
        public const string AFPAmount = "book_afpamount";
        public const string AllotmentAmount = "book_allotmentamount";
        public const string AFPOverridden = "book_afpoverridden";
        public const string AllotmentOverridden = "book_allotmentoverridden";

        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_turnindetailreduction (FY27).
    /// Child of book_turnin: one Itemized Detail on an Itemized debit Prioritization,
    /// reduced (Funded and Requested) by the amount. For each Itemized Prio, Σ reductions
    /// must equal Σ the Turn-In Item amounts on its PF junctions, so Σ details ≡ Σ PF ≡
    /// Prio total holds after approval. Validated by TurnInValidator, applied by
    /// TurnInFy27Processor.
    /// </summary>
    public static class TurnInDetailReductionAttributes
    {
        public const string EntityLogicalName = "book_turnindetailreduction";

        public const string Id = "book_turnindetailreductionid";
        public const string Name = "book_name";
        public const string TurnIn = "book_turnin";
        public const string ItemizedDetail = "book_itemizeddetail";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_turninrdfreduction (FY27).
    /// Child of book_turnin: one Requirement Detail Funding junction on an RF-level
    /// Turn-In Item's RF, reduced by the amount. The RF gives up Withholding first; on a
    /// direct-funded RF (Funded = Σ RDF) the remainder must come out of its RDF junctions:
    /// Σ reductions per RF == max(0, Σ item amount − Withholding). Same rule as an OPR
    /// realignment (RealignmentValidator.EnforceRdfDebitBalance).
    /// </summary>
    public static class TurnInRdfReductionAttributes
    {
        public const string EntityLogicalName = "book_turninrdfreduction";

        public const string Id = "book_turninrdfreductionid";
        public const string Name = "book_name";
        public const string TurnIn = "book_turnin";
        public const string RequirementDetailFunding = "book_requirementdetailfunding";
        public const string Amount = "book_newamount";

        public const string StateCode = "statecode";
    }
}
