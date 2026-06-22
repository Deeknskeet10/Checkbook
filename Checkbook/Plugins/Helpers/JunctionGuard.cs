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
        /// Throws when the sum of FundedAmount across active junction rows on
        /// the given RF — with this Create/Update applied — would exceed
        /// <paramref name="rfTDP"/>. On Update the aggregate includes the
        /// pre-image's old funded value, so callers pass <paramref name="oldFunded"/>
        /// to swap old → new; on Create the aggregate doesn't include self yet.
        /// </summary>
        public static void EnforceTDPCap(
            IOrganizationService service,
            ITracingService tracing,
            string junctionEntity,
            string stateCodeAttribute,
            string rfFkAttribute,
            string fundedAttribute,
            Guid rfId,
            decimal rfTDP,
            decimal newFunded,
            decimal oldFunded,
            IPluginExecutionContext context)
        {
            tracing.Trace($"RF TDP = {rfTDP}");

            var fetch = $@"
                <fetch aggregate='true'>
                    <entity name='{junctionEntity}'>
                        <attribute name='{fundedAttribute}' alias='total_funded' aggregate='sum'/>
                        <filter type='and'>
                            <condition attribute='{stateCodeAttribute}' operator='eq' value='{StateCodeValues.Active}'/>
                            <condition attribute='{rfFkAttribute}' operator='eq' value='{rfId}'/>
                        </filter>
                    </entity>
                </fetch>";

            var result = service.RetrieveMultiple(new FetchExpression(fetch));
            decimal siblingSum = 0m;
            if (result.Entities.Count > 0)
            {
                var aliased = result.Entities[0].GetAttributeValue<AliasedValue>("total_funded");
                if (aliased != null) siblingSum = Convert.ToDecimal(aliased.Value);
            }

            var proposedTotal = context.MessageName == "Create"
                ? siblingSum + newFunded
                : siblingSum - oldFunded + newFunded;

            tracing.Trace(
                $"Sibling sum={siblingSum}, oldFunded={oldFunded}, newFunded={newFunded}, " +
                $"proposed={proposedTotal}");

            if (proposedTotal > rfTDP)
            {
                throw new InvalidPluginExecutionException(
                    $"This change would exceed the Requirement Funding's TDP cap. " +
                    $"RF TDP = {rfTDP:N2}, Proposed junction total = {proposedTotal:N2}.");
            }

            tracing.Trace("TDP cap check passed.");
        }
    }
}
