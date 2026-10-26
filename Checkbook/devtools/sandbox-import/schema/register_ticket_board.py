#!/usr/bin/env python3
"""Register the Ticket board's book_CastVote Custom API in the sandbox
(Plugins/Tickets/REGISTRATION.md §2-3):
  - ensure the Checkbook.Plugins.Tickets.CastVotePlugin plugintype exists
    (pac plugin push does not create plugintype records for new classes)
  - create the book_CastVote Custom API (Global action, Plugin Type = CastVotePlugin)
  - create its request parameters (TicketId String, Direction Integer) and
    response properties (NewScore, UserVote Integer)
Push the assembly first (pp-plugin-push / pac plugin push). Idempotent.

Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/register_ticket_board.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

ASSEMBLY_ID = "6836b59c-ded0-4517-b69b-37233137a49c"  # Checkbook_Plugins
TYPENAME = "Checkbook.Plugins.Tickets.CastVotePlugin"
API = "book_CastVote"

# customapirequestparameter / customapiresponseproperty type codes
STRING, INTEGER = 10, 7

def type_id(typename):
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % typename})
    if r:
        print("  exists: plugintype", typename)
        return r[0]["plugintypeid"]
    dvapi.post("plugintypes", {
        "typename": typename, "name": typename,
        "friendlyname": typename.rsplit(".", 1)[1],
        "pluginassemblyid@odata.bind": "/pluginassemblies(%s)" % ASSEMBLY_ID,
    })
    r = dvapi.query("plugintypes", **{"$select": "plugintypeid", "$filter": "typename eq '%s'" % typename})
    print("  + plugintype:", typename)
    return r[0]["plugintypeid"]

def find_api():
    return dvapi.query("customapis", **{"$select": "customapiid,_plugintypeid_value",
                                        "$filter": "uniquename eq '%s'" % API})

def ensure_api(pid):
    r = find_api()
    if r:
        aid = r[0]["customapiid"]
        if r[0].get("_plugintypeid_value") != pid:
            dvapi.patch("customapis", aid, {"PluginTypeId@odata.bind": "/plugintypes(%s)" % pid})
            print("  customapi plugin type re-pointed")
        print("  exists: customapi", API)
        return aid
    # dvapi.post's id sniffing can return solutionid from the representation
    # body for customapi rows, so re-read the new id by uniquename.
    dvapi.post("customapis", {
        "uniquename": API, "name": API, "displayname": "Cast Vote",
        "description": "Toggles the caller vote on a ticket and recomputes its score",
        "bindingtype": 0,                       # Global
        "isfunction": False, "isprivate": False,
        "allowedcustomprocessingsteptype": 0,   # None
        "workflowsdkstepenabled": False,
        "PluginTypeId@odata.bind": "/plugintypes(%s)" % pid,
    })
    aid = find_api()[0]["customapiid"]
    print("  + customapi:", API, aid)
    return aid

def ensure_child(entityset, idfield, aid, name, typ, description, extra=None):
    uniq = name
    r = dvapi.query(entityset, **{"$select": idfield,
                                  "$filter": "uniquename eq '%s' and _customapiid_value eq %s" % (uniq, aid)})
    if r:
        print("  exists: %s %s" % (entityset, name)); return
    body = {"uniquename": uniq, "name": name, "displayname": name,
            "description": description, "type": typ,
            "CustomAPIId@odata.bind": "/customapis(%s)" % aid}
    body.update(extra or {})
    dvapi.post(entityset, body)
    print("  + %s: %s" % (entityset, name))

print("Plugin type:")
pid = type_id(TYPENAME)

print("Custom API:")
aid = ensure_api(pid)

print("Request parameters:")
REQ = ("customapirequestparameters", "customapirequestparameterid")
ensure_child(*REQ, aid, "TicketId", STRING, "GUID of the book_ticket being voted on", {"isoptional": False})
ensure_child(*REQ, aid, "Direction", INTEGER, "1 for upvote, -1 for downvote", {"isoptional": False})

print("Response properties:")
RESP = ("customapiresponseproperties", "customapiresponsepropertyid")
ensure_child(*RESP, aid, "NewScore", INTEGER, "Recomputed ticket score")
ensure_child(*RESP, aid, "UserVote", INTEGER, "Caller resulting vote: -1, 0 or 1")
print("DONE.")
