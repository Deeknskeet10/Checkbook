#!/usr/bin/env python3
"""Ground-truth the FY27 schema in Blipsnchitz: tables, key columns, choices.
Read-only. Run before building the FY27 seed."""
import sys, os, urllib.parse as u
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

def entity_exists(logical):
    try:
        dvapi.get(f"EntityDefinitions(LogicalName='{logical}')?$select=LogicalName,EntitySetName")
        return True
    except Exception:
        return False

def attrs(logical, prefix=None):
    """list attributes (logical name + type) for an entity."""
    try:
        j = dvapi.get(f"EntityDefinitions(LogicalName='{logical}')/Attributes?"
                      "$select=LogicalName,AttributeType")
    except Exception as e:
        return None
    out = []
    for a in j.get("value", []):
        ln = a.get("LogicalName", "")
        if prefix and not ln.startswith(prefix):
            continue
        out.append((ln, a.get("AttributeType")))
    return sorted(out)

def picklist_options(logical, attr):
    """return [(value,label)] for a picklist attribute."""
    for kind in ("PicklistAttributeMetadata", "StateAttributeMetadata",
                 "StatusAttributeMetadata", "MultiSelectPicklistAttributeMetadata"):
        try:
            j = dvapi.get(f"EntityDefinitions(LogicalName='{logical}')/Attributes(LogicalName='{attr}')"
                          f"/Microsoft.Dynamics.CRM.{kind}?$expand=OptionSet($select=Options)")
            opts = j.get("OptionSet", {}).get("Options", [])
            return [(o["Value"], (o["Label"]["UserLocalizedLabel"] or {}).get("Label")) for o in opts]
        except Exception:
            continue
    return None

print("=== FY27-relevant tables: existence ===")
tables = ["book_fundedprogram", "book_fund", "book_fundingline", "book_fundingtrack",
          "book_requirement", "book_requirementdetail", "book_requirementdetailfunding",
          "book_requirementfunding", "book_prioritization", "book_prioritizationfunding",
          "book_itemizeddetails", "book_itemizeddetail", "book_requirements",
          "book_requirementses", "book_mdep"]
for t in tables:
    print(f"  {t:34s} {'YES' if entity_exists(t) else 'no'}")

print("\n=== book_fund attributes (book_* + fundkey/fundedprogram) ===")
for ln, ty in (attrs("book_fund", "book_") or []):
    if any(k in ln for k in ("fundedprogram", "fundkey", "appropriation", "dollartype",
                              "boc", "category", "name", "fiscal")):
        print(f"  {ln:40s} {ty}")

print("\n=== book_fundingline (LOA) attributes of interest ===")
for ln, ty in (attrs("book_fundingline", "book_") or []):
    if any(k in ln for k in ("disburs", "category", "fundedprogram", "tdp", "name",
                             "fiscal", "fund", "pg", "sag", "mdep", "opr")):
        print(f"  {ln:40s} {ty}")

print("\n=== book_fundingtrack attributes of interest ===")
for ln, ty in (attrs("book_fundingtrack", "book_") or []):
    if any(k in ln for k in ("category", "fundedprogram", "beginning", "resource",
                             "fiscal", "disburs", "boc", "dollartype", "name", "fund")):
        print(f"  {ln:40s} {ty}")

print("\n=== choices ===")
for ent, at in (("book_fundingline", "book_category"),
                ("book_fundingtrack", "book_category"),
                ("book_fundingline", "book_disbursingofficial"),
                ("book_fund", "book_category")):
    opts = picklist_options(ent, at)
    print(f"  {ent}.{at}: {opts}")

print("\n=== book_requirementdetail attrs ===")
for ln, ty in (attrs("book_requirementdetail", "book_") or []):
    print(f"  {ln:40s} {ty}")

print("\n=== book_requirementdetailfunding attrs ===")
a = attrs("book_requirementdetailfunding", "book_")
if a is None:
    print("  (entity not found)")
else:
    for ln, ty in a:
        print(f"  {ln:40s} {ty}")

print("\n=== row counts (FY-relevant) ===")
for es in ("book_fundedprograms", "book_funds", "book_fundinglines", "book_fundingtracks",
           "book_requirementdetails", "book_requirementdetailfundings",
           "book_prioritizationfundings", "book_itemizeddetailses"):
    try:
        j = dvapi.get(es + "?$count=true&$top=1")
        print(f"  {es:34s} {j.get('@odata.count','?')}")
    except Exception as e:
        print(f"  {es:34s} ERR {str(e)[:60]}")
