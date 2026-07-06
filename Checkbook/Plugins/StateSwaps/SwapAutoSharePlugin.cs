using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.StateSwaps.Helpers;

namespace Checkbook.Plugins.StateSwaps
{
    /// <summary>
    /// Post-operation plugin on book_stateswap Create + Update. Auto-shares the
    /// swap with the two owner-teams (State Approver + State Administrator) for
    /// each of State A and State B, so users in both states can view / edit the
    /// record without needing BU- or Organization-scope Read privileges. Item
    /// sharing follows automatically via the 1:N relationship's Share=Cascade All.
    ///
    /// Create: grants access for the current StateA + StateB.
    /// Update: on a StateA or StateB change, revokes the old state's teams and
    ///         grants the new state's teams. Other-attribute updates are ignored.
    ///
    /// Register PreImage 'PreImage' on the Update step so old StateA / StateB
    /// values are available when either lookup changes.
    /// </summary>
    public class SwapAutoSharePlugin : PluginBase
    {
        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.StateSwap) return;

            var swapRef = new EntityReference(EntityNames.StateSwap, context.PrimaryEntityId);

            switch (context.MessageName)
            {
                case "Create":
                {
                    var target = GetTarget(context);
                    var stateA = target.GetAttributeValue<EntityReference>(
                        StateSwapAttributes.StateA);
                    var stateB = target.GetAttributeValue<EntityReference>(
                        StateSwapAttributes.StateB);

                    SwapTeamShareHelper.GrantAccessForState(service, tracing, swapRef, stateA);
                    SwapTeamShareHelper.GrantAccessForState(service, tracing, swapRef, stateB);
                    break;
                }

                case "Update":
                {
                    var target = GetTarget(context);
                    var preImage = TryGetPreImage(context);

                    if (target.Contains(StateSwapAttributes.StateA))
                    {
                        var newStateA = target.GetAttributeValue<EntityReference>(
                            StateSwapAttributes.StateA);
                        var oldStateA = preImage?.GetAttributeValue<EntityReference>(
                            StateSwapAttributes.StateA);

                        if (!SameRef(newStateA, oldStateA))
                        {
                            SwapTeamShareHelper.RevokeAccessForState(
                                service, tracing, swapRef, oldStateA);
                            SwapTeamShareHelper.GrantAccessForState(
                                service, tracing, swapRef, newStateA);
                        }
                    }

                    if (target.Contains(StateSwapAttributes.StateB))
                    {
                        var newStateB = target.GetAttributeValue<EntityReference>(
                            StateSwapAttributes.StateB);
                        var oldStateB = preImage?.GetAttributeValue<EntityReference>(
                            StateSwapAttributes.StateB);

                        if (!SameRef(newStateB, oldStateB))
                        {
                            SwapTeamShareHelper.RevokeAccessForState(
                                service, tracing, swapRef, oldStateB);
                            SwapTeamShareHelper.GrantAccessForState(
                                service, tracing, swapRef, newStateB);
                        }
                    }
                    break;
                }

                default:
                    tracing.Trace($"SwapAutoSharePlugin: message {context.MessageName} not handled.");
                    return;
            }
        }

        private static bool SameRef(EntityReference a, EntityReference b)
        {
            if (a == null && b == null) return true;
            if (a == null || b == null) return false;
            return a.Id == b.Id;
        }
    }
}
