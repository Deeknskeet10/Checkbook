using System;
using Microsoft.Xrm.Sdk;

namespace MyCompany.MyProject.Plugins
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
    }
}
