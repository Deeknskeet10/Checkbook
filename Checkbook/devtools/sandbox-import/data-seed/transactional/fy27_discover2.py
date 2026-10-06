#!/usr/bin/env python3
"""Pass 2: lookup targets + RD/FundedProgram/DisbursingOfficial entity shapes."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

def lookup_targets(entity, attr):
    try:
        j = dvapi.get(f"EntityDefinitions(LogicalName='{entity}')/Attributes(LogicalName='{attr}')"
                      f"/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=Targets")
        return j.get("Targets")
    except Exception as e:
        return f"ERR {str(e)[:80]}"

def entity_set(logical):
    try:
        j = dvapi.get(f"EntityDefinitions(LogicalName='{logical}')?$select=EntitySetName,PrimaryNameAttribute")
        return j.get("EntitySetName"), j.get("PrimaryNameAttribute")
    except Exception as e:
        return f"ERR {str(e)[:60]}", None

def attrs(logical, prefix="book_"):
    try:
        j = dvapi.get(f"EntityDefinitions(LogicalName='{logical}')/Attributes?$select=LogicalName,AttributeType")
    except Exception as e:
        return None
    return sorted((a["LogicalName"], a.get("AttributeType")) for a in j.get("value", [])
                  if a["LogicalName"].startswith(prefix))

print("=== lookup targets ===")
for e, a in (("book_fundingline", "book_disbursingofficial"),
             ("book_fundingtrack", "book_disbursingofficial"),
             ("book_fund", "book_newfundedprogram"),
             ("book_requirementdetailfunding", "book_requirementdetail"),
             ("book_requirementdetailfunding", "book_requirementfunding"),
             ("book_itemizeddetails", "book_prioritization") ):
    print(f"  {e}.{a} -> {lookup_targets(e, a)}")

print("\n=== itemizeddetails lookups (discover all book_ lookups) ===")
print("  entityset:", entity_set("book_itemizeddetails"))
for ln, ty in (attrs("book_itemizeddetails") or []):
    print(f"  {ln:40s} {ty}")

print("\n=== book_fundedprogram shape ===")
print("  entityset:", entity_set("book_fundedprogram"))
for ln, ty in (attrs("book_fundedprogram") or []):
    print(f"  {ln:40s} {ty}")

print("\n=== resolve RequirementDetails entity (lookup target above tells us) ===")
# derive from the junction lookup target
rd_target = lookup_targets("book_requirementdetailfunding", "book_requirementdetail")
print("  RD logical (from junction target):", rd_target)
if isinstance(rd_target, list) and rd_target:
    rd = rd_target[0]
    print("  entityset:", entity_set(rd))
    for ln, ty in (attrs(rd) or []):
        print(f"  {ln:40s} {ty}")

print("\n=== book_fund.book_appropriation options ===")
try:
    j = dvapi.get("EntityDefinitions(LogicalName='book_fund')/Attributes(LogicalName='book_appropriation')"
                  "/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet($select=Options)")
    for o in j.get("OptionSet", {}).get("Options", []):
        print(f"  {o['Value']}: {(o['Label']['UserLocalizedLabel'] or {}).get('Label')}")
except Exception as e:
    print("  ERR", str(e)[:120])

print("\n=== existing Funds (name, appropriation, fundedprogram lookup, fiscalyear) ===")
j = dvapi.get("book_funds?$select=book_name,book_appropriation,book_fiscalyear,_book_newfundedprogram_value&$orderby=book_name")
for f in j.get("value", []):
    print(f"  {f.get('book_name'):16s} appr={f.get('book_appropriation')} fy={f.get('book_fiscalyear')} fp={f.get('_book_newfundedprogram_value')}")

print("\n=== existing Funding Tracks ===")
j = dvapi.get("book_fundingtracks?$select=book_name,book_fiscalyear,book_category,book_beginningbalancereadonly,book_newresourceamount,_book_disbursingofficial_value,_book_fund_value")
for t in j.get("value", []):
    print(f"  {t.get('book_name')}: fy={t.get('book_fiscalyear')} cat={t.get('book_category')} bb={t.get('book_beginningbalancereadonly')} ra={t.get('book_newresourceamount')} do={t.get('_book_disbursingofficial_value')}")
