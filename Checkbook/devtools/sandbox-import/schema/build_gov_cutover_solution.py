#!/usr/bin/env python3
"""Build the focused ARNGCheckbookFY27Cutover solution in the sandbox for import into
a gov environment that sits at the prod baseline (ARNGCheckbook 1.11.0.119).

Contents = everything the sandbox gained over that baseline that a solution can carry
(derived by diffing a sandbox ARNGCheckbook export against src/ARNGCheckbook, 2026-10-25):
  - 9 new FY27 tables (all columns, forms, views, relationships)
  - new / relaxed columns on book_realignments, book_swapitem, book_turninitems, book_turnin
  - the FY27 main forms for Realignments (3), State Swap, Turn-In
  - form libraries book_StateSwaps, book_TurnIns
  - book_CastVote Custom API (+ request params / response props)
  - Checkbook_Plugins assembly + every step registered on its plugin types (+ images)
NOT included (manual — see dist/GOV-CUTOVER-FY27.md): security roles, field security
profile, PCF controls (ARNGCheckbookExtensions zip), env var values, flow deactivation.

Idempotent: reuses the solution if it exists; AddSolutionComponent is a no-op for a
component already in it.
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/build_gov_cutover_solution.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

SOLUTION = "ARNGCheckbookFY27Cutover"
ASSEMBLY_ID = "6836b59c-ded0-4517-b69b-37233137a49c"  # Checkbook_Plugins (same id in gov)

NEW_TABLES = [
    "book_realignmentitem", "book_realignmentdetailreduction", "book_realignmentdetailincrease",
    "book_realignmentrdfreduction", "book_realignmentrdfincrease",
    "book_swapdetailreduction", "book_swapdetailincrease",
    "book_turnindetailreduction", "book_turninrdfreduction",
]
COLUMNS = {
    "book_realignments": ["book_allsamefundsag", "book_itemcount", "book_newfiscalyear",
                          "book_realignmententrymode", "book_totalamount",
                          # required -> none
                          "book_fund", "book_newamount", "book_newcreditedloa", "book_newdebitedloa"],
    "book_swapitem": ["book_creditprioritizationfunding", "book_debitprioritizationfunding"],
    "book_turninitems": ["book_afpamount", "book_afpoverridden", "book_allotmentamount",
                         "book_allotmentoverridden", "book_prioritizationfunding"],
    "book_turnin": ["book_fund", "book_pg"],  # required -> none
}
FORMS = {
    "af33228b-9095-f011-b4cc-001dd8059413": "Realignments: Realign Requirement",
    "bb62adac-1c0b-46fc-a228-a0ba352a2cc4": "Realignments: Information",
    "cb6e89b0-2464-f111-a824-001dd8204135": "Realignments: Realign Admin",
    "85b06e0e-1d55-4b3c-9a07-5b191e0396c5": "State Swap: Information",
    "676d1438-a523-497d-8ae4-261b007eb4bc": "Turn-In: Turn-In",
}
WEB_RESOURCES = ["book_StateSwaps", "book_TurnIns"]
CUSTOM_APIS = ["book_CastVote"]

ENTITY, ATTRIBUTE, RELATIONSHIP, FORM, WEBRESOURCE, ASSEMBLY, STEP = 1, 2, 10, 60, 61, 91, 92

def otc(logical):
    return dvapi.get(f"EntityDefinitions(LogicalName='{logical}')?$select=ObjectTypeCode")["ObjectTypeCode"]

def add(cid, ctype, label, subcomponents=True):
    dvapi.action("AddSolutionComponent", {
        "ComponentId": cid, "ComponentType": ctype, "SolutionUniqueName": SOLUTION,
        "AddRequiredComponents": False, "DoNotIncludeSubcomponents": not subcomponents,
    })
    print(f"  + [{ctype}] {label}")

def entity_meta(logical):
    return dvapi.get(f"EntityDefinitions(LogicalName='{logical}')?$select=MetadataId")["MetadataId"]

# ---- solution ------------------------------------------------------------
pub = dvapi.query("publishers", **{"$select": "publisherid", "$filter": "customizationprefix eq 'book'"})
if not pub:
    raise SystemExit("book publisher not found")
if not dvapi.query("solutions", **{"$select": "solutionid", "$filter": f"uniquename eq '{SOLUTION}'"}):
    dvapi.post("solutions", {
        "uniquename": SOLUTION, "friendlyname": "ARNG Checkbook FY27 Cutover", "version": "1.0.0.0",
        "description": "FY27 Realignment, Turn-In, State Swap and Ticket board components for gov cutover",
        "publisherid@odata.bind": f"/publishers({pub[0]['publisherid']})",
    })
    print("+ solution", SOLUTION)
else:
    print("solution exists:", SOLUTION)

print("New tables:")
for t in NEW_TABLES:
    add(entity_meta(t), ENTITY, t)

print("Columns on existing tables:")
for t, cols in COLUMNS.items():
    add(entity_meta(t), ENTITY, t + " (shell, no subcomponents)", subcomponents=False)
    for c in cols:
        a = dvapi.get(f"EntityDefinitions(LogicalName='{t}')/Attributes(LogicalName='{c}')?$select=MetadataId,AttributeType")
        add(a["MetadataId"], ATTRIBUTE, f"{t}.{c}")
        if a["AttributeType"] == "Lookup":
            rels = dvapi.get(f"EntityDefinitions(LogicalName='{t}')/ManyToOneRelationships"
                             f"?$select=MetadataId,SchemaName,ReferencingAttribute")["value"]
            for r in rels:
                if r["ReferencingAttribute"] == c:
                    add(r["MetadataId"], RELATIONSHIP, r["SchemaName"])

print("Forms:")
for fid, label in FORMS.items():
    add(fid, FORM, label)

print("Web resources:")
for n in WEB_RESOURCES:
    w = dvapi.query("webresourceset", **{"$select": "webresourceid", "$filter": f"name eq '{n}'"})
    add(w[0]["webresourceid"], WEBRESOURCE, n)

print("Plugin assembly + steps:")
# pac plugin push never creates plugintype rows for new classes; make sure every
# class gov needs exists so it rides along with the assembly component.
for tn in ["Checkbook.Plugins.Admin.ToggleSpendPlanLockPlugin",
           "Checkbook.Plugins.Validation.SpendPlanEditLockGuard",
           "Checkbook.Plugins.Tickets.CastVotePlugin"]:
    if not dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": f"typename eq '{tn}'"}):
        dvapi.post("plugintypes", {"typename": tn, "name": tn, "friendlyname": tn.rsplit(".", 1)[1],
                                   "pluginassemblyid@odata.bind": f"/pluginassemblies({ASSEMBLY_ID})"})
        print("  + plugintype", tn)
add(ASSEMBLY_ID, ASSEMBLY, "Checkbook_Plugins")
types = dvapi.query("plugintypes", **{"$select": "plugintypeid",
                                      "$filter": f"_pluginassemblyid_value eq {ASSEMBLY_ID}"})
nsteps, failed = 0, []
for t in types:
    for s in dvapi.query("sdkmessageprocessingsteps", **{"$select": "sdkmessageprocessingstepid,name",
                                                         "$filter": f"_eventhandler_value eq {t['plugintypeid']}"}):
        if s["name"].startswith("CustomApi '"):
            continue  # auto-generated implementation step; travels with its Custom API
        try:
            dvapi.action("AddSolutionComponent", {
                "ComponentId": s["sdkmessageprocessingstepid"], "ComponentType": STEP,
                "SolutionUniqueName": SOLUTION, "AddRequiredComponents": False,
                "DoNotIncludeSubcomponents": False})
            nsteps += 1
        except RuntimeError as e:
            failed.append((s["name"], s["sdkmessageprocessingstepid"], str(e)[-160:]))
print(f"  + [{STEP}] {nsteps} steps")
for f in failed:
    print("  ! step FAILED:", *f)

print("Custom APIs:")
api_type = otc("customapi")
for n in CUSTOM_APIS:
    a = dvapi.query("customapis", **{"$select": "customapiid", "$filter": f"uniquename eq '{n}'"})
    add(a[0]["customapiid"], api_type, n)
print("DONE.")
