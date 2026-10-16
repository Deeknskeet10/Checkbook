#!/usr/bin/env python3
"""FY27 Turn-In security in the sandbox (docs/TurnIn-FY27-Redesign.md §9). Idempotent.

1. Field security: the "ARNG Checkbook - RIs" profile gets Read + Update on
   book_turnin.book_beapproved, the flag a Resource Integrator / CSOR sets to approve an
   FY27 RF-level Turn-In ("ARNG Checkbook - CSO" already has it).
2. Table privileges: every root role that can create book_turninitems gets the same depth
   for Create / Read / Write / Delete / Append / AppendTo on the two new child tables
   book_turnindetailreduction and book_turninrdfreduction.

Must be replicated in gov (Security > Field Security Profiles; Security Roles).
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/turnin_fy27_security.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi  # noqa: E402

NEW_TABLES = ["book_turnindetailreduction", "book_turninrdfreduction"]
VERBS = ["Create", "Read", "Write", "Delete", "Append", "AppendTo"]
DEPTHS = {0: "Basic", 1: "Local", 2: "Deep", 3: "Global"}

# ---------------------------------------------------------------- 1. field security
prof = dvapi.query("fieldsecurityprofiles", **{"$select": "fieldsecurityprofileid,name",
                                               "$filter": "name eq 'ARNG Checkbook - RIs'"})
if not prof:
    print("RIs field security profile not found — skipped")
else:
    pid = prof[0]["fieldsecurityprofileid"]
    fp = dvapi.query("fieldpermissions", **{
        "$select": "fieldpermissionid,canread,canupdate",
        "$filter": "_fieldsecurityprofileid_value eq %s and entityname eq 'book_turnin' "
                   "and attributelogicalname eq 'book_beapproved'" % pid})
    if fp:
        if fp[0]["canupdate"] != 4 or fp[0]["canread"] != 4:
            dvapi.patch("fieldpermissions", fp[0]["fieldpermissionid"], {"canread": 4, "canupdate": 4})
            print("RIs: book_beapproved -> read + update")
        else:
            print("RIs: book_beapproved already read + update")
    else:
        dvapi.post("fieldpermissions", {
            "entityname": "book_turnin", "attributelogicalname": "book_beapproved",
            "canread": 4, "canupdate": 4, "cancreate": 4,
            "fieldsecurityprofileid@odata.bind": "/fieldsecurityprofiles(%s)" % pid})
        print("RIs: + book_beapproved read + update")

# ---------------------------------------------------------------- 2. table privileges
def priv_id(name):
    r = dvapi.query("privileges", **{"$select": "privilegeid", "$filter": "name eq '%s'" % name})
    return r[0]["privilegeid"] if r else None

item_privs = {v: priv_id("prv%sbook_TurnInItems" % v) or priv_id("prv%sbook_turninitems" % v) for v in VERBS}
new_privs = {(t, v): priv_id("prv%s%s" % (v, t)) for t in NEW_TABLES for v in VERBS}
missing = [k for k, x in new_privs.items() if not x]
if missing:
    raise SystemExit("privileges not found (run turnin_fy27_schema.py first): %s" % missing)

create_item = item_privs["Create"]
roles = dvapi.query("roles", **{"$select": "roleid,name", "$filter": "_parentroleid_value eq null and startswith(name,'Book - ')"})
for role in roles:
    rp = dvapi.get("RetrieveRolePrivilegesRole(RoleId=%s)" % role["roleid"]).get("RolePrivileges", [])
    depth_by_priv = {p["PrivilegeId"]: p["Depth"] for p in rp}
    if create_item not in depth_by_priv:
        continue
    adds = []
    for v in VERBS:
        d = depth_by_priv.get(item_privs[v])
        if d is None:
            continue
        depth = d if isinstance(d, str) else DEPTHS[d]
        for t in NEW_TABLES:
            if new_privs[(t, v)] not in depth_by_priv:
                adds.append({"PrivilegeId": new_privs[(t, v)], "Depth": depth})
    if adds:
        dvapi._req("POST", "roles(%s)/Microsoft.Dynamics.CRM.AddPrivilegesRole" % role["roleid"], {"Privileges": adds})
    print("%-36s +%d privilege(s)" % (role["name"], len(adds)))
print("done.")
