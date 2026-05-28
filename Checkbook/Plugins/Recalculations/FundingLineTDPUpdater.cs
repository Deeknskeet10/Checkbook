using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation updater for Funding Line (LOA) that recalculates TDP Remaining
    /// whenever the LOA's NewTDP changes. Accepts negative balances.
    /// </summary>
    public class FundingLineTDPRemainingUpdater : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            // Only act on Funding Line / LOA updates in Post-Operation
            if (context.PrimaryEntityName != EntityNames.FundingLine)
            {
                tracing.Trace($"Skipping - not a {EntityNames.FundingLine} record.");
                return;
            }

            if (context.MessageName != "Update" || context.Stage != 40) // Post-Operation
            {
                tracing.Trace($"Skipping - Stage {context.Stage}, Message {context.MessageName} not handled.");
                return;
            }

            // Avoid recursion
            if (context.Depth > 1)
            {
                tracing.Trace($"Skipping - depth {context.Depth} > 1 to avoid recursion.");
                return;
            }

            var target = GetTarget(context);

            // Fire only if LOA's TDP actually changed (Filtering Attr ensures this, but double-check)
            if (!target.Attributes.Contains(FundingLineAttributes.TDP))
            {
                tracing.Trace("Skipping - LOA TDP not in Target; no recalculation needed.");
                return;
            }

            // Recalculate LOA TDP Remaining using current LOA TDP minus allocated Requirement Funding TDPs
            try
            {
                TDPCalculationHelper.RecalculateLOATDP(service, context.PrimaryEntityId, tracing);
                tracing.Trace("LOA TDP Remaining recalculated (negative allowed).");
            }
            catch (InvalidPluginExecutionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                tracing.Trace($"Unhandled exception in {GetType().Name}: {ex}");
                throw new InvalidPluginExecutionException(
                    $"An error occurred in {GetType().Name}: {ex.Message}", ex);
            }
        }
    }
}
