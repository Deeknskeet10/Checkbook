using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// A centrally managed Requirement (book_national) is spend-planned at the
    /// Requirement level by the NPM, so its Prioritizations can never be broken
    /// out into individual plans. This guard keeps book_breakout and
    /// book_national mutually consistent by force-clearing book_breakout to
    /// false whenever the effective record is centrally managed — pre-operation,
    /// so the correction lands in the same write and the PF stamp derives the
    /// right mode.
    /// </summary>
    /// <remarks>
    /// Register: PreOperation, Sync, book_requirements, Create + Update.
    /// Filter attrs (Update): book_national, book_breakout.
    /// Pre-image "PreImage" (Update): book_national, book_breakout.
    /// </remarks>
    public class RequirementBreakoutConsistencyGuard : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Requirements)
                return;
            if (context.MessageName != "Create" && context.MessageName != "Update")
                return;

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            var national = GetEffectiveBool(target, preImage, RequirementsAttributes.National);
            var breakout = GetEffectiveBool(target, preImage, RequirementsAttributes.Breakout);

            if (national && breakout)
            {
                target[RequirementsAttributes.Breakout] = false;
                tracing.Trace("Centrally managed Requirement cannot be breakout; cleared book_breakout.");
            }
        }
    }
}
