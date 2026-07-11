using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.LOAs.Helpers;

namespace Checkbook.Plugins.Funds
{
    /// <summary>
    /// Pre-Operation Create + Update plugin on <c>book_fund</c>. Owns
    /// <c>book_fundkey</c> composition, replacing the retired
    /// <c>Fund-CreateKey</c> XAML workflow.
    ///
    /// The key exists purely for readability: Fund names repeat across
    /// BOC/DollarType (FY26) or Funded Program (FY27+) combinations, so
    /// lookups showing only <c>book_name</c> are ambiguous without it.
    ///
    /// Format (fiscal year parsed from the fund name's trailing 2 digits,
    /// same convention as <see cref="LOANameBuilder"/>):
    ///   • FY &lt;= <see cref="LOANameBuilder.LegacyGrainLastFy"/> (FY26):
    ///       <c>{Name}-{BOC}-{DollarType}</c> — matches the XAML output.
    ///   • FY27+: <c>{Name}-{FundedProgram}</c>
    ///
    /// If the fiscal year cannot be parsed or the era's required lookups are
    /// missing, the key is left unchanged (traced, never blocking the write).
    ///
    /// Update step must register a PreImage named "PreImage" containing
    /// <c>book_name</c>, <c>book_boc</c>, <c>book_dollartypefundedprogram</c>
    /// and <c>book_newfundedprogram</c>.
    /// </summary>
    public class FundKeySetter : PluginBase
    {
        private static readonly string[] KeyFields = new[]
        {
            FundAttributes.Name,
            FundAttributes.BOC,
            FundAttributes.DollarType,
            FundAttributes.FundedProgram,
        };

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Fund ||
                context.Stage != 20 || // PreOperation
                (context.MessageName != "Create" && context.MessageName != "Update"))
            {
                tracing.Trace($"Skipping — Entity={context.PrimaryEntityName}, " +
                              $"Message={context.MessageName}, Stage={context.Stage}.");
                return;
            }

            var target = GetTarget(context);
            var isUpdate = context.MessageName == "Update";

            Entity preImage = null;
            if (isUpdate)
            {
                preImage = TryGetPreImage(context);
                if (preImage == null)
                {
                    tracing.Trace("Update with no PreImage registered; cannot diff key fields. Skipping.");
                    return;
                }
                if (!HasAnyAttributeChanged(target, KeyFields))
                {
                    tracing.Trace("No key field changed; nothing to do.");
                    return;
                }
            }

            var effective = isUpdate ? GetMergedEntity(target, preImage) : target;

            var fundName = effective.GetAttributeValue<string>(FundAttributes.Name);
            if (string.IsNullOrWhiteSpace(fundName))
            {
                tracing.Trace("Fund name is empty; leaving fund key unchanged.");
                return;
            }

            int fy;
            try
            {
                fy = LOANameBuilder.ParseFiscalYear(fundName);
            }
            catch (System.ArgumentException ex)
            {
                tracing.Trace($"Cannot parse fiscal year from '{fundName}': {ex.Message}. " +
                              "Leaving fund key unchanged.");
                return;
            }

            string fundKey;
            if (fy <= LOANameBuilder.LegacyGrainLastFy)
            {
                var bocName = ResolveName(service, effective.GetAttributeValue<EntityReference>(FundAttributes.BOC));
                var dtName  = ResolveName(service, effective.GetAttributeValue<EntityReference>(FundAttributes.DollarType));
                if (string.IsNullOrWhiteSpace(bocName) || string.IsNullOrWhiteSpace(dtName))
                {
                    tracing.Trace($"FY{fy}: BOC or DollarType missing; leaving fund key unchanged.");
                    return;
                }
                fundKey = $"{fundName}-{bocName}-{dtName}";
            }
            else
            {
                var fpName = ResolveName(service, effective.GetAttributeValue<EntityReference>(FundAttributes.FundedProgram));
                if (string.IsNullOrWhiteSpace(fpName))
                {
                    tracing.Trace($"FY{fy}: Funded Program missing; leaving fund key unchanged.");
                    return;
                }
                fundKey = $"{fundName}-{fpName}";
            }

            target[FundAttributes.FundKey] = fundKey;
            tracing.Trace($"Fund key set to '{fundKey}' (FY{fy}).");
        }

        private static string ResolveName(IOrganizationService service, EntityReference reference)
        {
            if (reference == null) return null;
            if (!string.IsNullOrWhiteSpace(reference.Name)) return reference.Name;
            var record = service.Retrieve(reference.LogicalName, reference.Id, new ColumnSet("book_name"));
            return record.GetAttributeValue<string>("book_name");
        }
    }
}
