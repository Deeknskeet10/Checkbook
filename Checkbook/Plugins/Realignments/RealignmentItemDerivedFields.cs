using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Realignments
{
    /// <summary>
    /// Pre-operation plugin on book_realignmentitem Create + Update (FY27).
    ///
    /// Each item moves money along exactly ONE debit unit:
    ///   • book_debitprioritizationfunding    (State path — PF, Prio ↔ RF)
    ///   • book_debitrequirementdetailfunding (direct/OPR path — RDF, RD ↔ RF)
    ///   • book_debitrequirementfunding       (plain RF→RF — no junction)
    /// and lands on an existing credit RF (book_creditrequirementfunding).
    ///
    /// Validates the XOR of the debit unit + amount, then denormalizes
    /// Fund/PG/SAG (and DebitState for the PF path) from the debit side's LOA, and
    /// computes book_samefundandsag against the credit RF's LOA (when the credit RF
    /// is set). Writes onto the Target so it persists in the same write. Mirrors
    /// SwapItemDerivedFieldsPlugin. See docs/Realignment-FY27-Redesign.md.
    ///
    /// Register: PreOperation, Sync, book_realignmentitem, Create + Update.
    /// PreImage 'PreImage' (Update) with the debit/credit lookups + amount so a
    /// partial edit still resolves the full shape.
    /// </summary>
    public class RealignmentItemDerivedFields : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != RealignmentItemAttributes.EntityLogicalName)
                return;
            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;
            if (context.Stage != 20)
            {
                tracing.Trace($"RealignmentItemDerivedFields: unexpected stage {context.Stage}; ignoring.");
                return;
            }

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            var parent = GetEffectiveEntityReference(target, preImage, RealignmentItemAttributes.Realignment);
            var amount = GetEffectiveDecimal(target, preImage, RealignmentItemAttributes.Amount);

            var debitPf = GetEffectiveEntityReference(target, preImage, RealignmentItemAttributes.DebitPrioritizationFunding);
            var debitRdf = GetEffectiveEntityReference(target, preImage, RealignmentItemAttributes.DebitRequirementDetailFunding);
            var debitRf = GetEffectiveEntityReference(target, preImage, RealignmentItemAttributes.DebitRequirementFunding);
            var creditRf = GetEffectiveEntityReference(target, preImage, RealignmentItemAttributes.CreditRequirementFunding);

            if (parent == null)
                throw new InvalidPluginExecutionException("Realignment Item must belong to a Realignment.");
            if (amount <= 0m)
                throw new InvalidPluginExecutionException("Realignment Item Amount must be greater than zero.");

            int debitCount = (debitPf != null ? 1 : 0) + (debitRdf != null ? 1 : 0) + (debitRf != null ? 1 : 0);
            if (debitCount != 1)
                throw new InvalidPluginExecutionException(
                    "A Realignment Item must specify exactly one debit source: a Prioritization Funding, " +
                    "a Requirement Detail Funding, or a Requirement Funding.");

            // ---- Resolve the debit RF (+ LOA, + debit state for the PF path) ----
            EntityReference debitRfRef;
            EntityReference debitLoaRef = null;
            EntityReference debitState = null;

            if (debitPf != null)
            {
                var pf = service.Retrieve(EntityNames.PrioritizationFunding, debitPf.Id,
                    new ColumnSet(PrioritizationFundingAttributes.RequirementFunding,
                                  PrioritizationFundingAttributes.LineOfAccounting,
                                  PrioritizationFundingAttributes.Prioritization));
                debitRfRef = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.RequirementFunding);
                debitLoaRef = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.LineOfAccounting);
                var prioRef = pf.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization);
                if (prioRef != null)
                {
                    var prio = service.Retrieve(EntityNames.Prioritization, prioRef.Id,
                        new ColumnSet(PrioritizationAttributes.State));
                    debitState = prio.GetAttributeValue<EntityReference>(PrioritizationAttributes.State);
                }
            }
            else if (debitRdf != null)
            {
                var rdf = service.Retrieve(EntityNames.RequirementDetailFunding, debitRdf.Id,
                    new ColumnSet(RequirementDetailFundingAttributes.RequirementFunding));
                debitRfRef = rdf.GetAttributeValue<EntityReference>(RequirementDetailFundingAttributes.RequirementFunding);
            }
            else
            {
                debitRfRef = debitRf;
            }

            if (debitRfRef == null)
                throw new InvalidPluginExecutionException(
                    "The debit source does not resolve to a Requirement Funding.");

            // LOA of the debit RF (PF path may already carry the stamped LOA).
            FundingParts debitParts = ResolveLoaParts(service, ref debitLoaRef, debitRfRef);
            if (debitParts == null)
                throw new InvalidPluginExecutionException(
                    "The debit Requirement Funding has no Line of Accounting — cannot derive Fund/SAG.");

            // ---- Credit side (optional at draft) + sameness ----
            bool? sameFundSag = null;
            FundingParts creditParts = null;
            if (creditRf != null)
            {
                EntityReference creditLoaRef = null;
                creditParts = ResolveLoaParts(service, ref creditLoaRef, creditRf);
                if (creditParts != null)
                {
                    sameFundSag =
                        SameRef(debitParts.Fund, creditParts.Fund) &&
                        SameRef(debitParts.PG, creditParts.PG) &&
                        SameRef(debitParts.SAG, creditParts.SAG);
                }
            }

            // ---- Write derived fields onto the Target ----
            if (debitParts.Fund != null) target[RealignmentItemAttributes.Fund] = debitParts.Fund;
            if (debitParts.PG != null) target[RealignmentItemAttributes.PG] = debitParts.PG;
            if (debitParts.SAG != null) target[RealignmentItemAttributes.SAG] = debitParts.SAG;
            if (debitState != null) target[RealignmentItemAttributes.DebitState] = debitState;
            if (sameFundSag.HasValue) target[RealignmentItemAttributes.SameFundandSAG] = sameFundSag.Value;

            if (context.MessageName == "Create" &&
                string.IsNullOrWhiteSpace(target.GetAttributeValue<string>(RealignmentItemAttributes.Name)))
            {
                var from = debitParts.LoaName ?? "debit";
                var to = creditParts?.LoaName ?? "unassigned";
                target[RealignmentItemAttributes.Name] = $"{from} → {to} : {amount:N0}";
            }

            tracing.Trace(
                $"RealignmentItemDerivedFields: Fund={debitParts.Fund?.Id}, PG={debitParts.PG?.Id}, " +
                $"SAG={debitParts.SAG?.Id}, DebitState={debitState?.Id}, SameFundSAG={sameFundSag}, Amount={amount}.");
        }

        private sealed class FundingParts
        {
            public EntityReference Fund;
            public EntityReference PG;
            public EntityReference SAG;
            public string LoaName;
        }

        /// <summary>
        /// Resolves Fund/PG/SAG (+ LOA name) for a Requirement Funding. If
        /// <paramref name="loaRef"/> is already known (e.g. a PF's stamped LOA) it
        /// is used directly; otherwise the RF is retrieved to find its LOA.
        /// Returns null when no LOA can be resolved.
        /// </summary>
        private static FundingParts ResolveLoaParts(
            IOrganizationService service, ref EntityReference loaRef, EntityReference rfRef)
        {
            if (loaRef == null && rfRef != null)
            {
                var rf = service.Retrieve(EntityNames.RequirementFunding, rfRef.Id,
                    new ColumnSet(RequirementFundingAttributes.LineOfAccounting));
                loaRef = rf.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
            }
            if (loaRef == null)
                return null;

            var loa = service.Retrieve(EntityNames.FundingLine, loaRef.Id,
                new ColumnSet(FundingLineAttributes.Fund, FundingLineAttributes.PG,
                              FundingLineAttributes.SAG, FundingLineAttributes.Name));
            return new FundingParts
            {
                Fund = loa.GetAttributeValue<EntityReference>(FundingLineAttributes.Fund),
                PG = loa.GetAttributeValue<EntityReference>(FundingLineAttributes.PG),
                SAG = loa.GetAttributeValue<EntityReference>(FundingLineAttributes.SAG),
                LoaName = loa.GetAttributeValue<string>(FundingLineAttributes.Name),
            };
        }

        private static bool SameRef(EntityReference a, EntityReference b)
        {
            if (a == null && b == null) return true;
            if (a == null || b == null) return false;
            return a.Id == b.Id;
        }
    }
}
