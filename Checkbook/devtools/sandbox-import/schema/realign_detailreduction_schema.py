#!/usr/bin/env python3
"""Create the FY27 itemized-debit detail-reduction schema in Blipsnchitz via the
Dataverse metadata API. Idempotent: checks existence before each create. Added to
the ARNGCheckbook solution so it exports cleanly.
See docs/Prioritization-Funding-Reconciliation.md §5 + docs/Realignment-FY27-Redesign.md §9.8.

Creates:
  - table  book_realignmentdetailreduction (UserOwned)  primary name book_name
  - col    book_newamount (Decimal)  — the amount to reduce the ItemizedDetail by
  - lookups (relationships) from book_realignmentdetailreduction:
       book_realignment   -> book_realignments     (parent, Delete=Cascade)
       book_itemizeddetail -> book_itemizeddetails  (RemoveLink)
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

# ---------------------------------------------------------------- entity
DR = "book_realignmentdetailreduction"
if not exists_entity(DR):
    print("creating table", DR)
    body = {
        "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
        "SchemaName": "book_RealignmentDetailReduction",
        "DisplayName": L("Realignment Detail Reduction"),
        "DisplayCollectionName": L("Realignment Detail Reductions"),
        "Description": L("One ItemizedDetail reduced to balance an itemized-debit Realignment (FY27)."),
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
else:
    print("table", DR, "exists")

# ---------------------------------------------------------------- simple attrs
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

print("simple attrs:")
add_decimal(DR, "book_newamount", "Reduction Amount")

# ---------------------------------------------------------------- lookups (relationships)
def add_lookup(lookup_schema, lookup_label, referenced_entity, rel_schema, cascade_delete="RemoveLink"):
    if exists_attr(DR, lookup_schema.lower()):
        print("  lookup", lookup_schema, "exists"); return
    casc = {"Assign": "NoCascade", "Delete": cascade_delete, "Merge": "NoCascade",
            "Reparent": "NoCascade", "Share": "NoCascade", "Unshare": "NoCascade",
            "RollupView": "NoCascade"}
    body = {"@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
            "SchemaName": rel_schema,
            "ReferencedEntity": referenced_entity, "ReferencingEntity": DR,
            "CascadeConfiguration": casc,
            "Lookup": {"@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                       "SchemaName": lookup_schema, "DisplayName": L(lookup_label),
                       "RequiredLevel": {"Value": "None"}}}
    meta_post("RelationshipDefinitions", body)
    print("  + lookup", lookup_schema, "->", referenced_entity)

print("lookups:")
add_lookup("book_Realignment", "Realignment", "book_realignments",
           "book_realignments_book_realignmentdetailreduction", cascade_delete="Cascade")
add_lookup("book_ItemizedDetail", "Itemized Detail", "book_itemizeddetails",
           "book_itemizeddetails_book_realignmentdetailreduction")

# ---------------------------------------------------------------- publish
print("publishing...")
dvapi.action("PublishAllXml", {})
print("done.")
