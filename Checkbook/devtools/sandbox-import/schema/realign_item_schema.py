#!/usr/bin/env python3
"""Create the FY27 Realignment schema in Blipsnchitz via the Dataverse metadata API.
Idempotent: checks existence before each create. Components added to the ARNGCheckbook
solution so they export cleanly. See docs/Realignment-FY27-Redesign.md.

Creates:
  - table  book_realignmentitem (UserOwned)   primary name book_name
  - cols   book_newamount (Decimal), book_samefundandsag (Boolean)
  - lookups (relationships) from book_realignmentitem:
       book_realignment            -> book_realignments           (parent, Delete=Cascade)
       book_debitprioritizationfunding -> book_prioritizationfunding (RemoveLink)
       book_debitrequirementdetailfunding -> book_requirementdetailfunding (RemoveLink)
       book_debitrequirementfunding -> book_requirementfunding     (RemoveLink)
       book_creditrequirementfunding -> book_requirementfunding    (RemoveLink)
       book_fund -> book_fund, book_pg -> book_pg, book_sag -> book_sag,
       book_debitstate -> book_state                               (RemoveLink)
  - parent book_realignments cols:
       book_realignmententrymode (Picklist State=0/OPR=1),
       book_totalamount (Decimal), book_allsamefundsag (Boolean), book_itemcount (Integer)
"""
import sys, os, json
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
ITEM = "book_realignmentitem"
if not exists_entity(ITEM):
    print("creating table", ITEM)
    body = {
        "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
        "SchemaName": "book_RealignmentItem",
        "DisplayName": L("Realignment Item"),
        "DisplayCollectionName": L("Realignment Items"),
        "Description": L("One Fund/SAG move within a Realignment (FY27 child item)."),
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
    print("table", ITEM, "exists")

# ---------------------------------------------------------------- simple attrs on item
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

def add_boolean(entity, schema, label):
    if exists_attr(entity, schema.lower()):
        print("  attr", schema, "exists"); return
    body = {"@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
            "SchemaName": schema, "AttributeType": "Boolean",
            "AttributeTypeName": {"Value": "BooleanType"},
            "RequiredLevel": {"Value": "None"}, "DisplayName": L(label),
            "OptionSet": {"@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
                          "TrueOption": {"Value": 1, "Label": L("Yes")},
                          "FalseOption": {"Value": 0, "Label": L("No")}}}
    meta_post(f"EntityDefinitions(LogicalName='{entity}')/Attributes", body)
    print("  + boolean", schema)

def add_integer(entity, schema, label, lo=0, hi=100000):
    if exists_attr(entity, schema.lower()):
        print("  attr", schema, "exists"); return
    body = {"@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
            "SchemaName": schema, "AttributeType": "Integer",
            "AttributeTypeName": {"Value": "IntegerType"},
            "RequiredLevel": {"Value": "None"}, "DisplayName": L(label),
            "MinValue": lo, "MaxValue": hi}
    meta_post(f"EntityDefinitions(LogicalName='{entity}')/Attributes", body)
    print("  + integer", schema)

def add_picklist(entity, schema, label, options):
    if exists_attr(entity, schema.lower()):
        print("  attr", schema, "exists"); return
    body = {"@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
            "SchemaName": schema, "AttributeType": "Picklist",
            "AttributeTypeName": {"Value": "PicklistType"},
            "RequiredLevel": {"Value": "None"}, "DisplayName": L(label),
            "OptionSet": {"@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
                          "IsGlobal": False, "OptionSetType": "Picklist",
                          "Options": [{"Value": v, "Label": L(t)} for v, t in options]}}
    meta_post(f"EntityDefinitions(LogicalName='{entity}')/Attributes", body)
    print("  + picklist", schema)

print("item simple attrs:")
add_decimal(ITEM, "book_newamount", "Amount")
add_boolean(ITEM, "book_samefundandsag", "Same Fund and SAG")

# ---------------------------------------------------------------- lookups (relationships)
def add_lookup(ref_schema, lookup_schema, lookup_label, referenced_entity,
               rel_schema, cascade_delete="RemoveLink"):
    """Create a N:1 from book_realignmentitem -> referenced_entity."""
    if exists_attr(ITEM, lookup_schema.lower()):
        print("  lookup", lookup_schema, "exists"); return
    casc = {"Assign": "NoCascade", "Delete": cascade_delete, "Merge": "NoCascade",
            "Reparent": "NoCascade", "Share": "NoCascade", "Unshare": "NoCascade",
            "RollupView": "NoCascade"}
    body = {"@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
            "SchemaName": rel_schema,
            "ReferencedEntity": referenced_entity, "ReferencingEntity": ITEM,
            "CascadeConfiguration": casc,
            "Lookup": {"@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                       "SchemaName": lookup_schema, "DisplayName": L(lookup_label),
                       "RequiredLevel": {"Value": "None"}}}
    meta_post("RelationshipDefinitions", body)
    print("  + lookup", lookup_schema, "->", referenced_entity)

print("item lookups:")
add_lookup(ITEM, "book_Realignment", "Realignment", "book_realignments",
           "book_realignments_book_realignmentitem", cascade_delete="Cascade")
add_lookup(ITEM, "book_DebitPrioritizationFunding", "Debit Prioritization Funding",
           "book_prioritizationfunding", "book_prioritizationfunding_book_realignmentitem_debit")
add_lookup(ITEM, "book_DebitRequirementDetailFunding", "Debit Requirement Detail Funding",
           "book_requirementdetailfunding", "book_requirementdetailfunding_book_realignmentitem_debit")
add_lookup(ITEM, "book_DebitRequirementFunding", "Debit Requirement Funding",
           "book_requirementfunding", "book_requirementfunding_book_realignmentitem_debit")
add_lookup(ITEM, "book_CreditRequirementFunding", "Credit Requirement Funding",
           "book_requirementfunding", "book_requirementfunding_book_realignmentitem_credit")
add_lookup(ITEM, "book_Fund", "Fund", "book_fund", "book_fund_book_realignmentitem")
add_lookup(ITEM, "book_PG", "PG", "book_pg", "book_pg_book_realignmentitem")
add_lookup(ITEM, "book_SAG", "SAG", "book_sag", "book_sag_book_realignmentitem")
add_lookup(ITEM, "book_DebitState", "Debit State", "book_state", "book_state_book_realignmentitem")

# ---------------------------------------------------------------- parent fields
print("parent book_realignments fields:")
add_picklist("book_realignments", "book_realignmententrymode", "Entry Mode",
             [(0, "State"), (1, "OPR")])
add_decimal("book_realignments", "book_totalamount", "Total Amount")
add_boolean("book_realignments", "book_allsamefundsag", "All Items Same Fund and SAG")
add_integer("book_realignments", "book_itemcount", "Item Count")

# ---------------------------------------------------------------- publish
print("publishing...")
dvapi.action("PublishAllXml", {})
print("done.")
