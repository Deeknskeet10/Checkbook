using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard for book_requirementdetailfunding junction rows and
    /// book_prioritization records, enforcing the Prio XOR RD-direct-funding
    /// invariant at the Requirement level.
    ///
    /// On book_requirementdetailfunding Create / Update:
    ///   1. Both Requirement Detail and Requirement Funding lookups are present.
    ///   2. RD.Requirement == RF.Requirement (same parent Requirement).
    ///   3. The parent Requirement has no active Prioritizations
    ///      (Prio path and RD-direct-funding path are mutually exclusive).
    ///   4. The (RD, RF) pair is unique among active junctions.
    ///   5. Sum of active junction FundedAmount on the RF (with this change
    ///      applied) does not exceed RF.TDP.
    ///   • Autopopulates book_name on Create when the caller hasn't set one,
    ///     formatted as "&lt;RD&gt; ↔ &lt;RF&gt;".
    ///
    /// On book_prioritization Create:
    ///   • Rejects if any active book_requirementdetailfunding junctions exist
    ///     for the Prio's Requirement (the Requirement is already on the
    ///     direct-funding path).
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Create   | Stage: PreOperation | Mode: Sync
    ///         Primary entity: book_requirementdetailfunding
    ///   • Message: Update   | Stage: PreOperation | Mode: Sync
    ///         Primary entity: book_requirementdetailfunding
    ///         Filtering attributes: book_requirementdetail, book_requirementfunding,
    ///                               book_fundedamount, book_validatedamount
    ///         PreImage: "PreImage" — all four filtered attrs
    ///   • Message: Create   | Stage: PreOperation | Mode: Sync
    ///         Primary entity: book_prioritization
    /// </summary>
    public class RequirementDetailFundingGuard : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName == EntityNames.RequirementDetailFunding)
            {
                GuardJunction(context, service, tracing);
                return;
            }

            if (context.PrimaryEntityName == EntityNames.Prioritization &&
                context.MessageName == "Create")
            {
                GuardPrioCreate(context, service, tracing);
                return;
            }
        }

        // -----------------------------------------------------------------
        // book_requirementdetailfunding guards
        // -----------------------------------------------------------------

        private void GuardJunction(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = context.MessageName == "Update" ? TryGetPreImage(context) : null;

            var rdRef = GetEffectiveEntityReference(
                target, preImage, RequirementDetailFundingAttributes.RequirementDetail);
            var rfRef = GetEffectiveEntityReference(
                target, preImage, RequirementDetailFundingAttributes.RequirementFunding);

            if (rdRef == null || rfRef == null)
            {
                throw new InvalidPluginExecutionException(
                    "Requirement Detail Funding requires both a Requirement Detail and a Requirement Funding.");
            }

            // ---- Retrieve both parents ----
            var rd = service.Retrieve(
                EntityNames.RequirementDetails,
                rdRef.Id,
                new ColumnSet(
                    RequirementDetailsAttributes.Requirement,
                    RequirementDetailsAttributes.Name));

            var rf = service.Retrieve(
                EntityNames.RequirementFunding,
                rfRef.Id,
                new ColumnSet(
                    RequirementFundingAttributes.Requirement,
                    RequirementFundingAttributes.TDP,
                    RequirementFundingAttributes.Name));

            // ---- 1. Same Requirement ----
            var rdReq = rd.GetAttributeValue<EntityReference>(
                RequirementDetailsAttributes.Requirement);
            var rfReq = rf.GetAttributeValue<EntityReference>(
                RequirementFundingAttributes.Requirement);

            if (rdReq == null || rfReq == null || rdReq.Id != rfReq.Id)
            {
                throw new InvalidPluginExecutionException(
                    "Requirement Detail and Requirement Funding must belong to the same Requirement.");
            }

            // ---- 2. XOR with the Prio path ----
            if (RequirementHasActivePrioritizations(service, rdReq.Id))
            {
                throw new InvalidPluginExecutionException(
                    "This Requirement is on the Prioritization funding path. " +
                    "Remove its Prioritizations before funding Requirement Details directly.");
            }

            // ---- 3. Uniqueness of (RD, RF) ----
            EnsureUniquePair(service, rdRef.Id, rfRef.Id, context, tracing);

            // ---- 4. RF.TDP cap ----
            EnforceTDPCap(service, target, preImage, rfRef.Id, rf, context, tracing);

            // ---- Name autopop (Create only, when caller didn't set one) ----
            if (context.MessageName == "Create" &&
                string.IsNullOrWhiteSpace(target.GetAttributeValue<string>(
                    RequirementDetailFundingAttributes.Name)))
            {
                var rdName = rd.GetAttributeValue<string>(RequirementDetailsAttributes.Name) ?? "RD";
                var rfName = rf.GetAttributeValue<string>(RequirementFundingAttributes.Name) ?? "RF";
                target[RequirementDetailFundingAttributes.Name] = $"{rdName} ↔ {rfName}";
            }

            tracing.Trace("Requirement Detail Funding guard passed.");
        }

        private static void EnsureUniquePair(
            IOrganizationService service,
            Guid rdId,
            Guid rfId,
            IPluginExecutionContext context,
            ITracingService tracing)
        {
            var fetch = $@"
                <fetch top='1'>
                    <entity name='{EntityNames.RequirementDetailFunding}'>
                        <attribute name='{RequirementDetailFundingAttributes.Id}'/>
                        <filter type='and'>
                            <condition attribute='{RequirementDetailFundingAttributes.StateCode}' operator='eq' value='0'/>
                            <condition attribute='{RequirementDetailFundingAttributes.RequirementDetail}' operator='eq' value='{rdId}'/>
                            <condition attribute='{RequirementDetailFundingAttributes.RequirementFunding}' operator='eq' value='{rfId}'/>
                            {(context.MessageName == "Update"
                                ? $"<condition attribute='{RequirementDetailFundingAttributes.Id}' operator='ne' value='{context.PrimaryEntityId}'/>"
                                : string.Empty)}
                        </filter>
                    </entity>
                </fetch>";

            var hits = service.RetrieveMultiple(new FetchExpression(fetch));
            if (hits.Entities.Count > 0)
            {
                throw new InvalidPluginExecutionException(
                    "An active Requirement Detail Funding already exists for this Requirement Detail / Requirement Funding pair.");
            }

            tracing.Trace("Pair uniqueness check passed.");
        }

        private void EnforceTDPCap(
            IOrganizationService service,
            Entity target,
            Entity preImage,
            Guid rfId,
            Entity rf,
            IPluginExecutionContext context,
            ITracingService tracing)
        {
            var rfTDP = rf.GetAttributeValue<decimal?>(RequirementFundingAttributes.TDP) ?? 0m;
            tracing.Trace($"RF TDP = {rfTDP}");

            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{EntityNames.RequirementDetailFunding}'>
                        <attribute name='{RequirementDetailFundingAttributes.FundedAmount}' alias='total_funded' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{RequirementDetailFundingAttributes.StateCode}' operator='eq' value='0'/>
                            <condition attribute='{RequirementDetailFundingAttributes.RequirementFunding}' operator='eq' value='{rfId}'/>
                        </filter>
                    </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));
            decimal siblingSum = 0m;

            if (result.Entities.Count > 0)
            {
                var f = result.Entities[0].GetAttributeValue<AliasedValue>("total_funded");
                siblingSum = f != null ? Convert.ToDecimal(f.Value) : 0m;
            }

            var newFunded = GetEffectiveDecimal(
                target, preImage, RequirementDetailFundingAttributes.FundedAmount);
            var oldFunded = preImage?.GetAttributeValue<decimal?>(
                RequirementDetailFundingAttributes.FundedAmount) ?? 0m;

            var proposedTotal = context.MessageName == "Create"
                ? siblingSum + newFunded
                : siblingSum - oldFunded + newFunded;

            tracing.Trace(
                $"Sibling sum={siblingSum}, oldFunded={oldFunded}, newFunded={newFunded}, " +
                $"proposed={proposedTotal}");

            if (proposedTotal > rfTDP)
            {
                throw new InvalidPluginExecutionException(
                    $"This change would exceed the Requirement Funding's TDP cap. " +
                    $"RF TDP = {rfTDP:N2}, Proposed junction total = {proposedTotal:N2}.");
            }

            tracing.Trace("TDP cap check passed.");
        }

        // -----------------------------------------------------------------
        // book_prioritization guard
        // -----------------------------------------------------------------

        private void GuardPrioCreate(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            var target = GetTarget(context);

            // Resolve the parent Requirement: prefer the direct lookup, fall
            // back to RF.Requirement for legacy-shape Prios.
            var requirementRef = target.GetAttributeValue<EntityReference>(
                PrioritizationAttributes.Requirement);

            if (requirementRef == null)
            {
                var rfRef = target.GetAttributeValue<EntityReference>(
                    PrioritizationAttributes.RequirementFunding);
                if (rfRef == null)
                {
                    tracing.Trace("Prioritization has no Requirement or RF — XOR guard skipped.");
                    return;
                }

                var rf = service.Retrieve(
                    EntityNames.RequirementFunding,
                    rfRef.Id,
                    new ColumnSet(RequirementFundingAttributes.Requirement));
                requirementRef = rf.GetAttributeValue<EntityReference>(
                    RequirementFundingAttributes.Requirement);
            }

            if (requirementRef == null)
            {
                tracing.Trace("Could not resolve parent Requirement — XOR guard skipped.");
                return;
            }

            if (RequirementHasActiveDirectFunding(service, requirementRef.Id))
            {
                throw new InvalidPluginExecutionException(
                    "This Requirement is on the direct Requirement Detail funding path. " +
                    "Remove its Requirement Detail Funding rows before adding a Prioritization.");
            }

            tracing.Trace("Prioritization XOR guard passed.");
        }

        // -----------------------------------------------------------------
        // Shared XOR probes
        // -----------------------------------------------------------------

        private static bool RequirementHasActivePrioritizations(
            IOrganizationService service, Guid requirementId)
        {
            // Catches both FY27+ Prios (direct book_requirement) and legacy
            // Prios (via book_requirementfunding → Requirement).
            var direct = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                        new ConditionExpression(
                            PrioritizationAttributes.Requirement,
                            ConditionOperator.Equal, requirementId)
                    }
                }
            };
            if (service.RetrieveMultiple(direct).Entities.Count > 0)
                return true;

            var viaRf = new QueryExpression(EntityNames.Prioritization)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active)
                    }
                }
            };
            var rfLink = viaRf.AddLink(
                EntityNames.RequirementFunding,
                PrioritizationAttributes.RequirementFunding,
                RequirementFundingAttributes.Id);
            rfLink.LinkCriteria.AddCondition(
                RequirementFundingAttributes.Requirement,
                ConditionOperator.Equal, requirementId);

            return service.RetrieveMultiple(viaRf).Entities.Count > 0;
        }

        private static bool RequirementHasActiveDirectFunding(
            IOrganizationService service, Guid requirementId)
        {
            var q = new QueryExpression(EntityNames.RequirementDetailFunding)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            RequirementDetailFundingAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active)
                    }
                }
            };
            var rdLink = q.AddLink(
                EntityNames.RequirementDetails,
                RequirementDetailFundingAttributes.RequirementDetail,
                RequirementDetailsAttributes.Id);
            rdLink.LinkCriteria.AddCondition(
                RequirementDetailsAttributes.Requirement,
                ConditionOperator.Equal, requirementId);

            return service.RetrieveMultiple(q).Entities.Count > 0;
        }
    }
}
