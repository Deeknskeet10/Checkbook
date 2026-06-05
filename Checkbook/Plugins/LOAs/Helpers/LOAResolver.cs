using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;

namespace Checkbook.Plugins.LOAs.Helpers
{
    /// <summary>
    /// The set of inputs that uniquely identify (and populate) a Line of Accounting,
    /// hydrated from a Funding Track row.
    /// </summary>
    public class LOAGrain
    {
        public EntityReference OPR;
        public EntityReference Fund;
        public EntityReference BOC;
        public EntityReference DollarType;
        public EntityReference PG;
        public EntityReference SAG;
        public EntityReference MDEP;
        public EntityReference APE;

        public int Appropriation;
        /// <summary>Fund's <c>book_fiscalyear</c> option-set value (copied to the LOA).</summary>
        public OptionSetValue FiscalYear;

        public LOANameParts NameParts;
        public string CanonicalName;
    }

    /// <summary>
    /// Builds an <see cref="LOAGrain"/> from a Funding Track row, finds an existing
    /// LOA by canonical name, and creates new LOAs when none match.
    /// </summary>
    public static class LOAResolver
    {
        /// <summary>
        /// Resolves a grain from a Funding Track entity. <paramref name="ftEntity"/>
        /// must already carry the grain lookups (OPR/Fund/BOC/DT/PG/SAG/MDEP/APE) —
        /// use a Retrieve or a merged target+pre-image.
        ///
        /// Returns <c>null</c> if any required field is missing or the name can't be built;
        /// reasons are written to <paramref name="tracing"/>.
        /// </summary>
        public static LOAGrain Resolve(
            IOrganizationService service,
            Entity ftEntity,
            ITracingService tracing)
        {
            if (ftEntity == null) throw new ArgumentNullException(nameof(ftEntity));

            var opr        = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.DisbursingOfficial);
            var fund       = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.Fund);
            var boc        = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.BOC);
            var dollarType = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.DollarType);
            var pg         = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.PG);
            var sag        = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.SAG);
            var mdep       = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.MDEP);
            var ape        = ftEntity.GetAttributeValue<EntityReference>(FundingTrackAttributes.APE);

            if (fund == null)
            {
                tracing.Trace($"FT {ftEntity.Id}: Fund is null — skipping.");
                return null;
            }

            // Fund carries the authoritative FY + APPN. Fetch them once.
            var fundRecord = service.Retrieve(EntityNames.Fund, fund.Id, new ColumnSet(
                FundAttributes.Name, FundAttributes.FiscalYear, FundAttributes.Appropriation));
            var fundName = fundRecord.GetAttributeValue<string>(FundAttributes.Name);
            var fy       = fundRecord.GetAttributeValue<OptionSetValue>(FundAttributes.FiscalYear);
            var appnOs   = fundRecord.GetAttributeValue<OptionSetValue>(FundAttributes.Appropriation);

            if (string.IsNullOrWhiteSpace(fundName) || appnOs == null)
            {
                tracing.Trace($"FT {ftEntity.Id}: Fund {fund.Id} missing name or appropriation — skipping.");
                return null;
            }

            LOAGrain grain;
            try
            {
                grain = new LOAGrain
                {
                    OPR        = opr,
                    Fund       = fund,
                    BOC        = boc,
                    DollarType = dollarType,
                    PG         = pg,
                    SAG        = sag,
                    MDEP       = mdep,
                    APE        = ape,
                    Appropriation = appnOs.Value,
                    FiscalYear    = fy,
                    NameParts = new LOANameParts
                    {
                        OPRName        = ResolveName(service, opr,        tracing),
                        FundName       = fundName,
                        BOCName        = ResolveName(service, boc,        tracing),
                        DollarTypeName = ResolveName(service, dollarType, tracing),
                        PGName         = ResolveName(service, pg,         tracing),
                        SAGName        = ResolveName(service, sag,        tracing),
                        MDEPName       = ResolveName(service, mdep,       tracing),
                        Appropriation  = appnOs.Value,
                    },
                };
                grain.CanonicalName = LOANameBuilder.Build(grain.NameParts);
            }
            catch (ArgumentException ex)
            {
                tracing.Trace($"FT {ftEntity.Id}: name build failed — {ex.Message}");
                return null;
            }

            return grain;
        }

        /// <summary>
        /// Finds an existing LOA by canonical name. Returns the LOA id, or null
        /// if no active LOA bears that name.
        /// </summary>
        public static Guid? FindByName(IOrganizationService service, string canonicalName)
        {
            var query = new QueryExpression(EntityNames.FundingLine)
            {
                ColumnSet = new ColumnSet(FundingLineAttributes.Id),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingLineAttributes.Name, ConditionOperator.Equal, canonicalName),
                        new ConditionExpression(FundingLineAttributes.StateCode, ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                NoLock = true,
            };
            var result = service.RetrieveMultiple(query);
            return result.Entities.Count > 0 ? result.Entities[0].Id : (Guid?)null;
        }

        /// <summary>
        /// Builds a new <c>book_fundingline</c> entity (un-persisted) populated from the grain.
        /// The name is intentionally NOT pre-set — LOANameSetter (PreOp Create) writes it.
        /// </summary>
        public static Entity BuildLOAEntity(LOAGrain grain, EntityReference owningBusinessUnit)
        {
            if (grain == null) throw new ArgumentNullException(nameof(grain));

            var loa = new Entity(EntityNames.FundingLine);
            loa[FundingLineAttributes.DisbursingOfficial] = grain.OPR;
            loa[FundingLineAttributes.Fund]               = grain.Fund;
            loa[FundingLineAttributes.BOC]                = grain.BOC;
            loa[FundingLineAttributes.DollarType]         = grain.DollarType;
            loa[FundingLineAttributes.PG]                 = grain.PG;
            loa[FundingLineAttributes.SAG]                = grain.SAG;
            loa[FundingLineAttributes.MDEP]               = grain.MDEP;
            // FY is also set by LOANameSetter for safety, but include it here for clarity.
            if (grain.FiscalYear != null)
                loa[FundingLineAttributes.FiscalYear] = grain.FiscalYear;
            if (owningBusinessUnit != null)
                loa["owningbusinessunit"] = owningBusinessUnit;
            return loa;
        }

        /// <summary>
        /// Associates the LOA with the FT's APE via the book_FundingLine_book_APE_book_APE N:N.
        /// Idempotent: pre-checks the intersect and skips when the link already exists.
        /// Catching the duplicate-key fault from Associate inside a transaction-bound
        /// Custom API poisons the transaction, so we must avoid throwing in the first place.
        /// </summary>
        public static void AssociateApe(
            IOrganizationService service,
            Guid loaId,
            EntityReference ape,
            ITracingService tracing)
        {
            if (ape == null)
            {
                tracing.Trace($"LOA {loaId}: no APE on FT — skipping association.");
                return;
            }

            if (IsApeAssociated(service, loaId, ape.Id))
            {
                tracing.Trace($"LOA {loaId}: APE {ape.Id} already associated — skipping.");
                return;
            }

            service.Associate(
                EntityNames.FundingLine,
                loaId,
                new Relationship(FundingLineAttributes.APERelationship),
                new EntityReferenceCollection { ape });
            tracing.Trace($"LOA {loaId}: associated APE {ape.Id}.");
        }

        private static bool IsApeAssociated(IOrganizationService service, Guid loaId, Guid apeId)
        {
            // Use RetrieveRequest with RelatedEntitiesQuery so we reference the
            // relationship by name (which Dataverse honors) instead of guessing the
            // intersect entity's logical name — the two don't always match.
            var rel = new Relationship(FundingLineAttributes.APERelationship);

            var relatedApes = new QueryExpression(EntityNames.APE)
            {
                ColumnSet = new ColumnSet(false),
                TopCount = 1,
                NoLock = true,
                Criteria = new FilterExpression
                {
                    Conditions = { new ConditionExpression("book_apeid", ConditionOperator.Equal, apeId) },
                },
            };

            var request = new RetrieveRequest
            {
                Target = new EntityReference(EntityNames.FundingLine, loaId),
                ColumnSet = new ColumnSet(false),
                RelatedEntitiesQuery = new RelationshipQueryCollection { { rel, relatedApes } },
            };

            var response = (RetrieveResponse)service.Execute(request);

            return response.Entity.RelatedEntities.TryGetValue(rel, out var related)
                && related.Entities.Count > 0;
        }

        private static string ResolveName(
            IOrganizationService service,
            EntityReference reference,
            ITracingService tracing)
        {
            if (reference == null) return null;

            // EntityReference.Name is populated by some SDK paths; trust it when present.
            if (!string.IsNullOrWhiteSpace(reference.Name))
                return reference.Name;

            try
            {
                var record = service.Retrieve(reference.LogicalName, reference.Id, new ColumnSet("book_name"));
                return record.GetAttributeValue<string>("book_name");
            }
            catch (Exception ex)
            {
                tracing.Trace($"ResolveName({reference.LogicalName}, {reference.Id}) failed: {ex.Message}");
                return null;
            }
        }
    }
}
