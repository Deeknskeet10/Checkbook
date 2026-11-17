using System;
using System.Globalization;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Realignments
{
    /// <summary>
    /// Pre-operation plugin on book_realignments Create. Stamps book_name when the
    /// caller did not supply one, so the Name field can stay hidden on the entry
    /// form (and Name can be relaxed from app-required to none) without blocking
    /// the initial save that the RealignmentBuilder PCF depends on.
    ///
    /// Format: "FY{fy}-Realignment-{yyyyMMdd-HHmmss}" (UTC), or
    /// "Realignment-{yyyyMMdd-HHmmss}" when no fiscal year is on the Target.
    /// The FY comes from the editable book_newfiscalyear picklist (the existing
    /// book_fiscalyear is a formula column and is never present on a Create Target).
    ///
    /// A user-supplied Name is never overwritten. Name is not part of the
    /// book_uniqueRealignments alternate key, so the timestamp is for readability
    /// only, not uniqueness.
    ///
    /// Register: PreOperation, Sync, book_realignments, Create. No filtering
    /// attributes, no images. Rank: any (reads only the Target).
    /// </summary>
    public class RealignmentNameSetter : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Realignments) return;
            if (context.MessageName != "Create") return;
            if (context.Stage != 20) return; // PreOperation only

            var target = GetTarget(context);

            if (!string.IsNullOrWhiteSpace(target.GetAttributeValue<string>(RealignmentsAttributes.Name)))
            {
                tracing.Trace("RealignmentNameSetter: Name supplied by caller; leaving as-is.");
                return;
            }

            var fy = target.GetAttributeValue<OptionSetValue>(RealignmentsAttributes.NewFiscalYear);
            var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);

            var name = fy != null
                ? "FY" + fy.Value.ToString(CultureInfo.InvariantCulture) + "-Realignment-" + stamp
                : "Realignment-" + stamp;

            target[RealignmentsAttributes.Name] = name;
            tracing.Trace($"RealignmentNameSetter: set book_name = '{name}'.");
        }
    }
}
