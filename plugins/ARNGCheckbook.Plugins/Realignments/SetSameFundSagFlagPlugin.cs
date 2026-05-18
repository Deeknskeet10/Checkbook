using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace ARNGCheckbook.Plugins.Realignments
{
    /// <summary>
    /// Sets book_samefundandsag based on the Fund/SAG of the debited vs credited LOA.
    /// This is used to show/hide the correct BPF on the Realignment Form.
    ///
    /// Registration:
    /// - Entity: book_realignments
    /// - Messages: Create, Update
    /// - Stage: Pre-Operation (20)
    /// - Execution Mode: Synchronous
    /// - Pre-Image: Required on Update (all LOA/Requirement/Prioritization lookup fields)
    /// </summary>
    public class SetSameFundSagFlagPlugin : PluginBase
    {
        // ======== relevant columns =========
        private const string ENTITY_REALIGNMENT = "book_realignments";
        private const string ATTR_FLAG          = "book_samefundandsag"; // Two Options / Boolean

        private const string ATTR_DEBIT_PRIOR   = "book_debitedprioritization";  // -> book_prioritization
        private const string ATTR_CREDIT_PRIOR  = "book_creditedprioritization";

        private const string ATTR_DEBIT_REQ     = "book_newdebitedrequirement";  // -> book_requirementfunding
        private const string ATTR_CREDIT_REQ    = "book_newcreditedrequirement";

        private const string ATTR_DEBIT_LOA     = "book_debitedloa";             // -> book_fundingline
        private const string ATTR_CREDIT_LOA    = "book_creditedloa";

        private const string ENTITY_PRIOR       = "book_prioritization";
        private const string ATTR_PRIOR_REQ     = "book_requirementfunding";     // lookup from Prioritization to Requirement Funding

        private const string ENTITY_REQ_FUND    = "book_requirementfunding";
        private const string ATTR_REQ_LOA       = "book_lineofaccounting";       // lookup from Requirement Funding to LOA

        private const string ENTITY_LOA         = "book_fundingline";
        private const string ATTR_LOA_FUND      = "book_fund";                   // lookup to Fund
        private const string ATTR_LOA_SAG       = "book_sag";                    // lookup to SAG
        // ==========================================================

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            // Only run on our target entity
            if (!string.Equals(context.PrimaryEntityName, ENTITY_REALIGNMENT, StringComparison.OrdinalIgnoreCase))
            {
                tracing.Trace($"Skipping: PrimaryEntityName != {ENTITY_REALIGNMENT}");
                return;
            }

            // Get Target (new values) and PreImage (existing row before update)
            var target = GetTarget(context);
            Entity preImg = null;

            var isUpdate = context.MessageName.Equals("Update", StringComparison.OrdinalIgnoreCase);
            var isCreate = context.MessageName.Equals("Create", StringComparison.OrdinalIgnoreCase);

            if (isUpdate)
            {
                // We require a PreImage on the Update step so we can evaluate effective values
                preImg = GetPreImage(context, "PreImage");
            }

            // Compute "effective" field values (Target if present, else PreImage)
            EntityReference effDebitLoa    = GetEffectiveEntityReference(target, preImg, ATTR_DEBIT_LOA);
            EntityReference effCreditLoa   = GetEffectiveEntityReference(target, preImg, ATTR_CREDIT_LOA);
            EntityReference effDebitReq    = GetEffectiveEntityReference(target, preImg, ATTR_DEBIT_REQ);
            EntityReference effCreditReq   = GetEffectiveEntityReference(target, preImg, ATTR_CREDIT_REQ);
            EntityReference effDebitPrior  = GetEffectiveEntityReference(target, preImg, ATTR_DEBIT_PRIOR);
            EntityReference effCreditPrior = GetEffectiveEntityReference(target, preImg, ATTR_CREDIT_PRIOR);

            // Resolve LOA for both sides (Debited/Credited)
            var debitLoaRef  = ResolveLoaReference(service, tracing, effDebitLoa, effDebitReq, effDebitPrior);
            var creditLoaRef = ResolveLoaReference(service, tracing, effCreditLoa, effCreditReq, effCreditPrior);

            bool match = false;

            if (debitLoaRef != null && creditLoaRef != null)
            {
                var debitLoa  = service.Retrieve(ENTITY_LOA, debitLoaRef.Id, new ColumnSet(ATTR_LOA_FUND, ATTR_LOA_SAG));
                var creditLoa = service.Retrieve(ENTITY_LOA, creditLoaRef.Id, new ColumnSet(ATTR_LOA_FUND, ATTR_LOA_SAG));

                var debitFund  = debitLoa.GetAttributeValue<EntityReference>(ATTR_LOA_FUND);
                var debitSag   = debitLoa.GetAttributeValue<EntityReference>(ATTR_LOA_SAG);
                var creditFund = creditLoa.GetAttributeValue<EntityReference>(ATTR_LOA_FUND);
                var creditSag  = creditLoa.GetAttributeValue<EntityReference>(ATTR_LOA_SAG);

                // Both Fund and SAG must be non-null and equal by GUID to qualify as a match
                match = (debitFund != null && creditFund != null && debitFund.Id == creditFund.Id)
                     && (debitSag  != null && creditSag  != null && debitSag.Id  == creditSag.Id);
            }
            else
            {
                tracing.Trace("LOA unresolved on one or both sides; defaulting match = false");
            }

            // Set the flag directly in Target (PreOperation will merge this into the row being saved)
            target[ATTR_FLAG] = match;

            tracing.Trace($"Set {ATTR_FLAG} = {match} (debitLoa: {debitLoaRef?.Id}, creditLoa: {creditLoaRef?.Id})");
        }

        private EntityReference ResolveLoaReference(
            IOrganizationService service,
            ITracingService tracing,
            EntityReference directLoa,
            EntityReference requirementRef,
            EntityReference priorRef)
        {
            // 1) Direct LOA present on the transaction?
            if (directLoa != null)
            {
                tracing.Trace($"Resolve LOA: using direct LOA {directLoa.Id}");
                return directLoa;
            }

            // 2) Requirement Funding → LOA
            if (requirementRef != null)
            {
                var req = service.Retrieve(ENTITY_REQ_FUND, requirementRef.Id, new ColumnSet(ATTR_REQ_LOA));
                var reqLoa = req.GetAttributeValue<EntityReference>(ATTR_REQ_LOA);
                if (reqLoa != null)
                {
                    tracing.Trace($"Resolve LOA: via Requirement Funding {requirementRef.Id} → LOA {reqLoa.Id}");
                    return reqLoa;
                }
            }

            // 3) Prioritization → Requirement Funding → LOA
            if (priorRef != null)
            {
                var prior = service.Retrieve(ENTITY_PRIOR, priorRef.Id, new ColumnSet(ATTR_PRIOR_REQ));
                var priorReq = prior.GetAttributeValue<EntityReference>(ATTR_PRIOR_REQ);
                if (priorReq != null)
                {
                    var req = service.Retrieve(ENTITY_REQ_FUND, priorReq.Id, new ColumnSet(ATTR_REQ_LOA));
                    var reqLoa = req.GetAttributeValue<EntityReference>(ATTR_REQ_LOA);
                    if (reqLoa != null)
                    {
                        tracing.Trace($"Resolve LOA: via Prioritization {priorRef.Id} → Requirement {priorReq.Id} → LOA {reqLoa.Id}");
                        return reqLoa;
                    }
                }
            }

            // Not resolvable
            tracing.Trace("Resolve LOA: none found");
            return null;
        }
    }
}
