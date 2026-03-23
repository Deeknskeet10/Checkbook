namespace ARNGCheckbook.Plugins.Constants
{
    /// <summary>
    /// Schema name constants for Dataverse entities.
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
        public const string SpendPlan = "book_spendplan";
        public const string UnfundedRequests = "book_unfundedrequests";

        // Budget Execution
        public const string ObligationAuthority = "book_obligationauthority";
        public const string ObligationPeriods = "book_obligationperiods";
        public const string Realignments = "book_realignments";
        public const string Turnin = "book_turnin";
        public const string TurnInItems = "book_turninitems";
        public const string DecisionEvent = "book_decisionevent";

        // Reference Data
        public const string State = "book_state";
        public const string APE = "book_ape";
        public const string MDEP = "book_mdep";
        public const string LIN = "book_lin";
        public const string LINRequests = "book_linrequests";
        public const string BOC = "book_boc";
        public const string PG = "book_pg";
        public const string SAG = "book_sag";
        public const string TDC = "book_tdc";
        public const string DollarType = "book_dollartype";
        public const string LOEFocusArea = "book_loefocusarea";
        public const string PayTable = "book_paytable";
        public const string Decision = "book_decision";

        // Approval Entities
        public const string UFR = "book_arngcheckbookufr";
        public const string UFRValidation = "book_arngcheckbookufrvalidation";
        public const string DOMOPsApproval = "book_arngcheckbookdomopsapproval";
        public const string OPRApprovalWorkflow = "book_arngcheckbookoprapprovalworkflow";
        public const string RealignmentsReview = "book_realignmentsreview";
        public const string TurnInApprovalProcess = "book_turninapprovalprocess";
    }

    /// <summary>
    /// Attribute schema names for book_requirementfunding entity.
    /// </summary>
    public static class RequirementFundingAttributes
    {
        public const string Id = "book_requirementfundingid";
        public const string Name = "book_name";
        public const string TDP = "book_tdp";
        public const string FundedAmount = "book_fundedamount";
        public const string ValidatedAmount = "book_validatedamount";
        public const string LineOfAccounting = "book_lineofaccounting";
        public const string Requirement = "book_requirement";
        public const string FundCenter = "book_fundcenter";
        public const string FundingValidated = "book_fundingvalidated";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_fundingline (LOA) entity.
    /// </summary>
    public static class FundingLineAttributes
    {
        public const string Id = "book_fundinglineid";
        public const string TDP = "book_tdp";
        public const string TDPRemaining = "book_tdpremaining";
        public const string Name = "book_name";
        public const string Fund = "book_fund";
        public const string FundCenter = "book_fundcenter";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_fundingtrack entity.
    /// </summary>
    public static class FundingTrackAttributes
    {
        public const string Id = "book_fundingtrackid";
        public const string Name = "book_name";
        public const string ResourceAmount = "book_resourceamount";
        public const string LineOfAccounting = "book_lineofaccountingloa";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_prioritization entity.
    /// </summary>
    public static class PrioritizationAttributes
    {
        public const string Id = "book_prioritizationid";
        public const string Name = "book_name";
        public const string StatePriority = "book_statepriority";
        public const string ApprovalStatus = "book_approvalstatus";
        public const string FundedAmountTDP = "book_fundedamounttdp";
        public const string RequestedAmount = "book_requestedamount";
        public const string UnfundedAmount = "book_newunfundedamount";
        public const string ValidatedAmount = "book_newvalidatedamount";
        public const string RequirementFunding = "book_requirementfunding";
        public const string Requirement = "book_requirement";
        public const string State = "book_state";
        public const string FundCenter = "book_fundcenter";
        public const string FiscalYear = "book_newfiscalyear";
        public const string LineOfAccounting = "book_lineofaccounting";
        public const string MDEP = "book_mdep";
        public const string LIN = "book_lin";
        public const string RequirementType = "book_requirementtype";
        public const string SpendPlanGenerated = "book_spendplangenerated";
        public const string UFRGenerated = "book_ufrgenerated";
        public const string PriorityAutoNumber = "book_priorityautonumber";
        public const string Quantities = "book_quantities";
        public const string ReferenceNumber = "book_referencenumber";
        public const string StatutoryJustification = "book_statutoryjustification";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_spendplan entity.
    /// </summary>
    public static class SpendPlanAttributes
    {
        public const string Id = "book_spendplanid";
        public const string Name = "book_name";
        public const string Total = "book_total";
        public const string SpendPlanTotal = "book_spendplantotal";
        public const string AvailableAmount = "book_availableamount";
        public const string LineOfAccounting = "book_lineofaccountingloa";
        public const string Prioritization = "book_prioritization";
        public const string RequirementFunding = "book_requirementfunding";
        public const string Requirement = "book_requirement";
        public const string UnfundedRequest = "book_unfundedrequest";
        public const string UnfundedRequestParent = "book_unfundedrequestparent";
        public const string SpendPlanType = "book_spendplantype";
        public const string SpendPlanComments = "book_spendplancomments";
        public const string Withholding = "book_withholding";

        // Monthly amounts
        public const string January = "book_january";
        public const string February = "book_february";
        public const string March = "book_march";
        public const string April = "book_april";
        public const string May = "book_may";
        public const string June = "book_june";
        public const string July = "book_july";
        public const string August = "book_august";
        public const string September = "book_september";
        public const string October = "book_october";
        public const string November = "book_november";
        public const string December = "book_december";

        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_distributions entity.
    /// </summary>
    public static class DistributionsAttributes
    {
        public const string Id = "book_distributionsid";
        public const string Name = "book_name";
        public const string Amount = "book_amount";
        public const string Fund = "book_fund";
        public const string FundCenter = "book_fundcenter";
        public const string FundingEvent = "book_fundingevent";
        public const string PGSAG = "book_newpgsag";
        public const string DisbursementDirection = "book_disbursementdirection";
        public const string DebitedDistribution = "book_debiteddistribution";
        public const string EntryDocumentNumber = "book_entrydocumentnumber";
        public const string ManualEntry = "book_manualentry";
        public const string Remarks = "book_remarks";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_realignments entity.
    /// </summary>
    public static class RealignmentsAttributes
    {
        public const string Id = "book_realignmentsid";
        public const string Name = "book_name";
        public const string Amount = "book_amount";
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
        public const string StateApproved = "book_stateapproved";
        public const string BEDecision = "book_bedecision";
        public const string ConfirmCreditedLOA = "book_confirmcreditedloa";
        public const string ConfirmDebitedAccount = "book_confirmdebitedaccount";
        public const string Remarks = "book_remarks";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_turnin entity.
    /// </summary>
    public static class TurninAttributes
    {
        public const string Id = "book_turninid";
        public const string Name = "book_name";
        public const string Amount = "book_amount";
        public const string FiscalYear = "book_fiscalyear";
        public const string Fund = "book_fund";
        public const string FundCenter = "book_fundcenter";
        public const string PG = "book_pg";
        public const string IdentifiedTurnInAmount = "book_identifiedturninamount";
        public const string StateApproved = "book_stateapproved";
        public const string BEApproved = "book_beapproved";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_fund entity.
    /// </summary>
    public static class FundAttributes
    {
        public const string Id = "book_fundid";
        public const string Name = "book_name";
        public const string FundKey = "book_fundkey";
        public const string FundingCode = "book_fundingcode";
        public const string FiscalYear = "book_fiscalyear";
        public const string Appropriation = "book_appropriation";
        public const string BOC = "book_boc";
        public const string DollarType = "book_dollartypefundedprogram";
        public const string FundedProgram = "book_fundedprogram";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_loefocusarea entity.
    /// </summary>
    public static class LOEFocusAreaAttributes
    {
        public const string Id = "book_loefocusareaid";
        public const string Name = "book_name";
        public const string LOE = "book_loe";
        public const string FocusArea = "book_focusarea";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_linrequests entity.
    /// </summary>
    public static class LINRequestsAttributes
    {
        public const string Id = "book_linrequestsid";
        public const string Name = "book_name";
        public const string LIN = "book_lin";
        public const string Prioritization = "book_prioritization";
        public const string Quantity = "book_quantity";
        public const string RequestedAmount = "book_requestedamount";
        public const string FundedAmount = "book_fundedamount";
        public const string ValidatedAmount = "book_validatedamount";
        public const string PSDID = "book_psdid";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_decisionevent entity.
    /// </summary>
    public static class DecisionEventAttributes
    {
        public const string Id = "book_decisioneventid";
        public const string Name = "book_name";
        public const string Amount = "book_amount";
        public const string DecisionBalance = "book_decisionbalance";
        public const string Description = "book_description";
        public const string FiscalYear = "book_fiscalyear";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// Attribute schema names for book_ledger entity.
    /// </summary>
    public static class LedgerAttributes
    {
        public const string Id = "book_ledgerid";
        public const string Name = "book_name";
        public const string Amount = "book_amount";
        public const string LineOfAccounting = "book_lineofaccounting";
        public const string LedgerType = "book_ledgertype";
        public const string TransactionDate = "book_transactiondate";
        public const string Realignment = "book_realignment";
        public const string TurnIn = "book_turnin";
        public const string StateCode = "statecode";
    }

    /// <summary>
    /// State code values for record status.
    /// </summary>
    public static class StateCodeValues
    {
        public const int Active = 0;
        public const int Inactive = 1;
    }

    /// <summary>
    /// Approval status values for book_prioritization.
    /// </summary>
    public static class ApprovalStatusValues
    {
        public const int StateInput = 0;
        public const int FCReview = 1;
        public const int StateReview = 2;
        public const int StateApproved = 3;
        public const int NPMReview = 4;
    }

    /// <summary>
    /// Ledger type values for book_ledger.
    /// </summary>
    public static class LedgerTypeValues
    {
        public const int Distribution = 100000000;
        public const int Realignment = 100000001;
        public const int TurnIn = 100000002;
    }

    /// <summary>
    /// Disbursement direction values for book_distributions.
    /// </summary>
    public static class DisbursementDirectionValues
    {
        public const int Credit = 100000000;
        public const int Debit = 100000001;
    }
}
