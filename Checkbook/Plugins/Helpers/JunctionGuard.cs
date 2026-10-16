using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Shared pre-op guards for funding-junction entities
    /// (book_prioritizationfunding and book_requirementdetailfunding).
    /// Both junctions enforce identical (RF, child) uniqueness and an
    /// identical RF.TDP cap on sum of active junction FundedAmount;
    /// only the entity / attribute names differ. These helpers parameterize
    /// the shared logic to keep the two Guard plugins thin.
    /// </summary>
    public static class JunctionGuard
    {
        /// <summary>
        /// Throws when an active junction row already exists with the same
        /// <paramref name="leftAttribute"/> / <paramref name="rightAttribute"/>
        /// pair (excluding the current record on Update).
        /// </summary>
        public static void EnsureUniquePair(
            IOrganizationService service,
            ITracingService tracing,
            string junctionEntity,
            string idAttribute,
            string stateCodeAttribute,
            string leftAttribute, Guid leftId,
            string rightAttribute, Guid rightId,
            IPluginExecutionContext context,
            string conflictMessage)
        {
            var selfExclude = context.MessageName == "Update"
                ? $"<condition attribute='{idAttribute}' operator='ne' value='{context.PrimaryEntityId}'/>"
                : string.Empty;

            var fetch = $@"
                <fetch top='1'>
                    <entity name='{junctionEntity}'>
                        <attribute name='{idAttribute}'/>
                        <filter type='and'>
                            <condition attribute='{stateCodeAttribute}' operator='eq' value='{StateCodeValues.Active}'/>
                            <condition attribute='{leftAttribute}' operator='eq' value='{leftId}'/>
                            <condition attribute='{rightAttribute}' operator='eq' value='{rightId}'/>
                            {selfExclude}
                        </filter>
                    </entity>
                </fetch>";

            var hits = service.RetrieveMultiple(new FetchExpression(fetch));
            if (hits.Entities.Count > 0)
                throw new InvalidPluginExecutionException(conflictMessage);

            tracing.Trace("Pair uniqueness check passed.");
        }

        /// <summary>
        /// True when the Update target deactivates the row. Deactivation can only
        /// lower totals and must never be blocked by uniqueness/cap checks (it is
        /// how duplicates and over-cap rows get cleaned up).
        /// </summary>
        public static bool IsDeactivation(Entity target, string stateCodeAttribute)
        {
            var sc = target.GetAttributeValue<OptionSetValue>(stateCodeAttribute);
            return sc != null && sc.Value != StateCodeValues.Active;
        }

        /// <summary>
        /// What this row contributed to <paramref name="rfId"/>'s active funded total
        /// BEFORE this operation: the pre-image funded amount when the row was
        /// active and already on this RF, otherwise 0 (Create, re-parent from another
        /// RF, or reactivation of an inactive row). A pre-image without statecode is
        /// treated as active.
        /// </summary>
        public static decimal PriorContribution(
            Entity preImage, string rfFkAttribute, Guid rfId,
            string fundedAttribute, string stateCodeAttribute)
        {
            if (preImage == null) return 0m;
            var wasActive = (preImage.GetAttributeValue<OptionSetValue>(stateCodeAttribute)?.Value
                             ?? StateCodeValues.Active) == StateCodeValues.Active;
            var wasOnRf = preImage.GetAttributeValue<EntityReference>(rfFkAttribute)?.Id == rfId;
            return wasActive && wasOnRf
                ? NumericHelper.ToDecimal(preImage, fundedAttribute) ?? 0m
                : 0m;
        }

        /// <summary>
        /// Throws when the sum of FundedAmount across active junction rows on
        /// the given RF — with this Create/Update applied — would exceed
        /// <paramref name="rfTDP"/>. The aggregate excludes this row, so the
        /// proposed total is (other rows) + <paramref name="newFunded"/>.
        /// <paramref name="priorContribution"/> (see <see cref="PriorContribution"/>)
        /// decides whether this is an increase on THIS RF — a re-parent or
        /// reactivation counts its full amount as new.
        /// </summary>
        public static void EnforceTDPCap(
            IOrganizationService service,
            ITracingService tracing,
            string junctionEntity,
            string idAttribute,
            string stateCodeAttribute,
            string rfFkAttribute,
            string fundedAttribute,
            Guid rfId,
            decimal rfTDP,
            decimal newFunded,
            decimal priorContribution,
            IPluginExecutionContext context)
        {
            tracing.Trace($"RF TDP = {rfTDP}");

            var selfExclude = context.MessageName == "Update" && context.PrimaryEntityId != Guid.Empty
                ? $"<condition attribute='{idAttribute}' operator='ne' value='{context.PrimaryEntityId}'/>"
                : string.Empty;

            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{junctionEntity}'>
                        <attribute name='{fundedAttribute}' alias='total_funded' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{stateCodeAttribute}' operator='eq' value='{StateCodeValues.Active}'/>
                            <condition attribute='{rfFkAttribute}' operator='eq' value='{rfId}'/>
                            {selfExclude}
                        </filter>
                    </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));
            var otherSum = result.Entities.Count > 0
                ? AliasedValueHelper.GetDecimal(result.Entities[0], "total_funded")
                : 0m;

            var proposedTotal = otherSum + newFunded;

            tracing.Trace(
                $"Other rows={otherSum}, priorContribution={priorContribution}, newFunded={newFunded}, " +
                $"proposed={proposedTotal}");

            // Only ENFORCE the cap when this row's contribution to THIS RF is
            // INCREASING (a Create, re-parent or reactivation is always an
            // increase from 0). A reduction — or the pull-back deactivation — can never
            // push the RF total further over its TDP cap, so blocking it is
            // never correct and deadlocks legitimate remediation: this guard
            // fires once per junction row, but a grid save that rebalances two
            // or more rows is only valid in aggregate. When the first row is
            // validated the sibling rows still hold their pre-save (higher)
            // values, so proposedTotal reflects only this one row's change. If
            // the RF is already over-cap (e.g. negative Withholding from a
            // Turn-In), no single reduction can bring the per-row proposedTotal
            // back under the cap and every row's save is rejected. Mirrors the
            // increases-only intent of the NPM-Review approval check in the
            // callers, and the same fix in PrioritizationFundingValidator.
            bool isIncrease = newFunded > priorContribution;

            if (isIncrease && proposedTotal > rfTDP)
            {
                throw new InvalidPluginExecutionException(
                    $"This change would exceed the Requirement Funding's TDP cap. " +
                    $"RF TDP = {rfTDP:N2}, Proposed junction total = {proposedTotal:N2}.");
            }

            tracing.Trace(isIncrease
                ? "TDP cap check passed."
                : "Funded amount unchanged or reduced — skipping TDP cap enforcement.");
        }
    }
}
