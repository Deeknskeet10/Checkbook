using System;
using Microsoft.Xrm.Sdk;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.LOAs.Helpers;

namespace Checkbook.Plugins.LOAs
{
    /// <summary>
    /// Pre-Operation Update plugin on <c>book_fundingtrack</c>.
    ///
    /// When an FT already linked to an LOA has a grain field changed
    /// (OPR / Fund / BOC / DT / PG / SAG / MDEP), this plugin recomputes the
    /// target LOA grain, find-or-creates the matching LOA, and rewrites
    /// <c>book_lineofaccountingloa</c> on the FT in place.
    ///
    /// FTs without a linked LOA are intentionally left alone — those are
    /// expected to be picked up by the bulk <c>book_GenerateLOAs</c> Custom API
    /// (typically after the user's bulk upload).
    ///
    /// TDP rollup on the old and new LOA is handled by the existing
    /// <c>FundingTrackTDPRecalculator</c> in PostOp, which reads our new
    /// target value alongside its own pre-image. We rely on the same pipeline
    /// depth so its <c>Depth &gt; 1</c> guard doesn't skip.
    ///
    /// Register: PreOp Update on <c>book_fundingtrack</c>, with a PreImage
    /// containing the grain fields + <c>book_lineofaccountingloa</c> + <c>book_ape</c>.
    /// </summary>
    public class FundingTrackLOASynchronizer : PluginBase
    {
        private static readonly string[] GrainFields = new[]
        {
            FundingTrackAttributes.DisbursingOfficial,
            FundingTrackAttributes.Fund,
            FundingTrackAttributes.BOC,
            FundingTrackAttributes.DollarType,
            FundingTrackAttributes.PG,
            FundingTrackAttributes.SAG,
            FundingTrackAttributes.MDEP,
        };

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.PrimaryEntityName != EntityNames.FundingTrack ||
                context.MessageName != "Update" ||
                context.Stage != 20) // PreOperation
            {
                tracing.Trace($"Skipping — Entity={context.PrimaryEntityName}, " +
                              $"Message={context.MessageName}, Stage={context.Stage}.");
                return;
            }

            // Stop runaway recursion in case downstream plugins update FTs too.
            if (context.Depth > 1)
            {
                tracing.Trace($"Skipping — depth {context.Depth} > 1.");
                return;
            }

            var target = GetTarget(context);
            var preImage = TryGetPreImage(context);

            if (preImage == null)
            {
                tracing.Trace("No PreImage registered; cannot diff grain. Skipping.");
                return;
            }

            // Only re-link FTs that already have an LOA. Unlinked FTs wait for the
            // bulk Custom API.
            var existingLoa = preImage.GetAttributeValue<EntityReference>(FundingTrackAttributes.LineOfAccounting);
            if (existingLoa == null)
            {
                tracing.Trace("FT has no existing LOA; bulk Custom API will handle it. Skipping.");
                return;
            }

            // Nothing to do if no grain field is in the update.
            if (!HasAnyAttributeChanged(target, GrainFields))
            {
                tracing.Trace("No grain field changed; nothing to resolve.");
                return;
            }

            // Build the effective post-update FT view.
            var merged = GetMergedEntity(target, preImage);
            merged.Id = context.PrimaryEntityId;

            var grain = LOAResolver.Resolve(service, merged, tracing);
            if (grain == null)
            {
                tracing.Trace("Grain could not be resolved on merged FT — leaving LOA link unchanged.");
                return;
            }

            // Find existing LOA by name, or create one. New LOA's name + FY are
            // populated by LOANameSetter in its own PreOp Create step.
            var owningBu = preImage.GetAttributeValue<EntityReference>("owningbusinessunit");
            var matchedId = LOAResolver.FindByName(service, grain.CanonicalName);
            Guid loaId;
            if (matchedId.HasValue)
            {
                loaId = matchedId.Value;
                tracing.Trace($"Matched existing LOA '{grain.CanonicalName}' → {loaId}.");
            }
            else
            {
                var loaEntity = LOAResolver.BuildLOAEntity(grain, owningBu);
                loaId = service.Create(loaEntity);
                tracing.Trace($"Created new LOA '{grain.CanonicalName}' → {loaId}.");
            }

            if (loaId != existingLoa.Id)
            {
                target[FundingTrackAttributes.LineOfAccounting] =
                    new EntityReference(EntityNames.FundingLine, loaId);
                tracing.Trace($"Relinking FT {context.PrimaryEntityId}: " +
                              $"{existingLoa.Id} → {loaId}. " +
                              "PostOp FundingTrackTDPRecalculator will roll up both LOAs.");
            }
            else
            {
                tracing.Trace("Grain change resolved to the same LOA — no relink needed.");
            }

            // Idempotent: APE association on the (possibly new) LOA.
            var ape = grain.APE;
            if (ape != null)
                LOAResolver.AssociateApe(service, loaId, ape, tracing);
        }
    }
}
