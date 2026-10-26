using System;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Walks <see cref="IPluginExecutionContext.ParentContext"/> looking for a
    /// genuine upstream caller — the recursion brake used in place of a blanket
    /// <c>Depth &gt; 1</c> guard, which also skipped Import Wizard / Excel rows
    /// (they arrive at Depth 2).
    ///
    /// Ancestors that are the <b>same operation</b> (same message + table +
    /// record) are ignored: Dataverse chains the operation's own outer context
    /// as a parent (seen in the sandbox Oct 2026 — a plain Depth-1 FT update
    /// had a <c>book_fundingtrack</c> Update parent), so they say nothing about
    /// who issued the write.
    /// </summary>
    public static class PipelineAncestryHelper
    {
        /// <summary>
        /// Returns the first ancestor that is not the same operation and
        /// satisfies <paramref name="match"/>, or null. Traces each ancestor
        /// inspected so the decision is visible in the plugin trace log.
        /// </summary>
        public static IPluginExecutionContext FindUpstream(
            IPluginExecutionContext context,
            Func<IPluginExecutionContext, bool> match,
            ITracingService tracing)
        {
            for (var ancestor = context.ParentContext; ancestor != null; ancestor = ancestor.ParentContext)
            {
                var same = IsSameOperation(context, ancestor);
                tracing?.Trace(
                    $"Ancestor: depth {ancestor.Depth} {ancestor.MessageName} {ancestor.PrimaryEntityName} " +
                    $"{ancestor.PrimaryEntityId}{(same ? " (same operation, ignored)" : "")}");
                if (same) continue;
                if (match(ancestor)) return ancestor;
            }
            return null;
        }

        private static bool IsSameOperation(IPluginExecutionContext context, IPluginExecutionContext ancestor)
        {
            if (ancestor.MessageName != context.MessageName ||
                ancestor.PrimaryEntityName != context.PrimaryEntityName)
                return false;

            // A Create's id may not be stamped on every context in the chain yet.
            return ancestor.PrimaryEntityId == context.PrimaryEntityId ||
                   ancestor.PrimaryEntityId == Guid.Empty ||
                   context.PrimaryEntityId == Guid.Empty;
        }
    }
}
