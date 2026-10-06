#!/usr/bin/env python3
"""Which Checkbook plugin steps are actually registered/active in this sandbox?
Determines whether FY27 rollups/guards (and thus turn-ins/realignments/swaps) fire."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

# funding-mode choice interpretation
try:
    j = dvapi.get("EntityDefinitions(LogicalName='book_prioritization')/Attributes(LogicalName='book_fundingmode')"
                  "/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet($select=Options)")
    print("book_fundingmode options:",
          [(o["Value"], (o["Label"]["UserLocalizedLabel"] or {}).get("Label"))
           for o in j.get("OptionSet", {}).get("Options", [])])
except Exception as e:
    print("fundingmode meta ERR", str(e)[:80])

# plugin assemblies present
print("\n=== plugin assemblies ===")
for a in dvapi.query("pluginassemblies", **{"$select": "name,version", "$orderby": "name"}):
    if "checkbook" in (a.get("name") or "").lower() or "Checkbook" in (a.get("name") or ""):
        print(f"  {a.get('name')} v{a.get('version')}")

# plugin types (class names) registered
print("\n=== Checkbook plugin types registered ===")
types = dvapi.query("plugintypes", **{"$select": "typename,friendlyname", "$orderby": "typename"})
ck = [t for t in types if "Checkbook.Plugins" in (t.get("typename") or "")]
for t in ck:
    print("  ", t.get("typename"))
print(f"  ({len(ck)} Checkbook plugin types)")

# active steps, grouped, with message + stage
print("\n=== active SDK steps (Checkbook) ===")
steps = dvapi.query("sdkmessageprocessingsteps",
                    **{"$select": "name,stage,mode,statecode,rank",
                       "$expand": "sdkmessageid($select=name)",
                       "$orderby": "name", "$top": "500"})
STAGE = {10: "PreValidate", 20: "PreOp", 40: "PostOp"}
MODE = {0: "Sync", 1: "Async"}
shown = 0
KEYWORDS = ("Itemized", "Prioritization", "RequirementDetail", "RequirementFunding",
            "TurnIn", "Realignment", "StateSwap", "Swap", "Distribution", "LOA",
            "Rollup", "Recalc", "SingleRf", "AutoAllocate", "FundingTrack",
            "FundingEvent", "FundKey", "Ledger", "Generate")
for s in steps:
    nm = s.get("name") or ""
    if not any(k in nm for k in KEYWORDS):
        continue
    if s.get("statecode") != 0:
        continue
    msg = (s.get("sdkmessageid") or {}).get("name")
    print(f"  [{MODE.get(s.get('mode'),'?'):5s} {STAGE.get(s.get('stage'),'?'):11s} {msg:8s}] {nm}")
    shown += 1
print(f"  ({shown} active relevant steps)")

# explicitly check for the FY27-critical steps by name fragment
print("\n=== FY27-critical step presence ===")
def present(fragment):
    hits = [s for s in steps if fragment in (s.get("name") or "")]
    active = [h for h in hits if h.get("statecode") == 0]
    return len(hits), len(active)
for frag in ("ItemizedDetailsSynchronizer", "PrioritizationItemizedRollup",
             "PrioritizationSingleRfAutoAllocate", "PrioritizationRollupToRequirementFunding",
             "RequirementDetailFundingGuard", "RequirementDetailFundingRollup",
             "PrioritizationFundingRollup", "PrioritizationFundingGuard"):
    tot, act = present(frag)
    print(f"  {frag:42s} total={tot} active={act}")
