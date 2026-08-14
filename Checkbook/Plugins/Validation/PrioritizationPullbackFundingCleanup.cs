using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// FY27 companion to <see cref="PrioritizationFundingApprovalGuard"/>'s
    /// pull-back strip. When a Prioritization is recalled out of NPM Review, its
    /// FY27 funding lives on <c>book_prioritizationfunding</c> junction rows —
    /// zeroing the rolled-up <c>book_newfundedamounttdp</c> (which the Pre-Op
    /// guard does) would just be restored by the next junction roll-up. This
    /// Post-Op step deactivates the Prioritization's active junction rows so the
    /// funding is truly returned to the parent RF(s): the junction statecode
    /// change fires <c>PrioritizationFundingRollup</c>, which recomputes both the
    /// Prio and RF funded totals.
    ///
    /// FY26 Prios have no junction rows, so this is a no-op for them (the Pre-Op
    /// field-zero already handled them). Keys on the pre-image status, so
    /// FC/State-Review rejections (never funded) are ignored.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update | Entity: book_prioritization | Post-Operation | Sync
    ///       Filtering attributes: book_approvalstatus
    ///       Pre-Image "PreImage": book_approvalstatus
    /// </summary>
    public class PrioritizationPullbackFundingCleanup : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization) return;
            if (context.MessageName != "Update") return;

            var target = GetTarget(context);
            if (!target.Contains(PrioritizationAttributes.ApprovalStatus)) return;

            var preImage = TryGetPreImage(context);
            if (preImage == null)
            {
                tracing.Trace("Pull-back cleanup: pre-image missing — skipping.");
                return;
            }

            int? oldStatus = preImage
                .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.ApprovalStatus)?.Value;
            int? newStatus = target
                .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.ApprovalStatus)?.Value;

            // Only a move OUT of NPM Review is a pull-back.
            if (oldStatus != ApprovalStatusValues.FinalApproved) return;
            if (newStatus == ApprovalStatusValues.FinalApproved) return;

            var query = new QueryExpression(EntityNames.PrioritizationFunding)
            {
                ColumnSet = new ColumnSet(PrioritizationFundingAttributes.Id),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression(
                            PrioritizationFundingAttributes.Prioritization,
                            ConditionOperator.Equal, context.PrimaryEntityId),
                        new ConditionExpression(
                            PrioritizationFundingAttributes.StateCode,
                            ConditionOperator.Equal, StateCodeValues.Active),
                    }
                }
            };

            var rows = service.RetrieveMultiple(query).Entities;
            if (rows.Count == 0)
            {
                tracing.Trace("Pull-back cleanup: no active junction rows (FY26 Prio or already clear).");
                return;
            }

            tracing.Trace(
                $"Pull-back cleanup: deactivating {rows.Count} junction funding row(s) for " +
                $"Prio {context.PrimaryEntityId} — funding returns to parent RF via roll-up.");

            foreach (var row in rows)
            {
                var deactivate = new Entity(EntityNames.PrioritizationFunding, row.Id)
                {
                    [PrioritizationFundingAttributes.StateCode] =
                        new OptionSetValue(StateCodeValues.Inactive),
                    [PrioritizationFundingAttributes.StatusCode] =
                        new OptionSetValue(StatusCodeValues.InactiveDefault),
                };
                service.Update(deactivate);
            }
        }
    }
}
