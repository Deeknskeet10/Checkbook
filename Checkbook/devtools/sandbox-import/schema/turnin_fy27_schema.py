#!/usr/bin/env python3
"""Create the FY27 Turn-In schema in Blipsnchitz via the Dataverse metadata API.
Idempotent: checks existence before each create. Added to the ARNGCheckbook solution so it
exports cleanly. See docs/TurnIn-FY27-Redesign.md. Must be replicated in gov.

FY27 Turn-Ins draw from Prioritization Funding junctions (State) or Requirement Fundings
(BE / OPR), can span several Fund/SAGs, and size AFP / Allotment per item.

Creates / changes:
  - book_turninitems
      book_prioritizationfunding -> book_prioritizationfunding (RemoveLink)
      book_afpamount, book_allotmentamount (Decimal)       per-item AFP / Allotment
      book_afpoverridden, book_allotmentoverridden (Yes/No) per-item sticky overrides
  - table book_turnindetailreduction (UserOwned)  primary name book_name
      book_newamount (Decimal), book_turnin -> book_turnin (Cascade),
      book_itemizeddetail -> book_itemizeddetails (RemoveLink)
  - table book_turninrdfreduction (UserOwned)  primary name book_name
      book_newamount (Decimal), book_turnin -> book_turnin (Cascade),
      book_requirementdetailfunding -> book_requirementdetailfunding (RemoveLink)
  - book_turnin.book_fund / book_pg: ApplicationRequired -> None (FY27 header has no Fund/PG;
    FY26 and Sweep Turn-Ins still set them).
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

SOLUTION = "ARNGCheckbook"
SOL_HDR = {"MSCRM.SolutionUniqueName": SOLUTION}


def L(text):
    return {"@odata.type": "Microsoft.Dynamics.CRM.Label",
            "LocalizedLabels": [{"@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel",
                                 "Label": text, "LanguageCode": 1033}]}


def meta_post(path, body, extra=None):
    h = dict(SOL_HDR); h.update(extra or {})
    resp, data = dvapi._req("POST", path, body, h)
    return resp.headers.get("OData-EntityId"), data


def exists_entity(logical):
    try:
        dvapi.get(f"EntityDefinitions(LogicalName='{logical}')?$select=LogicalName")
        return True
    except Exception:
        return False


def exists_attr(entity, attr):
    try:
        dvapi.get(f"EntityDefinitions(LogicalName='{entity}')/Attributes(LogicalName='{attr}')?$select=LogicalName")
        return True
    except Exception:
        return False


def add_table(logical, schema, label, plural, description):
    if exists_entity(logical):
        print("table", logical, "exists"); return
    print("creating table", logical)
    body = {
        "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
        "SchemaName": schema, "DisplayName": L(label), "DisplayCollectionName": L(plural),
        "Description": L(description), "OwnershipType": "UserOwned",
        "IsActivity": False, "HasActivities": False, "HasNotes": False,
        "Attributes": [{
            "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
            "SchemaName": "book_name", "AttributeType": "String",
            "AttributeTypeName": {"Value": "StringType"},
            "IsPrimaryName": True, "MaxLength": 200,
            "RequiredLevel": {"Value": "None"}, "DisplayName": L("Name"),
        }],
    }
    print("  ->", meta_post("EntityDefinitions", body)[0])


def add_decimal(entity, schema, label, precision=2, lo=-1000000000, hi=1000000000):
    if exists_attr(entity, schema.lower()):
        print("  attr", schema, "exists"); return
    body = {"@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
            "SchemaName": schema, "AttributeType": "Decimal",
            "AttributeTypeName": {"Value": "DecimalType"},
            "RequiredLevel": {"Value": "None"}, "DisplayName": L(label),
            "Precision": precision, "MinValue": lo, "MaxValue": hi}
    meta_post(f"EntityDefinitions(LogicalName='{entity}')/Attributes", body)
    print("  + decimal", schema)


def add_lookup(entity, lookup_schema, lookup_label, referenced_entity, rel_schema, cascade_delete="RemoveLink"):
    if exists_attr(entity, lookup_schema.lower()):
        print("  lookup", lookup_schema, "exists"); return
    casc = {"Assign": "NoCascade", "Delete": cascade_delete, "Merge": "NoCascade",
            "Reparent": "NoCascade", "Share": "NoCascade", "Unshare": "NoCascade",
            "RollupView": "NoCascade"}
    body = {"@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
            "SchemaName": rel_schema,
            "ReferencedEntity": referenced_entity, "ReferencingEntity": entity,
            "CascadeConfiguration": casc,
            "Lookup": {"@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                       "SchemaName": lookup_schema, "DisplayName": L(lookup_label),
                       "RequiredLevel": {"Value": "None"}}}
    meta_post("RelationshipDefinitions", body)
    print("  + lookup", lookup_schema, "->", referenced_entity)


def add_bool(entity, schema, label):
    if exists_attr(entity, schema.lower()):
        print("  attr", schema, "exists"); return
    body = {"@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
            "SchemaName": schema, "AttributeType": "Boolean",
            "AttributeTypeName": {"Value": "BooleanType"},
            "RequiredLevel": {"Value": "None"}, "DisplayName": L(label),
            "DefaultValue": False,
            "OptionSet": {"@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
                          "TrueOption": {"Value": 1, "Label": L("Yes")},
                          "FalseOption": {"Value": 0, "Label": L("No")}}}
    meta_post(f"EntityDefinitions(LogicalName='{entity}')/Attributes", body)
    print("  + bool", schema)


def relax(entity, attr):
    full = dvapi.get("EntityDefinitions(LogicalName='%s')/Attributes(LogicalName='%s')" % (entity, attr))
    rl = (full.get("RequiredLevel") or {}).get("Value")
    if rl == "None":
        print("  %s.%s already None" % (entity, attr)); return
    body = dict(full)
    body["RequiredLevel"] = {"Value": "None", "CanBeChanged": True,
                             "ManagedPropertyLogicalName": "canmodifyrequirementlevelsettings"}
    dvapi._req("PUT", "EntityDefinitions(LogicalName='%s')/Attributes(LogicalName='%s')" % (entity, attr),
               body, {"If-Match": "*", "MSCRM.MergeLabels": "true"})
    print("  %s.%s: %s -> None" % (entity, attr, rl))


# ---------------------------------------------------------------- items
TI = "book_turninitems"
print(TI)
add_lookup(TI, "book_PrioritizationFunding", "Prioritization Funding", "book_prioritizationfunding",
           "book_prioritizationfunding_book_turninitems")
add_decimal(TI, "book_AFPAmount", "AFP Amount")
add_decimal(TI, "book_AllotmentAmount", "Allotment Amount")
add_bool(TI, "book_AFPOverridden", "AFP Overridden")
add_bool(TI, "book_AllotmentOverridden", "Allotment Overridden")

# ---------------------------------------------------------------- itemized detail reductions
DR = "book_turnindetailreduction"
add_table(DR, "book_TurnInDetailReduction", "Turn-In Detail Reduction", "Turn-In Detail Reductions",
          "One Itemized Detail reduced on an itemized Prioritization by an FY27 Turn-In.")
add_decimal(DR, "book_newamount", "Reduction Amount")
add_lookup(DR, "book_TurnIn", "Turn-In", "book_turnin", "book_turnin_book_turnindetailreduction",
           cascade_delete="Cascade")
add_lookup(DR, "book_ItemizedDetail", "Itemized Detail", "book_itemizeddetails",
           "book_itemizeddetails_book_turnindetailreduction")

# ---------------------------------------------------------------- RDF reductions
RR = "book_turninrdfreduction"
add_table(RR, "book_TurnInRdfReduction", "Turn-In RD Funding Reduction", "Turn-In RD Funding Reductions",
          "One Requirement Detail Funding junction reduced on the RF of an FY27 RF-level Turn-In.")
add_decimal(RR, "book_newamount", "Reduction Amount")
add_lookup(RR, "book_TurnIn", "Turn-In", "book_turnin", "book_turnin_book_turninrdfreduction",
           cascade_delete="Cascade")
add_lookup(RR, "book_RequirementDetailFunding", "Requirement Detail Funding", "book_requirementdetailfunding",
           "book_requirementdetailfunding_book_turninrdfreduction")

# ---------------------------------------------------------------- header Fund / PG optional
print("book_turnin")
relax("book_turnin", "book_fund")
relax("book_turnin", "book_pg")

print("publishing...")
dvapi.action("PublishAllXml", {})
print("done.")
