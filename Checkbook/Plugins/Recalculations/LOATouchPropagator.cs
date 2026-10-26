using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Shared base for plugins that, on Create/Update/Delete of some entity,
    /// must recalculate the LOA(s) referenced from that entity. Subclasses
    /// declare which entity they bind to and which attribute holds the LOA
    /// EntityReference; the base does the Stage 40 / nesting (see
    /// <see cref="RecalcWhenNested"/>) / message
    /// filtering, collects unique affected LOA ids (handling re-link on
    /// Update by recalculating both old and new LOA when a pre-image is
    /// registered), and drives <see cref="TDPCalculationHelper.BatchRecalculateLOATDP"/>
    /// at the end.
    ///
    /// For multi-hop entities (e.g. book_decision → book_fundingtrack → LOA)
    /// override <see cref="CollectAffectedLOAs"/> instead of relying on
    /// <see cref="LoaAttribute"/>.
    /// </summary>
    public abstract class LOATouchPropagator : PluginBase
    {
        /// <summary>Logical name of the entity this plugin binds to.</summary>
        protected abstract string EntityName { get; }

        /// <summary>
        /// Attribute on the bound entity that holds the LOA EntityReference.
        /// Used by the default <see cref="CollectAffectedLOAs"/> implementation.
        /// Subclasses that override <c>CollectAffectedLOAs</c> may return null.
        /// </summary>
        protected virtual string LoaAttribute => null;

        /// <summary>
        /// Which messages this plugin handles. Defaults to Create / Update / Delete.
        /// </summary>
        protected virtual bool HandlesMessage(string message)
            => message == "Create" || message == "Update" || message == "Delete";

        /// <summary>
        /// When false (default) the plugin skips at <c>Depth &gt; 1</c>: the
        /// tables it binds to are written by orchestrators (Realignment,
        /// Turn-In, State Swap) that recalc LOA TDP themselves at the end, and
        /// a mid-orchestration recalc can trip the non-negative guard on a
        /// transient state.
        ///
        /// When true the plugin also runs nested, skipping only when an
        /// upstream ancestor (not this operation's own outer context — see
        /// <see cref="PipelineAncestryHelper"/>) is a write on an LOA-touch
        /// table or an LOA recalc Custom API — the recursion brake.
        /// Use for tables only users write (Decisions, Funding Tracks), whose
        /// Import from Excel/CSV rows arrive at Depth 2 under the import
        /// job and were silently skipped.
        /// </summary>
        protected virtual bool RecalcWhenNested => false;

        /// <summary>
        /// Tables whose writes drive (or are) an LOA TDP recalc. A nested
        /// write under one of these is a side effect of a recalc already in
        /// progress — e.g. the Funding Track update from Decision's
        /// <c>CalculateRollupFieldRequest</c>, or <c>LOAGenerator</c> linking a
        /// new Funding Track — and the outer plugin covers it.
        /// </summary>
        private static readonly HashSet<string> LoaTouchTables = new HashSet<string>
        {
            EntityNames.Decision,
            EntityNames.FundingTrack,
            EntityNames.FundingLine,
            EntityNames.Ledger,
            EntityNames.RequirementFunding,
        };

        /// <summary>
        /// Custom APIs that write LOA-touch rows and run
        /// <c>BatchRecalculateLOATDP</c> themselves at the end
        /// (<c>LOAGenerator</c> links FTs; <c>LOATDPReconciler</c> writes LOAs).
        /// </summary>
        private static readonly HashSet<string> LoaRecalcApis = new HashSet<string>
        {
            "book_GenerateLOAs",
            "book_RecalculateLOATDP",
        };

        private static bool IsNestedUnderLoaTouchWrite(IPluginExecutionContext context, ITracingService tracing)
        {
            return PipelineAncestryHelper.FindUpstream(context,
                a => LoaTouchTables.Contains(a.PrimaryEntityName) || LoaRecalcApis.Contains(a.MessageName),
                tracing) != null;
        }

        /// <summary>
        /// Resolves the set of LOA ids affected by this invocation. Default
        /// reads <see cref="LoaAttribute"/> from target and pre-image, with a
        /// DB fallback on Update when neither carries the lookup.
        /// </summary>
        protected virtual void CollectAffectedLOAs(
            IOrganizationService service,
            ITracingService tracing,
            IPluginExecutionContext context,
            Entity target,
            Entity preImage,
            HashSet<Guid> loaIds)
        {
            if (string.IsNullOrEmpty(LoaAttribute))
            {
                throw new InvalidOperationException(
                    $"{GetType().Name}: LoaAttribute is not set and CollectAffectedLOAs is not overridden.");
            }

            AddLoaFrom(target, LoaAttribute, loaIds);
            AddLoaFrom(preImage, LoaAttribute, loaIds);

            if (loaIds.Count == 0 && context.MessageName == "Update")
            {
                var current = service.Retrieve(
                    EntityName, context.PrimaryEntityId, new ColumnSet(LoaAttribute));
                AddLoaFrom(current, LoaAttribute, loaIds);
                tracing.Trace($"Resolved LOA from DB fallback.");
            }
        }

        /// <summary>
        /// Helper for subclasses that override <see cref="CollectAffectedLOAs"/>:
        /// pulls an EntityReference off the entity at <paramref name="attribute"/>
        /// and adds its id to <paramref name="loaIds"/>.
        /// </summary>
        protected static void AddLoaFrom(Entity entity, string attribute, HashSet<Guid> loaIds)
        {
            if (entity == null) return;
            var reference = entity.GetAttributeValue<EntityReference>(attribute);
            if (reference != null) loaIds.Add(reference.Id);
        }

        protected sealed override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityName)
            {
                tracing.Trace($"Skipping - not a {EntityName} record.");
                return;
            }

            if (context.Stage != 40 || !HandlesMessage(context.MessageName))
            {
                tracing.Trace(
                    $"Skipping - Stage {context.Stage}, Message {context.MessageName} not handled.");
                return;
            }

            if (context.Depth > 1)
            {
                if (!RecalcWhenNested)
                {
                    tracing.Trace($"Skipping - depth {context.Depth} > 1 to avoid recursion.");
                    return;
                }
                if (IsNestedUnderLoaTouchWrite(context, tracing))
                {
                    tracing.Trace($"Skipping - depth {context.Depth}, nested under an LOA-touch write.");
                    return;
                }
                tracing.Trace($"Depth {context.Depth} with no LOA-touch ancestor (bulk edit / import) - recalculating.");
            }

            Entity target = null;
            Entity preImage = null;

            if (context.MessageName == "Delete")
            {
                preImage = TryGetPreImage(context);
                if (preImage == null)
                {
                    tracing.Trace("Delete: no pre-image; cannot determine LOA. Skipping.");
                    return;
                }
            }
            else
            {
                target = GetTarget(context);
                if (context.MessageName == "Update")
                    preImage = TryGetPreImage(context);
            }

            var loaIds = new HashSet<Guid>();
            CollectAffectedLOAs(service, tracing, context, target, preImage, loaIds);

            if (loaIds.Count == 0)
            {
                tracing.Trace("No affected LOAs determined; nothing to recalc.");
                return;
            }

            TDPCalculationHelper.BatchRecalculateLOATDP(service, loaIds, tracing);
            tracing.Trace($"Batch-recalculated {loaIds.Count} LOA(s).");
        }
    }
}
