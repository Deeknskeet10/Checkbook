using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Validation
{
    /// <summary>
    /// Pre-Operation guard that blocks direct edits to
    /// <c>book_prioritization.book_newfundedamounttdp</c> (Funded Amount (TDP))
    /// when the admin toggle <c>book_LockManualFundedEdits</c> is on.
    ///
    /// The Funded Amount is meant to flow only through the authorized tools:
    /// Turn-Ins, Realignments, State Swaps, and the Distribution generator.
    /// This plugin detects "am I inside one of those?" by walking
    /// <see cref="IPluginExecutionContext.ParentContext"/> — the same pattern
    /// <see cref="RequirementFundingTDPValidator"/> uses (see
    /// <c>IsTriggeredByRealignment</c> there). SharedVariables is deliberately
    /// avoided; see the note at the top of <c>RealignmentProcessor</c> for why.
    ///
    /// Registration intent (Plugin Registration Tool — no manifest in repo):
    ///   • Message: Update    | Entity: book_prioritization
    ///   • Stage:   PreOperation (20) | Mode: Sync | Rank: 10 (run first)
    ///   • Filtering attributes: book_newfundedamounttdp
    ///   • Pre-Image "PreImage" — columns: book_newfundedamounttdp
    /// </summary>
    public class PrioritizationFundedAmountLock : PluginBase
    {
        private const string LockEnvVar = "book_LockManualFundedEdits";
        private const string BlockedMessage =
            "Funded Amount (TDP) can only be changed through Turn-Ins, Realignments, " +
            "State Swaps, or the Distribution generator. Direct edits are locked. " +
            "A Checkbook Administrator can unlock this temporarily from the Admin Center.";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.Prioritization) return;
            if (context.MessageName != "Update") return;

            var target = GetTarget(context);
            if (!target.Contains(PrioritizationAttributes.FundedAmountTDP)) return;

            // Ancestor-walk first — cheap and covers the "authorized tool" path
            // without needing to read the env var at all when the answer is
            // already yes. (Same order matters if the toggle is off: we still
            // want the trace to record whether the write was authorized.)
            if (IsInsideAuthorizedOperation(context, tracing))
            {
                tracing.Trace("FundedAmountLock: authorized ancestor found — allow.");
                return;
            }

            // No-op writes: form save-all often ships the field in Target even
            // when the user didn't touch it. Comparing to the pre-image avoids
            // false rejections in that case.
            var preImage = TryGetPreImage(context);
            if (preImage != null && !ValueChanged(target, preImage))
            {
                tracing.Trace("FundedAmountLock: value unchanged — allow.");
                return;
            }

            if (!EnvironmentVariableHelper.GetBool(service, LockEnvVar))
            {
                tracing.Trace("FundedAmountLock: toggle is OFF — allow.");
                return;
            }

            tracing.Trace(
                $"FundedAmountLock: blocking direct write by user {context.InitiatingUserId} " +
                $"on prioritization {context.PrimaryEntityId}.");
            throw new InvalidPluginExecutionException(BlockedMessage);
        }

        private static bool IsInsideAuthorizedOperation(
            IPluginExecutionContext ctx, ITracingService tracing)
        {
            while (ctx != null)
            {
                var msg = ctx.MessageName;
                var name = ctx.PrimaryEntityName;

                if (msg == "Update" && (
                        name == EntityNames.Turnin ||
                        name == EntityNames.Realignments ||
                        name == EntityNames.StateSwap))
                {
                    tracing?.Trace(
                        $"FundedAmountLock: ancestor authorized — Update on {name}.");
                    return true;
                }

                // book_GenerateDistributions is a bound-none Custom API; the
                // MessageName on its context matches the API's unique name.
                if (msg == "book_GenerateDistributions")
                {
                    tracing?.Trace(
                        "FundedAmountLock: ancestor authorized — book_GenerateDistributions.");
                    return true;
                }

                ctx = ctx.ParentContext;
            }

            return false;
        }

        private static bool ValueChanged(Entity target, Entity preImage)
        {
            var attr = PrioritizationAttributes.FundedAmountTDP;
            if (!target.Contains(attr)) return false;

            var newVal = target[attr];
            var oldVal = preImage.Contains(attr) ? preImage[attr] : null;

            // Money / decimal / null equivalence is covered by Equals for these
            // types when the platform hands them back to us the same way.
            return !object.Equals(newVal, oldVal);
        }
    }
}
