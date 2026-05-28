namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_realignments entity.
    /// </summary>
    public static class RealignmentsAttributes
    {
        public const string Id = "book_realignmentsid";
        public const string Name = "book_name";
        public const string Amount = "book_newamount";
        public const string FiscalYear = "book_fiscalyear";
        public const string RealignmentStatus = "book_realignmentstatus";
        public const string RealignmentType = "book_realignmenttype";
        public const string CreditedLOA = "book_newcreditedloa";
        public const string DebitedLOA = "book_newdebitedloa";
        public const string CreditedRequirement = "book_newcreditedrequirement";
        public const string DebitedRequirement = "book_newdebitedrequirement";
        public const string CreditedPrioritization = "book_creditedprioritization";
        public const string DebitedPrioritization = "book_debitedprioritization";
        public const string CreditedMDEP = "book_creditedmdep";
        public const string DebitedMDEP = "book_debitedmdep";
        public const string PayeeConcurrence = "book_payeeconcurrence";
        public const string PayerConcurrence = "book_payerconcurrence";
        public const string StateApproved = "book_newstateapproved";
        public const string BEDecision = "book_bedecision";
        public const string ConfirmCreditedLOA = "book_confirmcreditedloa";
        public const string ConfirmDebitedAccount = "book_confirmdebitedaccount";
        public const string SameFundandSAG = "book_samefundandsag";
        public const string Remarks = "book_remarks";
        public const string Fund = "book_fund";
        public const string StateCode = "statecode";
    }
}
