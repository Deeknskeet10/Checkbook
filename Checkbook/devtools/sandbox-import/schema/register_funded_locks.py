#!/usr/bin/env python3
"""Register the increase-only FundedAmountLock steps that gate detail/PF funded, and
turn on book_LockManualFundedEdits to match the government environment. Idempotent.
Reductions are then allowed only via Turn-Ins / Realignments / State Swaps / the
Distribution generator (FundedAmountLockBase ancestor-walk bypass)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

ASSEMBLY_ID = "6836b59c-ded0-4517-b69b-37233137a49c"

def msg_id(name):
    r = dvapi.query("sdkmessages", **{"$select": "sdkmessageid", "$filter": "name eq '%s'" % name})
    return r[0]["sdkmessageid"]

def type_id(tn):
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % tn})
    if r: return r[0]["plugintypeid"]
    dvapi.post("plugintypes", {"typename": tn, "name": tn, "friendlyname": tn.rsplit(".", 1)[1],
                               "pluginassemblyid@odata.bind": "/pluginassemblies(%s)" % ASSEMBLY_ID})
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % tn})
    print("  + plugintype:", tn)
    return r[0]["plugintypeid"]

def filter_id(message, entity):
    r = dvapi.query("sdkmessagefilters", **{"$select": "sdkmessagefilterid",
                    "$filter": "primaryobjecttypecode eq '%s' and _sdkmessageid_value eq %s" % (entity, msg_id(message))})
    return r[0]["sdkmessagefilterid"] if r else None

def register_lock(tn, entity):
    name = "%s: Update of %s" % (tn, entity)
    if dvapi.query("sdkmessageprocessingsteps", **{"$select": "sdkmessageprocessingstepid", "$filter": "name eq '%s'" % name}):
        print("  exists:", name); return
    pid = type_id(tn)
    body = {"name": name, "stage": 20, "mode": 0, "rank": 10, "supporteddeployment": 0,
            "filteringattributes": "book_fundedamount",
            "sdkmessageid@odata.bind": "/sdkmessages(%s)" % msg_id("Update"),
            "eventhandler_plugintype@odata.bind": "/plugintypes(%s)" % pid}
    fid = filter_id("Update", entity)
    if fid: body["sdkmessagefilterid@odata.bind"] = "/sdkmessagefilters(%s)" % fid
    sid = dvapi.post("sdkmessageprocessingsteps", body)
    dvapi.post("sdkmessageprocessingstepimages", {
        "name": "PreImage", "entityalias": "PreImage", "imagetype": 0,
        "messagepropertyname": "Target", "attributes": "book_fundedamount",
        "sdkmessageprocessingstepid@odata.bind": "/sdkmessageprocessingsteps(%s)" % sid})
    print("  + step + PreImage:", name)

print("Funded-amount locks:")
register_lock("Checkbook.Plugins.Validation.ItemizedDetailFundedAmountLock", "book_itemizeddetails")
register_lock("Checkbook.Plugins.Validation.PrioritizationFundingFundedAmountLock", "book_prioritizationfunding")

print("Toggle book_LockManualFundedEdits = yes (match gov):")
d = dvapi.query("environmentvariabledefinitions", **{"$select": "environmentvariabledefinitionid",
                "$filter": "schemaname eq 'book_LockManualFundedEdits'"})[0]
did = d["environmentvariabledefinitionid"]
vals = dvapi.query("environmentvariablevalues", **{"$select": "environmentvariablevalueid,value",
                   "$filter": "_environmentvariabledefinitionid_value eq %s" % did})
if vals:
    dvapi.patch("environmentvariablevalues", vals[0]["environmentvariablevalueid"], {"value": "yes"})
    print("  updated value -> yes")
else:
    dvapi.post("environmentvariablevalues", {"value": "yes",
               "EnvironmentVariableDefinitionId@odata.bind": "/environmentvariabledefinitions(%s)" % did})
    print("  created value -> yes")
print("DONE.")
