using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Pre-operation plugin on book_swapitem Create + Update.
    ///
    /// **Debit-first entry model.** The debiting (sending) state drafts a row
    /// with just Debit Prio + Amount and saves. The credited state comes back
    /// later and fills in the Credit Prio. So on every write:
    ///
    ///   Always required:
    ///     • Debit Prio
    ///     • Amount > 0
    ///     • Debit Prio's state matches one of the parent's StateA / StateB
    ///     • Fund / PG / DebitState denormalized from Debit Prio
    ///
    ///   Only enforced when Credit Prio is populated (pair complete):
    ///     • Debit Prio's Fund/PG match Credit Prio's Fund/PG (same-currency swap)
    ///     • Debit and Credit Prios belong to *different* states
    ///     • Those two states match the parent's StateA / StateB (one each)
    ///
    /// Approval-time completeness (every item paired) is enforced by
    /// SwapValidator, not here.
    ///
    /// Fund / PG are read via the debit Prio's LOA (book_lineofaccounting →
    /// book_fundingline). FY26 assumes Prios have a single LOA; FY27 will need
    /// a different resolver — flagged in the schema doc.
    ///
    /// Register with PreImage 'PreImage' on the Update step so we can fall back
    /// to the stored parent / Prio lookups when they aren't in the Target.
    /// </summary>
    public class SwapItemDerivedFieldsPlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.Stage != 20) // 20 = Pre-Operation
            {
                tracing.Trace(
                    $"SwapItemDerivedFieldsPlugin: unexpected stage {context.Stage}; ignoring.");
                return;
            }

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            var debitPrio = GetEffectiveEntityReference(target, preImage,
                SwapItemAttributes.DebitPrioritization);
            var creditPrio = GetEffectiveEntityReference(target, preImage,
                SwapItemAttributes.CreditPrioritization);
            var parent = GetEffectiveEntityReference(target, preImage,
                SwapItemAttributes.StateSwap);
            var amount = GetEffectiveDecimal(target, preImage,
                SwapItemAttributes.Amount);

            if (debitPrio == null)
                throw new InvalidPluginExecutionException(
                    "Swap Item requires a Debit Prioritization.");
            if (parent == null)
                throw new InvalidPluginExecutionException(
                    "Swap Item must belong to a State Swap.");
            if (amount <= 0m)
                throw new InvalidPluginExecutionException(
                    "Swap Item Amount must be greater than zero.");
            if (creditPrio != null && debitPrio.Id == creditPrio.Id)
                throw new InvalidPluginExecutionException(
                    "Debit and Credit Prioritizations must be different records.");

            // Fetch the debit Prio (and the credit Prio if set) in a single
            // FetchXml round-trip.
            var prioIds = creditPrio != null
                ? new[] { debitPrio.Id, creditPrio.Id }
                : new[] { debitPrio.Id };
            var prioRows = RetrievePrioContext(service, prioIds);

            var debitCtx = prioRows.FirstOrDefault(r => r.PrioId == debitPrio.Id);
            var creditCtx = creditPrio != null
                ? prioRows.FirstOrDefault(r => r.PrioId == creditPrio.Id)
                : null;

            if (debitCtx == null)
                throw new InvalidPluginExecutionException(
                    "Could not load the Debit Prioritization.");
            if (creditPrio != null && creditCtx == null)
                throw new InvalidPluginExecutionException(
                    "Could not load the Credit Prioritization.");

            if (debitCtx.State == null)
                throw new InvalidPluginExecutionException(
                    "Debit Prioritization must have a State set.");
            if (debitCtx.Fund == null || debitCtx.PG == null)
                throw new InvalidPluginExecutionException(
                    "Debit Prioritization must resolve to an LOA with a Fund and PG set.");

            // Parent state check applies to whichever side(s) are populated.
            var parentEntity = service.Retrieve(
                EntityNames.StateSwap,
                parent.Id,
                new ColumnSet(StateSwapAttributes.StateA, StateSwapAttributes.StateB));
            var stateA = parentEntity.GetAttributeValue<EntityReference>(StateSwapAttributes.StateA);
            var stateB = parentEntity.GetAttributeValue<EntityReference>(StateSwapAttributes.StateB);

            if (stateA == null || stateB == null)
                throw new InvalidPluginExecutionException(
                    "State Swap must have both State A and State B set before items can be added.");

            if (debitCtx.State.Id != stateA.Id && debitCtx.State.Id != stateB.Id)
                throw new InvalidPluginExecutionException(
                    "Debit Prioritization must belong to State A or State B on the parent Swap.");

            if (creditCtx != null)
            {
                if (creditCtx.State == null)
                    throw new InvalidPluginExecutionException(
                        "Credit Prioritization must have a State set.");
                if (debitCtx.State.Id == creditCtx.State.Id)
                    throw new InvalidPluginExecutionException(
                        "Swap items cannot debit and credit within the same State.");
                if (creditCtx.Fund == null || creditCtx.PG == null)
                    throw new InvalidPluginExecutionException(
                        "Credit Prioritization must resolve to an LOA with a Fund and PG set.");
                if (debitCtx.Fund.Id != creditCtx.Fund.Id)
                    throw new InvalidPluginExecutionException(
                        "Debit and Credit Prioritizations must share the same Fund.");
                if (debitCtx.PG.Id != creditCtx.PG.Id)
                    throw new InvalidPluginExecutionException(
                        "Debit and Credit Prioritizations must share the same PG.");

                var parentStateIds = new[] { stateA.Id, stateB.Id };
                var prioStateIds   = new[] { debitCtx.State.Id, creditCtx.State.Id };
                if (!parentStateIds.OrderBy(g => g).SequenceEqual(prioStateIds.OrderBy(g => g)))
                    throw new InvalidPluginExecutionException(
                        "The Debit and Credit Prioritizations must belong to State A and State B on the parent Swap.");
            }

            // Write derived fields onto the Target so they persist without a
            // second Update call. Fund / PG / DebitState always come from the
            // debit side — that's the source of truth for the row's bucket.
            target[SwapItemAttributes.Fund] = debitCtx.Fund;
            target[SwapItemAttributes.PG] = debitCtx.PG;
            target[SwapItemAttributes.DebitState] = debitCtx.State;

            tracing.Trace(
                $"SwapItemDerivedFieldsPlugin: item validated. Fund={debitCtx.Fund.Id}, " +
                $"PG={debitCtx.PG.Id}, DebitState={debitCtx.State.Id}, Amount={amount}, " +
                $"CreditPrioSet={creditPrio != null}.");
        }

        private sealed class PrioContext
        {
            public Guid PrioId;
            public EntityReference State;
            public EntityReference Fund;
            public EntityReference PG;
        }

        /// <summary>
        /// Single round-trip: for each Prio id, return its State plus the Fund
        /// and PG of its book_lineofaccounting.
        /// </summary>
        private static System.Collections.Generic.List<PrioContext> RetrievePrioContext(
            IOrganizationService service,
            Guid[] prioIds)
        {
            var idFilter = string.Join(
                string.Empty,
                prioIds.Select(g => $"<value>{g}</value>"));

            var fetch = $@"
                <fetch>
                    <entity name='{EntityNames.Prioritization}'>
                        <attribute name='{PrioritizationAttributes.Id}'/>
                        <attribute name='{PrioritizationAttributes.State}'/>
                        <filter>
                            <condition attribute='{PrioritizationAttributes.Id}' operator='in'>{idFilter}</condition>
                        </filter>
                        <link-entity name='{EntityNames.FundingLine}'
                                     from='{FundingLineAttributes.Id}'
                                     to='{PrioritizationAttributes.LineOfAccounting}'
                                     link-type='outer' alias='loa'>
                            <attribute name='{FundingLineAttributes.Fund}'/>
                            <attribute name='{FundingLineAttributes.PG}'/>
                        </link-entity>
                    </entity>
                </fetch>";

            var results = service.RetrieveMultiple(new FetchExpression(fetch)).Entities;
            var list = new System.Collections.Generic.List<PrioContext>(results.Count);
            foreach (var row in results)
            {
                list.Add(new PrioContext
                {
                    PrioId = row.Id,
                    State  = row.GetAttributeValue<EntityReference>(PrioritizationAttributes.State),
                    Fund   = (row.GetAttributeValue<AliasedValue>("loa." + FundingLineAttributes.Fund))?.Value as EntityReference,
                    PG     = (row.GetAttributeValue<AliasedValue>("loa." + FundingLineAttributes.PG))?.Value as EntityReference,
                });
            }
            return list;
        }
    }
}
