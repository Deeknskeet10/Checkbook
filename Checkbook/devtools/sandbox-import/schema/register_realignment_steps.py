#!/usr/bin/env python3
"""Register SDK message processing steps (+ images) in the sandbox for the plugins
that have no steps after the repo-HEAD push:
  - Realignments.RealignmentItemDerivedFields   (PreOp Create/Update of book_realignmentitem)
  - Realignments.RealignmentRollup              (PostOp Create/Update/Delete of book_realignmentitem)
  - Validation.RequirementFundingTDPLock        (PreOp Update of book_requirementfunding; repo-corrected
                                                 filter book_newtdp — the gov step filtered book_newfundedamount)
  - Validation.SpendPlanValidator           (PreOp Create + Update of book_spendplan; captured config)
Idempotent: skips a step whose name already exists."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

SP_FILTER = ("book_newapril,book_newaugust,book_newdecember,book_newfebruary,book_newfiscalyear,"
             "book_fund,book_fundcenter,book_fundedamount,book_newjanuary,book_newjuly,book_newjune,"
             "book_newmarch,book_newmay,book_newnovember,book_newoctober,book_prioritization,"
             "book_prioritizationfunding,book_requirementfunding,book_rowtype,book_sag,"
             "book_newseptember,book_state,statecode")

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
RI = "book_realignmentitem"
RID_FILTER = ("book_debitprioritizationfunding,book_debitrequirementdetailfunding,"
              "book_debitrequirementfunding,book_creditrequirementfunding,book_newamount")

print("RealignmentItemDerivedFields:")
register("Checkbook.Plugins.Realignments.RealignmentItemDerivedFields", "Create", RI, PRE, SYNC, 1)
register("Checkbook.Plugins.Realignments.RealignmentItemDerivedFields", "Update", RI, PRE, SYNC, 1,
         filt=RID_FILTER, image_attrs=RID_FILTER)

print("RealignmentRollup:")
register("Checkbook.Plugins.Realignments.RealignmentRollup", "Create", RI, POST, SYNC, 1)
register("Checkbook.Plugins.Realignments.RealignmentRollup", "Update", RI, POST, SYNC, 1,
         filt="book_newamount,book_samefundandsag,book_realignment,statecode", image_attrs="book_realignment")
register("Checkbook.Plugins.Realignments.RealignmentRollup", "Delete", RI, POST, SYNC, 1,
         image_attrs="book_realignment")

print("RequirementFundingTDPLock (repo-corrected filter book_newtdp):")
register("Checkbook.Plugins.Validation.RequirementFundingTDPLock", "Update", "book_requirementfunding",
         PRE, SYNC, 10, filt="book_newtdp", image_attrs="book_newtdp")

print("SpendPlanValidator:")
register("Checkbook.Plugins.Validation.SpendPlanValidator", "Create", "book_spendplan", PRE, SYNC, 1)
register("Checkbook.Plugins.Validation.SpendPlanValidator", "Update", "book_spendplan", PRE, SYNC, 1,
         filt=SP_FILTER, image_attrs=SP_FILTER)
print("DONE.")
