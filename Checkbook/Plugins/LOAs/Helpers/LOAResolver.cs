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

            // Pull every grain-lookup's display name in a single ExecuteMultiple
            // round trip — was up to 6 sequential Retrieves per FT, dominating
            // LOAGenerator's runtime on environments with many unlinked FTs.
            var nameMap = ResolveNamesBatch(
                service, tracing,
                new[] { opr, boc, dollarType, pg, sag, mdep });

            string NameOf(EntityReference reference) =>
                reference == null
                    ? null
                    : (nameMap.TryGetValue(reference.Id, out var n) ? n : null);

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
                        OPRName        = NameOf(opr),
                        FundName       = fundName,
                        BOCName        = NameOf(boc),
                        DollarTypeName = NameOf(dollarType),
                        PGName         = NameOf(pg),
                        SAGName        = NameOf(sag),
                        MDEPName       = NameOf(mdep),
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
        /// Finds the LOA that the FT should link to, picking the right lookup strategy
        /// for the grain's fiscal year.
        ///
        /// FY27+ LOAs identify uniquely by canonical name (MDEP collapses into the
        /// name slot). FY26 and earlier carry a Dataverse alternate key on
        /// (Fund, OPR, BOC, DollarType, PG, MDEP) that is stricter than the name —
        /// two grains with distinct canonical names can still collide on the
        /// composite key (e.g., differing SAG/APE), so we must check both before
        /// attempting Create. A composite-key fault would poison the Custom API's
        /// transaction and cascade across the rest of the batch.
        /// </summary>
        public static Guid? FindExisting(
            IOrganizationService service,
            LOAGrain grain,
            ITracingService tracing)
        {
            if (grain == null) throw new ArgumentNullException(nameof(grain));

            var byName = FindByName(service, grain.CanonicalName);
            if (byName.HasValue) return byName;

            var fy = LOANameBuilder.ParseFiscalYear(grain.NameParts.FundName);
            if (fy > LOANameBuilder.MdepInNameLastFy)
                return null;

            return FindByCompositeKey(service, grain, tracing);
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
        /// Finds an existing LOA on the FY26 composite alternate key
        /// (Fund, OPR, BOC, DollarType, PG, MDEP). Returns null if any of those
        /// key fields are missing on the grain — Dataverse only enforces the
        /// alternate key when all fields are populated, so a null in this slot
        /// means there is no constraint to collide with.
        /// </summary>
        private static Guid? FindByCompositeKey(
            IOrganizationService service,
            LOAGrain grain,
            ITracingService tracing)
        {
            if (grain.Fund == null || grain.OPR == null || grain.BOC == null
                || grain.DollarType == null || grain.PG == null || grain.MDEP == null)
                return null;

            var query = new QueryExpression(EntityNames.FundingLine)
            {
                ColumnSet = new ColumnSet(FundingLineAttributes.Id, FundingLineAttributes.Name),
                TopCount = 1,
                Criteria = new FilterExpression(LogicalOperator.And)
                {
                    Conditions =
                    {
                        new ConditionExpression(FundingLineAttributes.Fund,               ConditionOperator.Equal, grain.Fund.Id),
                        new ConditionExpression(FundingLineAttributes.DisbursingOfficial, ConditionOperator.Equal, grain.OPR.Id),
                        new ConditionExpression(FundingLineAttributes.BOC,                ConditionOperator.Equal, grain.BOC.Id),
                        new ConditionExpression(FundingLineAttributes.DollarType,         ConditionOperator.Equal, grain.DollarType.Id),
                        new ConditionExpression(FundingLineAttributes.PG,                 ConditionOperator.Equal, grain.PG.Id),
                        new ConditionExpression(FundingLineAttributes.MDEP,               ConditionOperator.Equal, grain.MDEP.Id),
                        new ConditionExpression(FundingLineAttributes.StateCode,          ConditionOperator.Equal, StateCodeValues.Active),
                    },
                },
                NoLock = true,
            };
            var result = service.RetrieveMultiple(query);
            if (result.Entities.Count == 0) return null;

            var hit = result.Entities[0];
            var hitName = hit.GetAttributeValue<string>(FundingLineAttributes.Name);
            tracing.Trace($"Composite-key match: '{grain.CanonicalName}' collides with existing LOA '{hitName}' ({hit.Id}).");
            return hit.Id;
        }

        /// <summary>
        /// Builds a new <c>book_fundingline</c> entity (un-persisted) populated from the grain.
        /// The name and owningbusinessunit are intentionally NOT pre-set — LOANameSetter
        /// (PreOp Create) writes them so admin/form-created LOAs go through the same path.
        /// </summary>
        public static Entity BuildLOAEntity(LOAGrain grain)
        {
            if (grain == null) throw new ArgumentNullException(nameof(grain));

            var loa = new Entity(EntityNames.FundingLine);
            loa[FundingLineAttributes.DisbursingOfficial] = grain.OPR;
            loa[FundingLineAttributes.Fund]               = grain.Fund;
            loa[FundingLineAttributes.BOC]                = grain.BOC;
            loa[FundingLineAttributes.DollarType]         = grain.DollarType;
            loa[FundingLineAttributes.PG]                 = grain.PG;
            loa[FundingLineAttributes.SAG]                = grain.SAG;

            // MDEP is only carried on the LOA for fiscal years that still include it
            // in the canonical name (FY26 and earlier). FY27+ LOAs intentionally
            // collapse across MDEPs and must leave the field empty.
            var fy = LOANameBuilder.ParseFiscalYear(grain.NameParts.FundName);
            if (fy <= LOANameBuilder.MdepInNameLastFy)
                loa[FundingLineAttributes.MDEP] = grain.MDEP;

            // FY is also set by LOANameSetter for safety, but include it here for clarity.
            if (grain.FiscalYear != null)
                loa[FundingLineAttributes.FiscalYear] = grain.FiscalYear;
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

        /// <summary>
        /// Resolves <c>book_name</c> for every non-null reference in
        /// <paramref name="references"/> in a single <see cref="ExecuteMultipleRequest"/>.
        /// References whose <c>.Name</c> is already populated by the caller skip
        /// the round trip entirely. Returns a per-Guid map of resolved names;
        /// references missing from the map (failed retrieves) resolve to null
        /// at the call site.
        /// </summary>
        private static System.Collections.Generic.Dictionary<Guid, string> ResolveNamesBatch(
            IOrganizationService service,
            ITracingService tracing,
            System.Collections.Generic.IEnumerable<EntityReference> references)
        {
            var nameMap = new System.Collections.Generic.Dictionary<Guid, string>();
            var batched = new System.Collections.Generic.List<EntityReference>();
            var batch = new ExecuteMultipleRequest
            {
                Settings = new ExecuteMultipleSettings { ContinueOnError = true, ReturnResponses = true },
                Requests = new OrganizationRequestCollection(),
            };

            foreach (var reference in references)
            {
                if (reference == null) continue;
                if (nameMap.ContainsKey(reference.Id)) continue;
                if (!string.IsNullOrWhiteSpace(reference.Name))
                {
                    nameMap[reference.Id] = reference.Name;
                    continue;
                }
                batch.Requests.Add(new RetrieveRequest
                {
                    Target = reference,
                    ColumnSet = new ColumnSet("book_name"),
                });
                batched.Add(reference);
            }

            if (batch.Requests.Count == 0) return nameMap;

            var response = (ExecuteMultipleResponse)service.Execute(batch);
            for (int i = 0; i < response.Responses.Count; i++)
            {
                var item = response.Responses[i];
                var reference = batched[i];
                if (item.Fault != null)
                {
                    tracing.Trace(
                        $"ResolveName({reference.LogicalName}, {reference.Id}) failed: {item.Fault.Message}");
                    continue;
                }
                var retrieved = ((RetrieveResponse)item.Response).Entity;
                nameMap[reference.Id] = retrieved.GetAttributeValue<string>("book_name");
            }
            return nameMap;
        }
    }
}
