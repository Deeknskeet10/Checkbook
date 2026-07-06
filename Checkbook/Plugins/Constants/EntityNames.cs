namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Schema name constants for Dataverse entities referenced by this assembly.
    /// </summary>
    public static class EntityNames
    {
        // Core Financial Entities
        public const string RequirementFunding = "book_requirementfunding";
        public const string FundingLine = "book_fundingline";
        public const string FundingTrack = "book_fundingtrack";
        public const string Fund = "book_fund";
        public const string FundCenter = "book_fundcenter";
        public const string FundingEvent = "book_fundingevent";
        public const string FundingDetails = "book_fundingdetails";
        public const string Ledger = "book_ledger";
        public const string Distributions = "book_distributions";

        // Requirements & Prioritization
        public const string Requirements = "book_requirements";
        public const string Prioritization = "book_prioritization";
        public const string PrioritizationFunding = "book_prioritizationfunding";

        // Budget Execution
        public const string Realignments = "book_realignments";
        public const string Turnin = "book_turnin";
        public const string TurnInItems = "book_turninitems";
        public const string StateSwap = "book_stateswap";
        public const string SwapItem = "book_swapitem";

        // Reference Data
        public const string State = "book_state";
        public const string APE = "book_ape";
        public const string MDEP = "book_mdep";
        public const string BOC = "book_boc";
        public const string PG = "book_pg";
        public const string SAG = "book_sag";
        public const string DollarType = "book_dollartype";
        public const string OPR = "book_opr";
        public const string Decision = "book_decision";
        public const string ItemizedDetails = "book_itemizeddetails";
        public const string RequirementDetails = "book_requirementdetails";
        public const string RequirementDetailFunding = "book_requirementdetailfunding";

        // Approval Entities
        public const string UFR = "book_arngcheckbookufr";
    }
}
