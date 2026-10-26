#!/usr/bin/env python3
"""Register the FY27 State Swap plugin steps in the sandbox (docs/StateSwap-FY27-Redesign.md §5.2):
  - StateSwaps.SwapLineLock               (PreOp Create/Update/Delete of book_swapitem + both detail tables)
  - StateSwaps.SwapItemAutoSharePlugin    (PostOp Create of book_swapdetailreduction / book_swapdetailincrease)
  - StateSwaps.SwapItemDerivedFieldsPlugin Update step: add the two PF lookups to the filtering
    attributes and the PreImage (existing step, patched in place).
SwapValidator / SwapApprovalPlugin / SwapRollupPlugin need no registration change (they read the
FY and the PF lookups themselves). Idempotent. Same helpers as register_turnin_fy27_steps.py.

Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/register_swap_fy27_steps.py
"""
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
    # pac plugin push does not create plugintype records for new classes.
    dvapi.post("plugintypes", {
        "typename": typename, "name": typename,
        "friendlyname": typename.rsplit(".", 1)[1],
        "pluginassemblyid@odata.bind": "/pluginassemblies(%s)" % ASSEMBLY_ID,
    })
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

def add_attrs(csv, extra):
    have = [a for a in (csv or "").split(",") if a]
    return ",".join(have + [a for a in extra if a not in have])

PRE, POST, SYNC = 20, 40, 0
SI, DR, DI = "book_swapitem", "book_swapdetailreduction", "book_swapdetailincrease"
NS = "Checkbook.Plugins.StateSwaps."

print("SwapLineLock:")
for table in (SI, DR, DI):
    register(NS + "SwapLineLock", "Create", table, PRE, SYNC, 1)
    register(NS + "SwapLineLock", "Update", table, PRE, SYNC, 1, image_attrs="book_stateswap")
    register(NS + "SwapLineLock", "Delete", table, PRE, SYNC, 1, image_attrs="book_stateswap")

print("SwapItemAutoSharePlugin (detail tables):")
for table in (DR, DI):
    register(NS + "SwapItemAutoSharePlugin", "Create", table, POST, SYNC, 1)

print("SwapItemDerivedFieldsPlugin Update step (+ PF lookups):")
PF_ATTRS = ["book_debitprioritizationfunding", "book_creditprioritizationfunding"]
pid = type_id(NS + "SwapItemDerivedFieldsPlugin")
upd_filter = filter_id("Update", SI)
steps = dvapi.query("sdkmessageprocessingsteps", **{
    "$select": "sdkmessageprocessingstepid,name,filteringattributes",
    "$filter": "_eventhandler_value eq %s and _sdkmessagefilterid_value eq %s" % (pid, upd_filter)})
if not steps:
    raise SystemExit("SwapItemDerivedFieldsPlugin Update step not found")
for s in steps:
    new_filt = add_attrs(s.get("filteringattributes"), PF_ATTRS)
    if new_filt != s.get("filteringattributes"):
        dvapi.patch("sdkmessageprocessingsteps", s["sdkmessageprocessingstepid"], {"filteringattributes": new_filt})
        print("  filter ->", new_filt)
    else:
        print("  filter already has the PF lookups")
    for img in dvapi.query("sdkmessageprocessingstepimages", **{
            "$select": "sdkmessageprocessingstepimageid,attributes,name,entityalias,imagetype",
            "$filter": "_sdkmessageprocessingstepid_value eq %s" % s["sdkmessageprocessingstepid"]}):
        new_img = add_attrs(img.get("attributes"), PF_ATTRS)
        if new_img == img.get("attributes"):
            print("  PreImage already has the PF lookups"); continue
        # PATCH of an existing step image's attributes fails with 0x80040216 in Dataverse;
        # delete + recreate it with the same name / alias instead.
        dvapi.delete("sdkmessageprocessingstepimages", img["sdkmessageprocessingstepimageid"])
        dvapi.post("sdkmessageprocessingstepimages", {
            "name": img["name"], "entityalias": img["entityalias"], "imagetype": img["imagetype"],
            "messagepropertyname": "Target", "attributes": new_img,
            "sdkmessageprocessingstepid@odata.bind": "/sdkmessageprocessingsteps(%s)" % s["sdkmessageprocessingstepid"],
        })
        print("  PreImage ->", new_img)
print("DONE.")
