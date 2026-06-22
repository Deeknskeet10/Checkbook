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
    /// EntityReference; the base does the Stage 40 / Depth &gt; 1 / message
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
                tracing.Trace($"Skipping - depth {context.Depth} > 1 to avoid recursion.");
                return;
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
