#!/usr/bin/env python3
import sys
sys.path.insert(0, "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad")
import dvapi

def rels(ent):
    j = dvapi.get(f"EntityDefinitions(LogicalName='{ent}')/ManyToOneRelationships"
                  "?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity")
    print(f"=== {ent} M:1 lookups ===")
    for r in j.get("value", []):
        a = r["ReferencingAttribute"]
        if a.startswith("book_"):
            print(f"  attr={a:28} navprop={r['ReferencingEntityNavigationPropertyName']:28} -> {r['ReferencedEntity']}")

def opts(ent, attr):
    try:
        j = dvapi.get(f"EntityDefinitions(LogicalName='{ent}')/Attributes(LogicalName='{attr}')/"
                      "Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet,GlobalOptionSet")
        row = j.get("value", [{}])[0]
        os_ = row.get("OptionSet") or row.get("GlobalOptionSet") or {}
        print(f"=== {ent}.{attr} options (set: {os_.get('Name')}) ===")
        for o in os_.get("Options", []):
            lbl = (o.get("Label", {}).get("LocalizedLabels") or [{}])[0].get("Label", "")
            print(f"  {o['Value']} = {lbl}")
    except Exception as e:
        print(f"  {ent}.{attr}: ERR {str(e)[:160]}")

rels("book_fundcenter")
rels("book_sag")
opts("book_fundcenter", "book_category")
opts("book_fund", "book_appropriation")
for fy in ("book_fiscalyear", "book_newfiscalyear"):
    opts("book_fund", fy)
