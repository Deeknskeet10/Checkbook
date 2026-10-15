#!/usr/bin/env python3
"""Create the FY27 OPR (RF->RF) Requirement Detail Funding adjustment schema in Blipsnchitz
via the Dataverse metadata API. Idempotent: checks existence before each create. Added to
the ARNGCheckbook solution so it exports cleanly.
See docs/Realignment-FY27-Redesign.md §5 (OPR path) + §9.9.

An OPR realignment moves TDP between two Requirement Fundings. When the debit RF's funding
is split out across Requirement Details (book_requirementdetailfunding junctions), the part
of the move that withholding cannot cover must come out of those junctions; on the credit
side the user may push the landing amount into the credit RF's Requirement Details.

Creates:
  - table  book_realignmentrdfreduction (UserOwned)  primary name book_name
      book_newamount (Decimal)                          amount to reduce the junction by
      book_realignment -> book_realignments             (parent, Delete=Cascade)
      book_requirementdetailfunding -> book_requirementdetailfunding (RemoveLink)
  - table  book_realignmentrdfincrease (UserOwned)   primary name book_name
      book_newamount (Decimal)                          amount to add to RD <-> credit RF
      book_realignment -> book_realignments             (parent, Delete=Cascade)
      book_requirementdetail -> book_requirementdetails (RemoveLink)
      book_requirementfunding -> book_requirementfunding (RemoveLink)  the credit RF
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
        "SchemaName": schema,
        "DisplayName": L(label),
        "DisplayCollectionName": L(plural),
        "Description": L(description),
        "OwnershipType": "UserOwned",
        "IsActivity": False, "HasActivities": False, "HasNotes": False,
        "Attributes": [{
            "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
            "SchemaName": "book_name", "AttributeType": "String",
            "AttributeTypeName": {"Value": "StringType"},
            "IsPrimaryName": True, "MaxLength": 200,
            "RequiredLevel": {"Value": "None"},
            "DisplayName": L("Name"),
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


# ---------------------------------------------------------------- debit: RDF reductions
RED = "book_realignmentrdfreduction"
add_table(RED, "book_RealignmentRdfReduction", "Realignment RD Funding Reduction",
          "Realignment RD Funding Reductions",
          "One Requirement Detail Funding junction reduced on the debit RF of an OPR Realignment (FY27).")
add_decimal(RED, "book_newamount", "Reduction Amount")
add_lookup(RED, "book_Realignment", "Realignment", "book_realignments",
           "book_realignments_book_realignmentrdfreduction", cascade_delete="Cascade")
add_lookup(RED, "book_RequirementDetailFunding", "Requirement Detail Funding",
           "book_requirementdetailfunding", "book_requirementdetailfunding_book_realignmentrdfreduction")

# ---------------------------------------------------------------- credit: RDF increases
INC = "book_realignmentrdfincrease"
add_table(INC, "book_RealignmentRdfIncrease", "Realignment RD Funding Increase",
          "Realignment RD Funding Increases",
          "One Requirement Detail funded from the credit RF of an OPR Realignment (FY27).")
add_decimal(INC, "book_newamount", "Increase Amount")
add_lookup(INC, "book_Realignment", "Realignment", "book_realignments",
           "book_realignments_book_realignmentrdfincrease", cascade_delete="Cascade")
add_lookup(INC, "book_RequirementDetail", "Requirement Detail", "book_requirementdetails",
           "book_requirementdetails_book_realignmentrdfincrease")
add_lookup(INC, "book_RequirementFunding", "Credit Requirement Funding", "book_requirementfunding",
           "book_requirementfunding_book_realignmentrdfincrease")

print("publishing...")
dvapi.action("PublishAllXml", {})
print("done.")
