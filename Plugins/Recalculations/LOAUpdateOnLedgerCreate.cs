using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Recalculations
{
    public class LedgerCreateFundingLineUpdater : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Ledger ||
                context.MessageName != "Create" ||
                context.Stage != 40)
            {
                return;
            }

            // Prevent recursion
            if (context.Depth > 1)
                return;

            var ledger = GetTarget(context);

            if (!ledger.Contains(LedgerAttributes.LineOfAccounting))
            {
                tracing.Trace("Ledger has no Funding Line reference.");
                return;
            }

            var fundingLineId = ledger.GetAttributeValue<EntityReference>(
                LedgerAttributes.LineOfAccounting).Id;

            TDPCalculationHelper.RecalculateLOATDP(service, fundingLineId, tracing);
            tracing.Trace("LOA TDP recalculated due to new Ledger creation.");
        }
    }
}