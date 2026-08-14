using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Enforces the invariant "a Prioritization may only HOLD funding while it is
    /// in NPM Review (ApprovalStatus == 4)". Two concerns, one Pre-Operation step:
    ///
    ///   1. Block funding a not-yet-approved Prio — reject any *increase* to
    ///      book_newfundedamounttdp when the effective ApprovalStatus != NPM
    ///      Review. Covers the NPM funding grid (FY26 direct write) and, as a
    ///      backstop, the FY27 junction roll-up and any manual / Web API edit.
    ///
    ///   2. Strip funding on pull-back — when a State recalls a Prio out of NPM
    ///      Review (pre-image status == 4, new status != 4) while it still holds
    ///      funding, zero book_newfundedamounttdp in the same Update. The money
    ///      returns to the parent RF via the Post-Op
    ///      PrioritizationRollupToRequirementFunding recalc. A client modal in
    ///      book_checkbookButtons warns the user first; this plugin is the
    ///      guaranteed enforcement, so the invariant holds even when the
    ///      pull-back arrives via bulk edit / Web API / any path that skips it.
    ///
    /// Why funded ⟹ status 4 matters: RF.FundedAmount rolls up only
    /// FinalApproved (status 4) child Prios (PrioritizationRollupHelper), while
    /// RF.TDP is not approval-filtered. A Prio holding funding below status 4 is
    /// therefore invisible to the roll-up and surfaces as a phantom TDP−Funded
    /// gap on the parent RF (see the realignment-rollup-approval-filter-gap
    /// investigation).
    ///
    /// FY27 note: when funding lives on book_prioritizationfunding junction rows,
    /// zeroing the rolled-up field alone is not sufficient — the next junction
    /// roll-up would restore it. FY27 pull-backs must also clear the junction
    /// rows, and the junction-side funding gate belongs in
    /// PrioritizationFundingGuard. This guard remains the universal backstop.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Create | Entity: book_prioritization | Pre-Operation (20) | Sync
    ///   • Message: Update | Entity: book_prioritization | Pre-Operation (20) | Sync
    ///       Filtering attributes: book_newfundedamounttdp, book_approvalstatus
    ///       Pre-Image "PreImage": book_newfundedamounttdp, book_approvalstatus
    /// </summary>
    public class PrioritizationFundingApprovalGuard : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization)
            {
                tracing.Trace("Skipping — not a Prioritization.");
                return;
            }

            if (context.MessageName != "Create" && context.MessageName != "Update")
            {
                tracing.Trace($"Skipping — message {context.MessageName} not supported.");
                return;
            }

            var target = GetTarget(context);
            var preImage = context.MessageName == "Update" ? TryGetPreImage(context) : null;

            // Concern 2 first: the funding it removes on a pull-back must not
            // then be read as an "increase" by the concern-1 check below.
            if (context.MessageName == "Update")
                StripFundingOnPullBack(target, preImage, tracing);

            // Concern 1: block an increase to funding while below NPM Review.
            BlockFundingBelowNpmReview(context, target, preImage, tracing);
        }

        /// <summary>
        /// When a Prioritization leaves NPM Review (State pull-back / recall) while
        /// still funded, fold a funded-to-zero write into this same Update so the
        /// invariant holds and the parent RF is recalculated by the Post-Op roll-up.
        /// </summary>
        private void StripFundingOnPullBack(Entity target, Entity preImage, ITracingService tracing)
        {
            // A status change is what defines a pull-back; nothing to do otherwise.
            if (!target.Contains(PrioritizationAttributes.ApprovalStatus))
                return;

            if (preImage == null)
            {
                tracing.Trace("Pull-back strip: pre-image missing — cannot confirm prior status; skipping.");
                return;
            }

            int? oldStatus = preImage
                .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.ApprovalStatus)?.Value;
            int? newStatus = target
                .GetAttributeValue<OptionSetValue>(PrioritizationAttributes.ApprovalStatus)?.Value;

            // Only act on a move OUT of NPM Review. Rejections from FC/State Review
            // (status 1/2 → 0) never had funding and must not be touched.
            if (oldStatus != ApprovalStatusValues.FinalApproved)
                return;
            if (newStatus == ApprovalStatusValues.FinalApproved)
                return;

            decimal currentFunded = GetEffectiveDecimal(
                target, preImage, PrioritizationAttributes.FundedAmountTDP);
            if (currentFunded <= 0m)
            {
                tracing.Trace("Pull-back out of NPM Review with no funding — nothing to strip.");
                return;
            }

            tracing.Trace(
                $"Pull-back out of NPM Review with funding {currentFunded:C} — stripping to 0 " +
                "(returns to parent RF via roll-up).");

            target[PrioritizationAttributes.FundedAmountTDP] = 0m;
        }

        /// <summary>
        /// Reject any increase to a Prioritization's funded amount unless the
        /// Prioritization is (or is being set) in NPM Review. Reductions — manual
        /// defunding and the pull-back strip above — are always allowed.
        /// </summary>
        private void BlockFundingBelowNpmReview(
            IPluginExecutionContext context, Entity target, Entity preImage, ITracingService tracing)
        {
            if (!target.Contains(PrioritizationAttributes.FundedAmountTDP))
                return;

            decimal newFunded = NumericHelper.ToDecimal(
                target[PrioritizationAttributes.FundedAmountTDP], 0m);

            decimal oldFunded = preImage != null && preImage.Contains(PrioritizationAttributes.FundedAmountTDP)
                ? NumericHelper.ToDecimal(preImage[PrioritizationAttributes.FundedAmountTDP], 0m)
                : 0m;

            if (newFunded <= oldFunded)
                return; // no increase → not a funding action

            int? status = GetEffectiveOptionSetValue(
                target, preImage, PrioritizationAttributes.ApprovalStatus)?.Value;

            if (status == ApprovalStatusValues.FinalApproved)
                return;

            tracing.Trace(
                $"Blocking funding increase {oldFunded:C} -> {newFunded:C} on Prioritization " +
                $"{context.PrimaryEntityId} at ApprovalStatus {(status?.ToString() ?? "null")} " +
                "(NPM Review required).");

            throw new InvalidPluginExecutionException(ValidationMessages.FundingRequiresNPMReview);
        }
    }
}
