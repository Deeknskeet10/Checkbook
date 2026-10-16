#!/usr/bin/env python3
"""Register the FY27 Turn-In plugin steps in the sandbox (docs/TurnIn-FY27-Redesign.md):
  - TurnIns.TurnInItemAmountCalculator  (PreOp Create/Update of book_turninitems)
  - TurnIns.TurnInItemRollup            (PostOp Create/Update/Delete of book_turninitems)
  - TurnIns.TurnInLineLock              (PreOp Create/Update/Delete of book_turninitems + both reduction tables)
Idempotent: skips a step whose name already exists. Same helpers as register_realignment_steps.py."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

_msg = {}
def msg_id(name):
    if name in _msg: return _msg[name]
    r = dvapi.query("sdkmessages", **{"$select": "sdkmessageid", "$filter": "name eq '%s'" % name})
    if not r: raise SystemExit("sdkmessage not found: " + name)
    _msg[name] = r[0]["sdkmessageid"]; return _msg[name]

ASSEMBLY_ID = "6836b59c-ded0-4517-b69b-37233137a49c"  # Checkbook_Plugins
def type_id(typename):
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % typename})
    if r:
        return r[0]["plugintypeid"]
    # pac plugin push updates the assembly binary but does not create plugintype
    # records for new classes — create it (bound to the assembly) so steps can attach.
    dvapi.post("plugintypes", {
        "typename": typename, "name": typename,
        "friendlyname": typename.rsplit(".", 1)[1],
        "pluginassemblyid@odata.bind": "/pluginassemblies(%s)" % ASSEMBLY_ID,
    })
    # Re-query for the authoritative id (POST's header/body extraction is unreliable here).
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % typename})
    print("  + plugintype:", typename)
    return r[0]["plugintypeid"]

def filter_id(message, entity):
    mid = msg_id(message)
    r = dvapi.query("sdkmessagefilters",
                    **{"$select": "sdkmessagefilterid",
                       "$filter": "primaryobjecttypecode eq '%s' and _sdkmessageid_value eq %s" % (entity, mid)})
    return r[0]["sdkmessagefilterid"] if r else None

def step_exists(name):
    r = dvapi.query("sdkmessageprocessingsteps", **{"$select": "sdkmessageprocessingstepid",
                                                    "$filter": "name eq '%s'" % name.replace("'", "''")})
    return r[0]["sdkmessageprocessingstepid"] if r else None

def register(typename, message, entity, stage, mode, rank, filt=None, image_attrs=None):
    pid = type_id(typename)
    name = "%s: %s of %s" % (typename, message, entity)
    existing = step_exists(name)
    if existing:
        print("  exists:", name); return existing
    body = {
        "name": name, "stage": stage, "mode": mode, "rank": rank, "supporteddeployment": 0,
        "sdkmessageid@odata.bind": "/sdkmessages(%s)" % msg_id(message),
        "eventhandler_plugintype@odata.bind": "/plugintypes(%s)" % pid,
    }
    fid = filter_id(message, entity)
    if fid:
        body["sdkmessagefilterid@odata.bind"] = "/sdkmessagefilters(%s)" % fid
    if filt:
        body["filteringattributes"] = filt
    sid = dvapi.post("sdkmessageprocessingsteps", body)
    print("  + step:", name)
    if image_attrs is not None:
        dvapi.post("sdkmessageprocessingstepimages", {
            "name": "PreImage", "entityalias": "PreImage", "imagetype": 0,
            "messagepropertyname": "Target", "attributes": image_attrs,
            "sdkmessageprocessingstepid@odata.bind": "/sdkmessageprocessingsteps(%s)" % sid,
        })
        print("    + PreImage:", image_attrs[:60], "...")
    return sid

PRE, POST, SYNC = 20, 40, 0
TI = "book_turninitems"
CALC = ("book_newturninamount,book_prioritizationfunding,book_requirementfunding,book_turnin,"
        "book_afpoverridden,book_allotmentoverridden")

print("TurnInItemAmountCalculator:")
register("Checkbook.Plugins.TurnIns.TurnInItemAmountCalculator", "Create", TI, PRE, SYNC, 1)
register("Checkbook.Plugins.TurnIns.TurnInItemAmountCalculator", "Update", TI, PRE, SYNC, 1,
         filt=CALC, image_attrs=CALC)

print("TurnInItemRollup:")
register("Checkbook.Plugins.TurnIns.TurnInItemRollup", "Create", TI, POST, SYNC, 2)
register("Checkbook.Plugins.TurnIns.TurnInItemRollup", "Update", TI, POST, SYNC, 2,
         filt="book_newturninamount,book_afpamount,book_allotmentamount,book_turnin,statecode",
         image_attrs="book_turnin")
register("Checkbook.Plugins.TurnIns.TurnInItemRollup", "Delete", TI, POST, SYNC, 2,
         image_attrs="book_turnin")

# TurnInLineLock (2026-10-16): no line edits once a Turn-In is approved / processed / denied.
print("TurnInLineLock:")
for table in (TI, "book_turnindetailreduction", "book_turninrdfreduction"):
    register("Checkbook.Plugins.TurnIns.TurnInLineLock", "Create", table, PRE, SYNC, 1)
    register("Checkbook.Plugins.TurnIns.TurnInLineLock", "Update", table, PRE, SYNC, 1, image_attrs="book_turnin")
    register("Checkbook.Plugins.TurnIns.TurnInLineLock", "Delete", table, PRE, SYNC, 1, image_attrs="book_turnin")
print("DONE.")
