using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Helpers;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Recalculations
{
    /// <summary>
    /// Post-Operation updater that recalculates LOA TDP Remaining
    /// whenever Requirement Funding TDP or LOA changes (and on create/delete).
    /// </summary>
    public class RequirementFundingTDPRemainingUpdater : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            // Only act on the correct entity
            if (context.PrimaryEntityName != EntityNames.RequirementFunding)
            {
                tracing.Trace($"Skipping - not a {EntityNames.RequirementFunding} record.");
                return;
            }

            // Only handle Create, Update, Delete in Post-Operation
            if (context.Stage != 40 || (context.MessageName != "Create" &&
                                        context.MessageName != "Update" &&
                                        context.MessageName != "Delete"))
            {
                tracing.Trace($"Skipping - Stage {context.Stage}, Message {context.MessageName} not handled.");
                return;
            }

            // Avoid infinite loops: if our own update to LOA triggers this step somehow, guard by depth
            if (context.Depth > 1)
            {
                tracing.Trace($"Skipping - depth {context.Depth} > 1 to avoid recursion.");
                return;
            }

            Guid? loaId = null;

            try
            {
                if (context.MessageName == "Delete")
                {
                    // For delete, the Target is an EntityReference; retrieve the deleted record via Pre-Image
                    // Ensure your Delete step has a Pre-Image with LineOfAccounting
                    var preImage = TryGetPreImage(context);
                    if (preImage != null)
                    {
                        var refLoa = preImage.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
                        loaId = refLoa?.Id;
                        tracing.Trace($"Delete: LOA from pre-image: {loaId}");
                    }
                }
                else // Create or Update
                {
                    // Prefer Target LOA if present
                    var target = GetTarget(context);
                    var targetLoa = target.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
                    if (targetLoa != null)
                    {
                        loaId = targetLoa.Id;
                        tracing.Trace($"Target LOA: {loaId}");
                    }
                    else
                    {
                        // Fallback: read current record to get LOA from DB
                        var cols = new ColumnSet(RequirementFundingAttributes.LineOfAccounting);
                        var current = service.Retrieve(EntityNames.RequirementFunding, context.PrimaryEntityId, cols);
                        var currentLoa = current.GetAttributeValue<EntityReference>(RequirementFundingAttributes.LineOfAccounting);
                        loaId = currentLoa?.Id;
                        tracing.Trace($"Fallback LOA from DB: {loaId}");
                    }
                }

                if (!loaId.HasValue)
                {
                    tracing.Trace("No LOA found; nothing to recalculate.");
                    return;
                }

                // Recalculate LOA Remaining (decimal implementation in your helper)
                TDPCalculationHelper.RecalculateLOATDP(service, loaId.Value, tracing);

                tracing.Trace("LOA TDP Remaining recalculated successfully.");
            }
            catch (InvalidPluginExecutionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                tracing.Trace($"Updater unhandled exception: {ex}");
                throw new InvalidPluginExecutionException(
                    $"An error occurred in {GetType().Name}: {ex.Message}", ex);
            }
        }
    }
}