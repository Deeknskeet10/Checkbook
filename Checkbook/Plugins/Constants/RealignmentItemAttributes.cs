namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for the book_realignmentitem entity (FY27).
    /// Child of book_realignments: one row = one Fund/SAG move. The debit unit is
    /// exactly one of PrioritizationFunding (State path), RequirementDetailFunding
    /// (direct/OPR path), or RequirementFunding (plain RF→RF). The credit always
    /// lands on an existing RequirementFunding. Fund/PG/SAG/DebitState/SameFundandSAG
    /// are plugin-denormalized by RealignmentItemDerivedFields.
    /// See docs/Realignment-FY27-Redesign.md.
    /// </summary>
    public static class RealignmentItemAttributes
    {
        public const string EntityLogicalName = "book_realignmentitem";

        public const string Id = "book_realignmentitemid";
        public const string Name = "book_name";
        public const string Realignment = "book_realignment";
        public const string Amount = "book_newamount";
        public const string SameFundandSAG = "book_samefundandsag";

        // Debit unit — exactly one is set (XOR), identifying the source RF/Fund/SAG.
        public const string DebitPrioritizationFunding = "book_debitprioritizationfunding";
        public const string DebitRequirementDetailFunding = "book_debitrequirementdetailfunding";
        public const string DebitRequirementFunding = "book_debitrequirementfunding";

        // Credit side — the existing RF the funds land on (§9.1: user picks it).
        public const string CreditRequirementFunding = "book_creditrequirementfunding";

        // Denormalized from the debit side.
        public const string Fund = "book_fund";
        public const string PG = "book_pg";
        public const string SAG = "book_sag";
        public const string DebitState = "book_debitstate";

        public const string StateCode = "statecode";
    }

    /// <summary>
    /// book_realignments.book_realignmententrymode option values (local choice).
    /// Which branch the entry PCF used; drives which debit unit the items carry.
    /// </summary>
    public static class RealignmentEntryModeValues
    {
        public const int State = 0;
        public const int OPR = 1;
    }
}
