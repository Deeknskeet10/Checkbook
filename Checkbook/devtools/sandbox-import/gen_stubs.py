#!/usr/bin/env python3
import os, zipfile

OUT = "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad/apmostubs"
os.makedirs(OUT, exist_ok=True)

# (schema_name, display, collection_display)
ENTITIES = [
    ("apmo_avb",         "AVB",        "AVBs"),
    ("apmo_mdepsag",     "MDEP SAG",   "MDEP SAGs"),
    ("apmo_rod",         "ROD",        "RODs"),
    ("apmo_ooc",         "OOC",        "OOCs"),
    ("apmo_prejudice",   "Prejudice",  "Prejudices"),
    ("apmo_rvb",         "RVB",        "RVBs"),
    ("apmo_sa",          "SA",         "SAs"),
    ("apmo_directorate", "Directorate","Directorates"),
    ("apmo_division",    "Division",   "Divisions"),
]

HEADER = '<ImportExportXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" OrganizationVersion="9.2.26082.167" OrganizationSchemaType="Standard" CRMServerServiceabilityVersion="9.2.26082.00167">'

def extra_text_attr(logical, display):
    return f'''
            <attribute PhysicalName="{logical}">
              <Type>nvarchar</Type>
              <Name>{logical}</Name>
              <LogicalName>{logical}</LogicalName>
              <RequiredLevel>none</RequiredLevel>
              <DisplayMask>ValidForAdvancedFind|ValidForForm|ValidForGrid</DisplayMask>
              <ImeMode>auto</ImeMode>
              <ValidForUpdateApi>1</ValidForUpdateApi>
              <ValidForReadApi>1</ValidForReadApi>
              <ValidForCreateApi>1</ValidForCreateApi>
              <IsCustomField>1</IsCustomField>
              <IsAuditEnabled>0</IsAuditEnabled>
              <IsSecured>0</IsSecured>
              <IntroducedVersion>1.0.0.1</IntroducedVersion>
              <IsCustomizable>1</IsCustomizable>
              <IsRenameable>1</IsRenameable>
              <SourceType>0</SourceType>
              <IsSearchable>1</IsSearchable>
              <IsFilterable>0</IsFilterable>
              <IsRetrievable>1</IsRetrievable>
              <IsLocalizable>0</IsLocalizable>
              <Format>text</Format>
              <MaxLength>100</MaxLength>
              <Length>200</Length>
              <displaynames>
                <displayname description="{display}" languagecode="1033" />
              </displaynames>
              <Descriptions>
                <Description description="" languagecode="1033" />
              </Descriptions>
            </attribute>'''

def entity_xml(schema, disp, coll):
    pk_physical = schema[0].upper() + schema[1:] + "Id"   # cosmetic
    pk_logical  = schema + "id"
    extra_attrs = extra_text_attr("apmo_rvbnumber", "RVB Number") if schema == "apmo_rvb" else ""
    return f'''    <Entity>
      <Name LocalizedName="{disp}" OriginalName="{disp}">{schema}</Name>
      <EntityInfo>
        <entity Name="{schema}">
          <LocalizedNames>
            <LocalizedName description="{disp}" languagecode="1033" />
          </LocalizedNames>
          <LocalizedCollectionNames>
            <LocalizedCollectionName description="{coll}" languagecode="1033" />
          </LocalizedCollectionNames>
          <Descriptions>
            <Description description="Stub table created for the dev sandbox to satisfy ARNGCheckbook lookups." languagecode="1033" />
          </Descriptions>
          <attributes>
            <attribute PhysicalName="{pk_physical}">
              <Type>primarykey</Type>
              <Name>{pk_logical}</Name>
              <LogicalName>{pk_logical}</LogicalName>
              <RequiredLevel>systemrequired</RequiredLevel>
              <DisplayMask>ValidForAdvancedFind|RequiredForGrid</DisplayMask>
              <ImeMode>auto</ImeMode>
              <ValidForUpdateApi>0</ValidForUpdateApi>
              <ValidForReadApi>1</ValidForReadApi>
              <ValidForCreateApi>1</ValidForCreateApi>
              <IsCustomField>0</IsCustomField>
              <IsAuditEnabled>0</IsAuditEnabled>
              <IsSecured>0</IsSecured>
              <IntroducedVersion>1.0.0.0</IntroducedVersion>
              <IsCustomizable>1</IsCustomizable>
              <IsRenameable>1</IsRenameable>
              <CanModifySearchSettings>1</CanModifySearchSettings>
              <CanModifyRequirementLevelSettings>0</CanModifyRequirementLevelSettings>
              <CanModifyAdditionalSettings>1</CanModifyAdditionalSettings>
              <SourceType>0</SourceType>
              <IsSearchable>0</IsSearchable>
              <IsFilterable>1</IsFilterable>
              <IsRetrievable>1</IsRetrievable>
              <IsLocalizable>0</IsLocalizable>
              <displaynames>
                <displayname description="{disp}" languagecode="1033" />
              </displaynames>
              <Descriptions>
                <Description description="Unique identifier for entity instances" languagecode="1033" />
              </Descriptions>
            </attribute>
            <attribute PhysicalName="apmo_Name">
              <Type>nvarchar</Type>
              <Name>apmo_name</Name>
              <LogicalName>apmo_name</LogicalName>
              <RequiredLevel>none</RequiredLevel>
              <DisplayMask>PrimaryName|ValidForAdvancedFind|ValidForForm|ValidForGrid|RequiredForForm</DisplayMask>
              <ImeMode>auto</ImeMode>
              <ValidForUpdateApi>1</ValidForUpdateApi>
              <ValidForReadApi>1</ValidForReadApi>
              <ValidForCreateApi>1</ValidForCreateApi>
              <IsCustomField>1</IsCustomField>
              <IsAuditEnabled>0</IsAuditEnabled>
              <IsSecured>0</IsSecured>
              <IntroducedVersion>1.0.0.0</IntroducedVersion>
              <IsCustomizable>1</IsCustomizable>
              <IsRenameable>1</IsRenameable>
              <CanModifySearchSettings>1</CanModifySearchSettings>
              <CanModifyRequirementLevelSettings>1</CanModifyRequirementLevelSettings>
              <CanModifyAdditionalSettings>1</CanModifyAdditionalSettings>
              <SourceType>0</SourceType>
              <IsSearchable>1</IsSearchable>
              <IsFilterable>0</IsFilterable>
              <IsRetrievable>1</IsRetrievable>
              <IsLocalizable>0</IsLocalizable>
              <Format>text</Format>
              <MaxLength>100</MaxLength>
              <Length>200</Length>
              <displaynames>
                <displayname description="Name" languagecode="1033" />
              </displaynames>
              <Descriptions>
                <Description description="" languagecode="1033" />
              </Descriptions>
            </attribute>
            <attribute PhysicalName="statecode">
              <Type>state</Type>
              <Name>statecode</Name>
              <LogicalName>statecode</LogicalName>
              <RequiredLevel>systemrequired</RequiredLevel>
              <DisplayMask>ValidForAdvancedFind|ValidForForm|ValidForGrid</DisplayMask>
              <ImeMode>auto</ImeMode>
              <ValidForUpdateApi>1</ValidForUpdateApi>
              <ValidForReadApi>1</ValidForReadApi>
              <ValidForCreateApi>0</ValidForCreateApi>
              <IsCustomField>0</IsCustomField>
              <IsAuditEnabled>1</IsAuditEnabled>
              <IsSecured>0</IsSecured>
              <IntroducedVersion>1.0.0.0</IntroducedVersion>
              <IsCustomizable>1</IsCustomizable>
              <IsRenameable>1</IsRenameable>
              <SourceType>0</SourceType>
              <IsSearchable>0</IsSearchable>
              <IsFilterable>1</IsFilterable>
              <IsRetrievable>0</IsRetrievable>
              <IsLocalizable>0</IsLocalizable>
              <optionset Name="{schema}_statecode">
                <OptionSetType>state</OptionSetType>
                <IntroducedVersion>1.0.0.0</IntroducedVersion>
                <IsCustomizable>1</IsCustomizable>
                <displaynames>
                  <displayname description="Status" languagecode="1033" />
                </displaynames>
                <Descriptions>
                  <Description description="Status of the {disp}" languagecode="1033" />
                </Descriptions>
                <states>
                  <state value="0" defaultstatus="1" invariantname="Active" IsHidden="0">
                    <labels>
                      <label description="Active" languagecode="1033" />
                    </labels>
                  </state>
                  <state value="1" defaultstatus="2" invariantname="Inactive" IsHidden="0">
                    <labels>
                      <label description="Inactive" languagecode="1033" />
                    </labels>
                  </state>
                </states>
              </optionset>
              <displaynames>
                <displayname description="Status" languagecode="1033" />
              </displaynames>
              <Descriptions>
                <Description description="Status of the {disp}" languagecode="1033" />
              </Descriptions>
            </attribute>
            <attribute PhysicalName="statuscode">
              <Type>status</Type>
              <Name>statuscode</Name>
              <LogicalName>statuscode</LogicalName>
              <RequiredLevel>none</RequiredLevel>
              <DisplayMask>ValidForAdvancedFind|ValidForForm|ValidForGrid</DisplayMask>
              <ImeMode>auto</ImeMode>
              <ValidForUpdateApi>1</ValidForUpdateApi>
              <ValidForReadApi>1</ValidForReadApi>
              <ValidForCreateApi>1</ValidForCreateApi>
              <IsCustomField>0</IsCustomField>
              <IsAuditEnabled>1</IsAuditEnabled>
              <IsSecured>0</IsSecured>
              <IntroducedVersion>1.0.0.0</IntroducedVersion>
              <IsCustomizable>1</IsCustomizable>
              <IsRenameable>1</IsRenameable>
              <SourceType>0</SourceType>
              <IsSearchable>0</IsSearchable>
              <IsFilterable>0</IsFilterable>
              <IsRetrievable>0</IsRetrievable>
              <IsLocalizable>0</IsLocalizable>
              <optionset Name="{schema}_statuscode">
                <OptionSetType>status</OptionSetType>
                <IntroducedVersion>1.0.0.0</IntroducedVersion>
                <IsCustomizable>1</IsCustomizable>
                <displaynames>
                  <displayname description="Status Reason" languagecode="1033" />
                </displaynames>
                <Descriptions>
                  <Description description="Reason for the status of the {disp}" languagecode="1033" />
                </Descriptions>
                <statuses>
                  <status value="1" state="0" IsHidden="0">
                    <labels>
                      <label description="Active" languagecode="1033" />
                    </labels>
                  </status>
                  <status value="2" state="1" IsHidden="0">
                    <labels>
                      <label description="Inactive" languagecode="1033" />
                    </labels>
                  </status>
                </statuses>
              </optionset>
              <displaynames>
                <displayname description="Status Reason" languagecode="1033" />
              </displaynames>
              <Descriptions>
                <Description description="Reason for the status of the {disp}" languagecode="1033" />
              </Descriptions>
            </attribute>{extra_attrs}
          </attributes>
          <EntitySetName>{schema}s</EntitySetName>
          <IsDuplicateCheckSupported>1</IsDuplicateCheckSupported>
          <IsBusinessProcessEnabled>0</IsBusinessProcessEnabled>
          <IsRequiredOffline>0</IsRequiredOffline>
          <IsInteractionCentricEnabled>0</IsInteractionCentricEnabled>
          <IsCollaboration>0</IsCollaboration>
          <AutoRouteToOwnerQueue>0</AutoRouteToOwnerQueue>
          <IsConnectionsEnabled>0</IsConnectionsEnabled>
          <EntityColor></EntityColor>
          <IsDocumentManagementEnabled>0</IsDocumentManagementEnabled>
          <AutoCreateAccessTeams>0</AutoCreateAccessTeams>
          <IsOneNoteIntegrationEnabled>0</IsOneNoteIntegrationEnabled>
          <IsKnowledgeManagementEnabled>0</IsKnowledgeManagementEnabled>
          <IsSLAEnabled>0</IsSLAEnabled>
          <IsBPFEntity>0</IsBPFEntity>
          <OwnershipTypeMask>UserOwned</OwnershipTypeMask>
          <IsAuditEnabled>0</IsAuditEnabled>
          <IsActivity>0</IsActivity>
          <IsActivityParty>0</IsActivityParty>
          <IsReplicated>0</IsReplicated>
          <IsReplicationUserFiltered>0</IsReplicationUserFiltered>
          <IsMailMergeEnabled>0</IsMailMergeEnabled>
          <IsVisibleInMobile>0</IsVisibleInMobile>
          <IsVisibleInMobileClient>0</IsVisibleInMobileClient>
          <IsReadOnlyInMobileClient>0</IsReadOnlyInMobileClient>
          <IsOfflineInMobileClient>0</IsOfflineInMobileClient>
          <IsMapiGridEnabled>1</IsMapiGridEnabled>
          <IsReadingPaneEnabled>1</IsReadingPaneEnabled>
          <IsQuickCreateEnabled>0</IsQuickCreateEnabled>
          <SyncToExternalSearchIndex>0</SyncToExternalSearchIndex>
          <IntroducedVersion>1.0.0.0</IntroducedVersion>
          <IsCustomizable>1</IsCustomizable>
          <IsRenameable>1</IsRenameable>
          <IsMappable>1</IsMappable>
          <EnforceStateTransitions>0</EnforceStateTransitions>
          <EntityHelpUrlEnabled>0</EntityHelpUrlEnabled>
          <ChangeTrackingEnabled>0</ChangeTrackingEnabled>
          <IsSolutionAware>0</IsSolutionAware>
        </entity>
      </EntityInfo>
    </Entity>'''

entities_xml = "\n".join(entity_xml(s, d, c) for s, d, c in ENTITIES)

customizations = f'''<?xml version="1.0" encoding="utf-8"?>
{HEADER}
  <Entities>
{entities_xml}
  </Entities>
  <Roles></Roles>
  <Workflows></Workflows>
  <FieldSecurityProfiles></FieldSecurityProfiles>
  <Templates></Templates>
  <EntityMaps></EntityMaps>
  <EntityRelationships></EntityRelationships>
  <OrganizationSettings></OrganizationSettings>
  <optionsets></optionsets>
  <CustomControls></CustomControls>
  <EntityDataProviders></EntityDataProviders>
  <Languages>
    <Language>1033</Language>
  </Languages>
</ImportExportXml>
'''

rootcomponents = "\n".join(
    f'      <RootComponent type="1" schemaName="{s}" behavior="0" />' for s, _, _ in ENTITIES
)

solution = f'''<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml version="1.0.0.0" SolutionPackageVersion="9.2" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <SolutionManifest>
    <UniqueName>APMOStubs</UniqueName>
    <LocalizedNames>
      <LocalizedName description="APMO Stubs (dev sandbox)" languagecode="1033" />
    </LocalizedNames>
    <Descriptions>
      <Description description="Placeholder apmo_ tables to satisfy ARNGCheckbook lookups in the dev sandbox." languagecode="1033" />
    </Descriptions>
    <Version>1.0.0.1</Version>
    <Managed>0</Managed>
    <Publisher>
      <UniqueName>apmo</UniqueName>
      <LocalizedNames>
        <LocalizedName description="APMO" languagecode="1033" />
      </LocalizedNames>
      <Descriptions>
        <Description description="APMO publisher (dev sandbox)" languagecode="1033" />
      </Descriptions>
      <EMailAddress xsi:nil="true"></EMailAddress>
      <SupportingWebsiteUrl xsi:nil="true"></SupportingWebsiteUrl>
      <CustomizationPrefix>apmo</CustomizationPrefix>
      <CustomizationOptionValuePrefix>10000</CustomizationOptionValuePrefix>
      <Addresses></Addresses>
    </Publisher>
    <RootComponents>
{rootcomponents}
    </RootComponents>
    <MissingDependencies></MissingDependencies>
  </SolutionManifest>
</ImportExportXml>
'''

content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="text/xml" />
</Types>
'''

for name, data in [
    ("customizations.xml", customizations),
    ("solution.xml", solution),
    ("[Content_Types].xml", content_types),
]:
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(data)

zip_path = "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad/APMOStubs.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for name in ("solution.xml", "customizations.xml", "[Content_Types].xml"):
        z.write(os.path.join(OUT, name), name)

print("Wrote", zip_path)
print("Entities:", ", ".join(s for s, _, _ in ENTITIES))
