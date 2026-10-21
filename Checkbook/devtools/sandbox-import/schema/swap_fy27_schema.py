#!/usr/bin/env python3
"""Create the FY27 State Swap schema in Blipsnchitz via the Dataverse metadata API.
Idempotent: checks existence before each create. Added to the ARNGCheckbook solution so it
exports cleanly. See docs/StateSwap-FY27-Redesign.md §4. Must be replicated in gov.

FY27 swap items are PF -> PF legs: the giving state names a debit Prioritization Funding,
the receiving state a credit Prioritization Funding (both existing + funded). Itemized
Prios balance through Prio-level detail reductions / increases keyed to the swap.

Creates / changes:
  - book_swapitem
      book_debitprioritizationfunding  -> book_prioritizationfunding (RemoveLink)
      book_creditprioritizationfunding -> book_prioritizationfunding (RemoveLink)
  - table book_swapdetailreduction (UserOwned)  primary name book_name
      book_newamount (Decimal), book_itemizeddetail -> book_itemizeddetails (RemoveLink),
      book_stateswap -> book_stateswap (Cascade: Delete / Assign / Share / Unshare)
  - table book_swapdetailincrease (UserOwned)  same shape
Parent cascade matches book_swapitem so children follow the swap's sharing to both states.

Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/swap_fy27_schema.py
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
    print("  + decimal", entity, schema)


def add_lookup(entity, lookup_schema, lookup_label, referenced_entity, rel_schema, parental=False):
    if exists_attr(entity, lookup_schema.lower()):
        print("  lookup", entity, lookup_schema, "exists"); return
    if parental:
        # Same as book_stateswap -> book_swapitem: children follow the swap's
        # delete, owner and sharing (both states see the reductions / increases).
        casc = {"Assign": "Cascade", "Delete": "Cascade", "Merge": "NoCascade",
                "Reparent": "Cascade", "Share": "Cascade", "Unshare": "Cascade",
                "RollupView": "NoCascade"}
    else:
        casc = {"Assign": "NoCascade", "Delete": "RemoveLink", "Merge": "NoCascade",
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
    print("  + lookup", entity, lookup_schema, "->", referenced_entity)


# ---------------------------------------------------------------- book_swapitem
SI = "book_swapitem"
print("book_swapitem lookups:")
add_lookup(SI, "book_DebitPrioritizationFunding", "Debit Prioritization Funding",
           "book_prioritizationfunding", "book_debitprioritizationfunding_book_swapitem")
add_lookup(SI, "book_CreditPrioritizationFunding", "Credit Prioritization Funding",
           "book_prioritizationfunding", "book_creditprioritizationfunding_book_swapitem")

# ---------------------------------------------------------------- detail adjustment tables
for logical, schema, label, plural, desc, amount_label in (
        ("book_swapdetailreduction", "book_SwapDetailReduction",
         "Swap Detail Reduction", "Swap Detail Reductions",
         "One Itemized Detail reduced to balance the amount an itemized Prioritization sends in a State Swap (FY27).",
         "Reduction Amount"),
        ("book_swapdetailincrease", "book_SwapDetailIncrease",
         "Swap Detail Increase", "Swap Detail Increases",
         "One Itemized Detail increased to balance the amount an itemized Prioritization receives in a State Swap (FY27).",
         "Increase Amount")):
    add_table(logical, schema, label, plural, desc)
    add_decimal(logical, "book_newamount", amount_label)
    add_lookup(logical, "book_StateSwap", "State Swap", "book_stateswap",
               "book_stateswap_%s" % logical, parental=True)
    add_lookup(logical, "book_ItemizedDetail", "Itemized Detail", "book_itemizeddetails",
               "book_itemizeddetails_%s" % logical)

# ---------------------------------------------------------------- publish
print("publishing...")
dvapi.action("PublishAllXml", {})
print("done.")
