using System;
using Microsoft.Xrm.Sdk;

namespace ARNGCheckbook.Plugins
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

            // Run as the calling user (pass null for system context)
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

        /// <summary>
        /// Gets an entity with attributes merged from target and pre-image.
        /// Target attributes take precedence over pre-image attributes.
        /// Useful for getting the "effective" state of a record during an Update.
        /// </summary>
        /// <param name="target">The target entity from InputParameters.</param>
        /// <param name="preImage">The pre-image entity (can be null).</param>
        /// <returns>A new entity with merged attributes.</returns>
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

        /// <summary>
        /// Gets the effective Money value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static decimal GetEffectiveMoney(Entity target, Entity preImage, string attributeName)
        {
            // Check target first (changed value)
            if (target.Contains(attributeName))
            {
                var money = target.GetAttributeValue<Money>(attributeName);
                return money?.Value ?? 0m;
            }

            // Fall back to pre-image (unchanged value)
            if (preImage != null && preImage.Contains(attributeName))
            {
                var money = preImage.GetAttributeValue<Money>(attributeName);
                return money?.Value ?? 0m;
            }

            return 0m;
        }

        /// <summary>
        /// Gets the effective decimal value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static decimal GetEffectiveDecimal(Entity target, Entity preImage, string attributeName)
        {
            // Check target first (changed value)
            if (target.Contains(attributeName))
            {
                return target.GetAttributeValue<decimal>(attributeName);
            }

            // Fall back to pre-image (unchanged value)
            if (preImage != null && preImage.Contains(attributeName))
            {
                return preImage.GetAttributeValue<decimal>(attributeName);
            }

            return 0m;
        }

        /// <summary>
        /// Gets the effective int value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static int? GetEffectiveInt(Entity target, Entity preImage, string attributeName)
        {
            // Check target first (changed value)
            if (target.Contains(attributeName))
            {
                return target.GetAttributeValue<int?>(attributeName);
            }

            // Fall back to pre-image (unchanged value)
            if (preImage != null && preImage.Contains(attributeName))
            {
                return preImage.GetAttributeValue<int?>(attributeName);
            }

            return null;
        }

        /// <summary>
        /// Gets the effective EntityReference value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static EntityReference GetEffectiveEntityReference(Entity target, Entity preImage, string attributeName)
        {
            // Check target first (changed value)
            if (target.Contains(attributeName))
            {
                return target.GetAttributeValue<EntityReference>(attributeName);
            }

            // Fall back to pre-image (unchanged value)
            if (preImage != null && preImage.Contains(attributeName))
            {
                return preImage.GetAttributeValue<EntityReference>(attributeName);
            }

            return null;
        }

        /// <summary>
        /// Gets the effective string value from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static string GetEffectiveString(Entity target, Entity preImage, string attributeName)
        {
            // Check target first (changed value)
            if (target.Contains(attributeName))
            {
                return target.GetAttributeValue<string>(attributeName);
            }

            // Fall back to pre-image (unchanged value)
            if (preImage != null && preImage.Contains(attributeName))
            {
                return preImage.GetAttributeValue<string>(attributeName);
            }

            return null;
        }

        /// <summary>
        /// Gets the effective OptionSetValue from target or pre-image.
        /// Returns target value if present, otherwise falls back to pre-image.
        /// </summary>
        protected static OptionSetValue GetEffectiveOptionSetValue(Entity target, Entity preImage, string attributeName)
        {
            // Check target first (changed value)
            if (target.Contains(attributeName))
            {
                return target.GetAttributeValue<OptionSetValue>(attributeName);
            }

            // Fall back to pre-image (unchanged value)
            if (preImage != null && preImage.Contains(attributeName))
            {
                return preImage.GetAttributeValue<OptionSetValue>(attributeName);
            }

            return null;
        }

        /// <summary>
        /// Checks if an attribute has changed between target and pre-image.
        /// Returns true if the attribute is in target (meaning it was modified).
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
