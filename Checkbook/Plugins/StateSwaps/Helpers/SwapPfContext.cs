using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.StateSwaps.Helpers
{
    /// <summary>
    /// Everything an FY27 swap needs to know about one Prioritization Funding leg end:
    /// the junction, its Prioritization (state, approval, mode, Fund Center) and its RF's
    /// LOA (Fund / PG). Loaded in one FetchXml round-trip by <see cref="Load"/>.
    /// See docs/StateSwap-FY27-Redesign.md §2–§3.
    /// </summary>
    public sealed class SwapPfContext
    {
        public Guid PfId;
        public string Name;
        public decimal Funded;
        public bool Active;

        public EntityReference Prioritization;
        public EntityReference State;
        public int? ApprovalStatus;
        public bool PrioActive;
        public bool PrioItemized;
        public EntityReference FundCenter;

        public EntityReference RequirementFunding;
        public EntityReference LOA;
        public EntityReference Fund;
        public EntityReference PG;

        public string Label => Name ?? PfId.ToString();

        /// <summary>
        /// Why this PF can't be a swap leg end, or null when it can. Both sides of every
        /// leg must be an active, funded PF on an active Prioritization in NPM Review
        /// (FinalApproved) — RF.Funded only counts junctions on FinalApproved Prios, so
        /// anything else would leak out of the RF roll-up (decision 7).
        /// </summary>
        public string UnusableReason()
        {
            if (!Active) return $"Prioritization Funding {Label} is inactive";
            if (Funded <= 0m) return $"Prioritization Funding {Label} has no funding";
            if (Prioritization == null) return $"Prioritization Funding {Label} has no Prioritization";
            if (!PrioActive) return $"the Prioritization on {Label} is inactive";
            if (ApprovalStatus != ApprovalStatusValues.FinalApproved)
                return $"the Prioritization on {Label} is not in NPM Review";
            if (State == null) return $"the Prioritization on {Label} has no State";
            if (RequirementFunding == null || LOA == null)
                return $"Prioritization Funding {Label} does not resolve to a Requirement Funding with an LOA";
            if (Fund == null || PG == null) return $"the LOA behind {Label} has no Fund or PG";
            return null;
        }

        public static Dictionary<Guid, SwapPfContext> Load(IOrganizationService service, IEnumerable<Guid> pfIds)
        {
            var ids = pfIds.Distinct().ToList();
            var result = new Dictionary<Guid, SwapPfContext>();
            if (ids.Count == 0) return result;

            var values = string.Concat(ids.Select(g => $"<value>{g}</value>"));
            var fetch = $@"
                <fetch>
                    <entity name='{EntityNames.PrioritizationFunding}'>
                        <attribute name='{PrioritizationFundingAttributes.Id}'/>
                        <attribute name='{PrioritizationFundingAttributes.Name}'/>
                        <attribute name='{PrioritizationFundingAttributes.FundedAmount}'/>
                        <attribute name='{PrioritizationFundingAttributes.StateCode}'/>
                        <attribute name='{PrioritizationFundingAttributes.Prioritization}'/>
                        <attribute name='{PrioritizationFundingAttributes.RequirementFunding}'/>
                        <filter>
                            <condition attribute='{PrioritizationFundingAttributes.Id}' operator='in'>{values}</condition>
                        </filter>
                        <link-entity name='{EntityNames.Prioritization}' from='{PrioritizationAttributes.Id}'
                                     to='{PrioritizationFundingAttributes.Prioritization}' link-type='outer' alias='p'>
                            <attribute name='{PrioritizationAttributes.State}'/>
                            <attribute name='{PrioritizationAttributes.ApprovalStatus}'/>
                            <attribute name='{PrioritizationAttributes.StateCode}'/>
                            <attribute name='{PrioritizationAttributes.FundingMode}'/>
                            <attribute name='{PrioritizationAttributes.FundCenter}'/>
                        </link-entity>
                        <link-entity name='{EntityNames.RequirementFunding}' from='{RequirementFundingAttributes.Id}'
                                     to='{PrioritizationFundingAttributes.RequirementFunding}' link-type='outer' alias='rf'>
                            <attribute name='{RequirementFundingAttributes.LineOfAccounting}'/>
                            <link-entity name='{EntityNames.FundingLine}' from='{FundingLineAttributes.Id}'
                                         to='{RequirementFundingAttributes.LineOfAccounting}' link-type='outer' alias='loa'>
                                <attribute name='{FundingLineAttributes.Fund}'/>
                                <attribute name='{FundingLineAttributes.PG}'/>
                            </link-entity>
                        </link-entity>
                    </entity>
                </fetch>";

            foreach (var row in service.RetrieveMultiple(new FetchExpression(fetch)).Entities)
            {
                result[row.Id] = new SwapPfContext
                {
                    PfId = row.Id,
                    Name = row.GetAttributeValue<string>(PrioritizationFundingAttributes.Name),
                    Funded = row.GetAttributeValue<decimal?>(PrioritizationFundingAttributes.FundedAmount) ?? 0m,
                    Active = row.GetAttributeValue<OptionSetValue>(PrioritizationFundingAttributes.StateCode)?.Value
                             == StateCodeValues.Active,
                    Prioritization = row.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.Prioritization),
                    State = AliasedValueHelper.GetReference(row, "p." + PrioritizationAttributes.State),
                    ApprovalStatus = Option(row, "p." + PrioritizationAttributes.ApprovalStatus),
                    PrioActive = Option(row, "p." + PrioritizationAttributes.StateCode) == StateCodeValues.Active,
                    PrioItemized = Option(row, "p." + PrioritizationAttributes.FundingMode) == FundingModeValues.Itemized,
                    FundCenter = AliasedValueHelper.GetReference(row, "p." + PrioritizationAttributes.FundCenter),
                    RequirementFunding = row.GetAttributeValue<EntityReference>(PrioritizationFundingAttributes.RequirementFunding),
                    LOA = AliasedValueHelper.GetReference(row, "rf." + RequirementFundingAttributes.LineOfAccounting),
                    Fund = AliasedValueHelper.GetReference(row, "loa." + FundingLineAttributes.Fund),
                    PG = AliasedValueHelper.GetReference(row, "loa." + FundingLineAttributes.PG),
                };
            }
            return result;
        }

        private static int? Option(Entity row, string alias)
            => row.Contains(alias) ? AliasedValueHelper.GetInt(row, alias) : (int?)null;
    }
}
