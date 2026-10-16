using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Base
{
    /// <summary>
    /// Base class for all plugins — handles boilerplate service extraction
    /// and provides a clean Execute override point.
    /// </summary>
    public abstract class PluginBase : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            if (serviceProvider == null)
                throw new ArgumentNullException(nameof(serviceProvider));

            var context = (IPluginExecutionContext)
                serviceProvider.GetService(typeof(IPluginExecutionContext));
            var serviceFactory = (IOrganizationServiceFactory)
                serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var tracingService = (ITracingService)
                serviceProvider.GetService(typeof(ITracingService));

            // Runs as the step's configured execution identity (context.UserId).
            // In this project steps run as an elevated service account, so role /
            // BU checks must use context.InitiatingUserId — the actual user.
            var service = serviceFactory.CreateOrganizationService(context.UserId);

            try
            {
                tracingService.Trace($"{GetType().Name} started. " +
                                     $"Entity: {context.PrimaryEntityName}, " +
                                     $"Message: {context.MessageName}, " +
                                     $"Stage: {context.Stage}");
                ExecutePlugin(context, service, tracingService);
                tracingService.Trace($"{GetType().Name} completed.");
            }
            catch (InvalidPluginExecutionException)
            {
                // Re-throw user-facing errors as-is
                throw;
            }
            catch (Exception ex)
            {
                tracingService.Trace($"Unhandled exception: {ex}");
                throw new InvalidPluginExecutionException(
                    $"An error occurred in {GetType().Name}: {ex.Message}", ex);
            }
        }

        /// <summary>
        /// Override this in concrete plugins.
        /// Throw <see cref="InvalidPluginExecutionException"/> to surface errors to the user.
        /// </summary>
        protected abstract void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracingService);

        /// <summary>Helper: get the Target entity from InputParameters.</summary>
        protected static Entity GetTarget(IPluginExecutionContext context)
        {
            if (context.InputParameters.TryGetValue("Target", out var target) &&
                target is Entity entity)
                return entity;

            throw new InvalidPluginExecutionException(
                "Target entity not found in InputParameters.");
        }

        /// <summary>Helper: get a pre-image by name (throws if missing).</summary>
        protected static Entity GetPreImage(IPluginExecutionContext context, string name = "PreImage")
        {
            if (context.PreEntityImages.TryGetValue(name, out var image))
                return image;

            throw new InvalidPluginExecutionException(
                $"Pre-image '{name}' not found. Ensure it is registered on the step.");
        }

        /// <summary>Helper: try to get a pre-image by name (returns null if missing).</summary>
        protected static Entity TryGetPreImage(IPluginExecutionContext context, string name = "PreImage")
        {
            if (context.PreEntityImages.TryGetValue(name, out var image))
                return image;
            return null;
        }

        /// <summary>Helper: get a post-image by name (throws if missing).</summary>
        protected static Entity GetPostImage(IPluginExecutionContext context, string name = "PostImage")
        {
            if (context.PostEntityImages.TryGetValue(name, out var image))
                return image;

            throw new InvalidPluginExecutionException(
                $"Post-image '{name}' not found. Ensure it is registered on the step.");
        }

        /// <summary>Helper: try to get a post-image by name (returns null if missing).</summary>
        protected static Entity TryGetPostImage(IPluginExecutionContext context, string name = "PostImage")
        {
            if (context.PostEntityImages.TryGetValue(name, out var image))
                return image;
            return null;
        }

        // NOTE: there is deliberately no "is this nested under an Update of the
        // same table?" helper. Such guards silently dropped every approval on
        // book_realignments / book_stateswap / book_turnin (real-time Business
        // Rules nest the user's decision save under a same-table Update) and were
        // removed Aug 2026. Use step filters the plugin's own writes cannot match,
        // plus value+active and ledger-existence idempotency checks.

        /// <summary>
        /// True when, after walking past platform wrapper messages (SetState,
        /// ExecuteMultiple, ExecuteTransaction), any ancestor context remains —
        /// i.e. the operation was issued by server-side automation (another
        /// plugin, a workflow, a Custom API) rather than directly by a user or
        /// a bulk wrapper. Use for "user-initiated only" lifecycle plugins.
        /// Used by DeactivationRoleGuard and SpendPlanEditLockGuard.
        /// </summary>
        protected static bool HasNonWrapperAncestor(IPluginExecutionContext context)
        {
            var ancestor = context.ParentContext;
            while (ancestor != null && IsPlatformWrapper(ancestor.MessageName))
                ancestor = ancestor.ParentContext;
            return ancestor != null;
        }

        /// <summary>
        /// Messages that merely wrap a direct user action — seeing one as a
        /// parent context does NOT mean the operation is automated.
        /// </summary>
        protected static bool IsPlatformWrapper(string messageName)
        {
            return messageName == "SetState" ||
                   messageName == "SetStateDynamicEntity" ||
                   messageName == "ExecuteMultiple" ||
                   messageName == "ExecuteTransaction";
        }

        /// <summary>
        /// Gets an entity with attributes merged from target and pre-image.
        /// Target attributes take precedence over pre-image attributes.
        /// Useful for getting the "effective" state of a record during an Update.
        /// </summary>
        protected static Entity GetMergedEntity(Entity target, Entity preImage)
        {
            if (target == null)
                throw new ArgumentNullException(nameof(target));

            var merged = new Entity(target.LogicalName, target.Id);

            // First, copy all pre-image attributes (if available)
            if (preImage != null)
            {
                foreach (var attr in preImage.Attributes)
                {
                    merged[attr.Key] = attr.Value;
                }
            }

            // Then overlay target attributes (these take precedence)
            foreach (var attr in target.Attributes)
            {
                merged[attr.Key] = attr.Value;
            }

            return merged;
        }

        protected static bool GetEffectiveBool(Entity target, Entity preImage, string attribute)
        {
            if (target != null && target.Contains(attribute))
                return target.GetAttributeValue<bool>(attribute);

            if (preImage != null && preImage.Contains(attribute))
                return preImage.GetAttributeValue<bool>(attribute);

            return false;
        }

        /// <summary>
        /// Returns the effective decimal for an attribute:
        /// - Prefers Target value when present; otherwise uses Pre-Image.
        /// - Safely converts AliasedValue, Money, decimal, double/float, integral, and string.
        /// - Returns defaultValue when both are missing or null.
        /// </summary>
        protected static decimal GetEffectiveDecimal(Entity target, Entity preImage, string attrName, decimal defaultValue = 0m)
        {
            object raw = null;

            if (target != null && target.Attributes.TryGetValue(attrName, out var tVal))
                raw = tVal;
            else if (preImage != null && preImage.Attributes.TryGetValue(attrName, out var pVal))
                raw = pVal;

            return NumericHelper.ToDecimal(raw, defaultValue);
        }

        /// <summary>
        /// Gets the effective int value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static int? GetEffectiveInt(Entity target, Entity preImage, string attributeName)
        {
            if (target != null && target.Contains(attributeName))
                return target.GetAttributeValue<int?>(attributeName);

            if (preImage != null && preImage.Contains(attributeName))
                return preImage.GetAttributeValue<int?>(attributeName);

            return null;
        }

        /// <summary>
        /// Gets the effective EntityReference value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static EntityReference GetEffectiveEntityReference(Entity target, Entity preImage, string attributeName)
        {
            if (target != null && target.Contains(attributeName))
                return target.GetAttributeValue<EntityReference>(attributeName);

            if (preImage != null && preImage.Contains(attributeName))
                return preImage.GetAttributeValue<EntityReference>(attributeName);

            return null;
        }

        /// <summary>
        /// Gets the effective string value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static string GetEffectiveString(Entity target, Entity preImage, string attributeName)
        {
            if (target != null && target.Contains(attributeName))
                return target.GetAttributeValue<string>(attributeName);

            if (preImage != null && preImage.Contains(attributeName))
                return preImage.GetAttributeValue<string>(attributeName);

            return null;
        }

        /// <summary>
        /// Gets the effective OptionSetValue from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static OptionSetValue GetEffectiveOptionSetValue(Entity target, Entity preImage, string attributeName)
        {
            if (target != null && target.Contains(attributeName))
                return target.GetAttributeValue<OptionSetValue>(attributeName);

            if (preImage != null && preImage.Contains(attributeName))
                return preImage.GetAttributeValue<OptionSetValue>(attributeName);

            return null;
        }

        /// <summary>
        /// True when the attribute is in the Target payload. Does NOT compare
        /// against the pre-image: Excel, the Web API and flows can re-send an
        /// unchanged value, so use a pre-image comparison when that matters.
        /// (Name kept for its many callers.)
        /// </summary>
        protected static bool HasAttributeChanged(Entity target, string attributeName)
        {
            return target.Contains(attributeName);
        }

        /// <summary>
        /// Checks if any of the specified attributes have changed.
        /// </summary>
        protected static bool HasAnyAttributeChanged(Entity target, params string[] attributeNames)
        {
            foreach (var name in attributeNames)
            {
                if (target.Contains(name))
                    return true;
            }
            return false;
        }
    }
}