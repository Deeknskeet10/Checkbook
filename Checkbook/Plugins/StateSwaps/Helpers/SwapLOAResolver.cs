using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.StateSwaps.Helpers
{
    /// <summary>
    /// One resolved swap item: paired debit + credit legs with their LOAs and
    /// parent RFs materialized. LOAs and parent RFs are read from each side's
    /// Prioritization (FY26: Prio → book_lineofaccounting, Prio → book_requirementfunding)
    /// or, FY27+, from each side's Prioritization Funding (PF → RF → LOA); see
    /// <see cref="SwapLOAResolver.ResolveLegs"/>.
    /// </summary>
    public sealed class ResolvedSwapItem
    {
        public Guid SwapItemId;
        public decimal Amount;
        public EntityReference DebitPrio;
        public EntityReference CreditPrio;
        public EntityReference DebitLOA;
        public EntityReference CreditLOA;
        public EntityReference DebitRF;
        public EntityReference CreditRF;
        // FY27+ only: the PF junction on each side (null on FY26 items).
        public EntityReference DebitPF;
        public EntityReference CreditPF;
        // Prio-level Fund Centers (may sit below state level — walk up with
        // FundCenterWalkHelper before using as a Distribution FC) and the
        // item's denormalized Fund / PG (SwapItemDerivedFieldsPlugin keeps
        // these in sync with the debit Prio; per-row Fund/PG match across
        // both sides is validated at item save). Consumed by
        // SwapDistributionCreator.
        public EntityReference DebitFundCenter;
        public EntityReference CreditFundCenter;
        public EntityReference Fund;
        public EntityReference PG;
    }

    /// <summary>
    /// Loads active swap items for a State Swap and resolves each one's debit /
    /// credit LOAs (and parent RFs) via the two linked Prioritizations. Rows
    /// missing an LOA are treated as validation failures — SwapValidator should
    /// have caught them pre-op, but we still throw here as a defensive guard.
    /// </summary>
    public static class SwapLOAResolver
    {
        public static List<ResolvedSwapItem> ResolveItems(
            IOrganizationService service,
            ITracingService tracing,
            Guid swapId)
        {
            // Pull each item plus both linked Prios' LOA + RF references in a
            // single FetchXml round-trip.
            var fetch = $@"
                <fetch>
                    <entity name='{EntityNames.SwapItem}'>
                        <attribute name='{SwapItemAttributes.Id}'/>
                        <attribute name='{SwapItemAttributes.Amount}'/>
                        <attribute name='{SwapItemAttributes.DebitPrioritization}'/>
                        <attribute name='{SwapItemAttributes.CreditPrioritization}'/>
                        <attribute name='{SwapItemAttributes.Fund}'/>
                        <attribute name='{SwapItemAttributes.PG}'/>
                        <filter type='and'>
                            <condition attribute='{SwapItemAttributes.StateSwap}' operator='eq' value='{swapId}'/>
                            <condition attribute='{SwapItemAttributes.StateCode}' operator='eq' value='{StateCodeValues.Active}'/>
                        </filter>
                        <link-entity name='{EntityNames.Prioritization}'
                                     from='{PrioritizationAttributes.Id}'
                                     to='{SwapItemAttributes.DebitPrioritization}'
                                     link-type='inner' alias='dp'>
                            <attribute name='{PrioritizationAttributes.LineOfAccounting}'/>
                            <attribute name='{PrioritizationAttributes.RequirementFunding}'/>
                            <attribute name='{PrioritizationAttributes.FundCenter}'/>
                        </link-entity>
                        <link-entity name='{EntityNames.Prioritization}'
                                     from='{PrioritizationAttributes.Id}'
                                     to='{SwapItemAttributes.CreditPrioritization}'
                                     link-type='inner' alias='cp'>
                            <attribute name='{PrioritizationAttributes.LineOfAccounting}'/>
                            <attribute name='{PrioritizationAttributes.RequirementFunding}'/>
                            <attribute name='{PrioritizationAttributes.FundCenter}'/>
                        </link-entity>
                    </entity>
                </fetch>";

            var rows = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            var resolved = new List<ResolvedSwapItem>(rows.Count);

            foreach (var row in rows)
            {
                var item = new ResolvedSwapItem
                {
                    SwapItemId = row.Id,
                    Amount     = NumericHelper.ToDecimal(
                                     row.GetAttributeValue<object>(SwapItemAttributes.Amount), 0m),
                    DebitPrio  = row.GetAttributeValue<EntityReference>(SwapItemAttributes.DebitPrioritization),
                    CreditPrio = row.GetAttributeValue<EntityReference>(SwapItemAttributes.CreditPrioritization),
                    DebitLOA   = AliasedValueHelper.GetReference(row, "dp." + PrioritizationAttributes.LineOfAccounting),
                    CreditLOA  = AliasedValueHelper.GetReference(row, "cp." + PrioritizationAttributes.LineOfAccounting),
                    DebitRF    = AliasedValueHelper.GetReference(row, "dp." + PrioritizationAttributes.RequirementFunding),
                    CreditRF   = AliasedValueHelper.GetReference(row, "cp." + PrioritizationAttributes.RequirementFunding),
                    DebitFundCenter  = AliasedValueHelper.GetReference(row, "dp." + PrioritizationAttributes.FundCenter),
                    CreditFundCenter = AliasedValueHelper.GetReference(row, "cp." + PrioritizationAttributes.FundCenter),
                    Fund       = row.GetAttributeValue<EntityReference>(SwapItemAttributes.Fund),
                    PG         = row.GetAttributeValue<EntityReference>(SwapItemAttributes.PG),
                };

                if (item.DebitLOA == null || item.CreditLOA == null)
                {
                    throw new InvalidPluginExecutionException(
                        $"Swap Item {item.SwapItemId} has a Prioritization without an LOA. " +
                        "Both Prioritizations must have a Line of Accounting set before the swap can be processed.");
                }

                resolved.Add(item);
            }

            tracing.Trace($"SwapLOAResolver: resolved {resolved.Count} item(s) for swap {swapId}.");
            return resolved;
        }

        /// <summary>
        /// FY27+ (PF → PF legs): each side's RF, LOA, Prio and Fund Center come from its
        /// Prioritization Funding; Fund / PG from the debit PF's LOA (SwapRules has already
        /// required both sides to match). SwapValidator ran SwapRules pre-op; the null
        /// checks here are a defensive guard.
        /// </summary>
        public static List<ResolvedSwapItem> ResolveLegs(
            IOrganizationService service,
            ITracingService tracing,
            Guid swapId)
        {
            var legs = SwapRules.LoadLegs(service, swapId);
            var pfs = SwapPfContext.Load(service,
                legs.Where(l => l.DebitPF != null && l.CreditPF != null)
                    .SelectMany(l => new[] { l.DebitPF.Id, l.CreditPF.Id }));

            var resolved = new List<ResolvedSwapItem>(legs.Count);
            foreach (var leg in legs)
            {
                if (leg.DebitPF == null || leg.CreditPF == null
                    || !pfs.TryGetValue(leg.DebitPF.Id, out var debit)
                    || !pfs.TryGetValue(leg.CreditPF.Id, out var credit))
                    throw new InvalidPluginExecutionException(
                        $"Swap Item {leg.SwapItemId} is missing a debit or credit Prioritization Funding.");
                if (debit.LOA == null || credit.LOA == null)
                    throw new InvalidPluginExecutionException(
                        $"Swap Item {leg.SwapItemId}: a Prioritization Funding does not resolve to a Requirement Funding with an LOA.");

                resolved.Add(new ResolvedSwapItem
                {
                    SwapItemId       = leg.SwapItemId,
                    Amount           = leg.Amount,
                    DebitPF          = leg.DebitPF,
                    CreditPF         = leg.CreditPF,
                    DebitPrio        = debit.Prioritization,
                    CreditPrio       = credit.Prioritization,
                    DebitRF          = debit.RequirementFunding,
                    CreditRF         = credit.RequirementFunding,
                    DebitLOA         = debit.LOA,
                    CreditLOA        = credit.LOA,
                    DebitFundCenter  = debit.FundCenter,
                    CreditFundCenter = credit.FundCenter,
                    Fund             = debit.Fund,
                    PG               = debit.PG,
                });
            }

            tracing.Trace($"SwapLOAResolver: resolved {resolved.Count} FY27 leg(s) for swap {swapId}.");
            return resolved;
        }
    }
}
