#!/usr/bin/env python3
"""Register the FundingRequiresRequirementFundingGuard steps (FY27 funding reconciliation,
decision #7): require >=1 RF for the Prio's (Requirement, FY) before detail/Prio funding.
The over-allocation cap rides on the existing PrioritizationFundingGuard step (no new step).
Idempotent. See docs/Prioritization-Funding-Reconciliation.md."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

ASSEMBLY_ID = "6836b59c-ded0-4517-b69b-37233137a49c"
TYPENAME = "Checkbook.Plugins.Validation.FundingRequiresRequirementFundingGuard"

def msg_id(name):
    r = dvapi.query("sdkmessages", **{"$select": "sdkmessageid", "$filter": "name eq '%s'" % name})
    if not r: raise SystemExit("sdkmessage not found: " + name)
    return r[0]["sdkmessageid"]

def type_id():
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % TYPENAME})
    if r: return r[0]["plugintypeid"]
    dvapi.post("plugintypes", {"typename": TYPENAME, "name": TYPENAME,
                               "friendlyname": TYPENAME.rsplit(".", 1)[1],
                               "pluginassemblyid@odata.bind": "/pluginassemblies(%s)" % ASSEMBLY_ID})
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % TYPENAME})
    print("  + plugintype:", TYPENAME)
    return r[0]["plugintypeid"]

def filter_id(message, entity):
    mid = msg_id(message)
    r = dvapi.query("sdkmessagefilters", **{"$select": "sdkmessagefilterid",
                    "$filter": "primaryobjecttypecode eq '%s' and _sdkmessageid_value eq %s" % (entity, mid)})
    return r[0]["sdkmessagefilterid"] if r else None

def register(pid, entity, filt):
    name = "%s: Update of %s" % (TYPENAME, entity)
    ex = dvapi.query("sdkmessageprocessingsteps", **{"$select": "sdkmessageprocessingstepid",
                     "$filter": "name eq '%s'" % name})
    if ex:
        print("  exists:", name); return
    body = {"name": name, "stage": 20, "mode": 0, "rank": 1, "supporteddeployment": 0,
            "filteringattributes": filt,
            "sdkmessageid@odata.bind": "/sdkmessages(%s)" % msg_id("Update"),
            "eventhandler_plugintype@odata.bind": "/plugintypes(%s)" % pid}
    fid = filter_id("Update", entity)
    if fid:
        body["sdkmessagefilterid@odata.bind"] = "/sdkmessagefilters(%s)" % fid
    dvapi.post("sdkmessageprocessingsteps", body)
    print("  + step:", name, "filter=", filt)

pid = type_id()
register(pid, "book_itemizeddetails", "book_fundedamount,book_validatedamount")
register(pid, "book_prioritization", "book_newfundedamounttdp,book_validatedamount")
print("DONE.")
