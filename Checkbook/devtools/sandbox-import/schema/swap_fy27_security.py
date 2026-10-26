#!/usr/bin/env python3
"""FY27 State Swap security in the sandbox (docs/StateSwap-FY27-Redesign.md §4). Idempotent.

Every root "Book - " role gets, on book_swapdetailreduction and book_swapdetailincrease,
exactly the privileges (verb + depth) it already holds on book_swapitem — State Approver /
State Administrator at User level (records are shared to the counterparty state), Budget
Executor / Read Only at Org Read, Checkbook Administrator at Org everything. Share is
included: SwapItemAutoSharePlugin-style sharing runs as the calling user.

Must be replicated in gov (Security Roles).
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/swap_fy27_security.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi  # noqa: E402

NEW_TABLES = ["book_swapdetailreduction", "book_swapdetailincrease"]
VERBS = ["Create", "Read", "Write", "Delete", "Append", "AppendTo", "Share", "Assign"]
DEPTHS = {0: "Basic", 1: "Local", 2: "Deep", 3: "Global"}


def priv_id(name):
    r = dvapi.query("privileges", **{"$select": "privilegeid", "$filter": "name eq '%s'" % name})
    return r[0]["privilegeid"] if r else None


item_privs = {v: priv_id("prv%sbook_SwapItem" % v) or priv_id("prv%sbook_swapitem" % v) for v in VERBS}
if not item_privs["Read"]:
    raise SystemExit("book_swapitem privileges not found")
new_privs = {(t, v): priv_id("prv%s%s" % (v, t)) for t in NEW_TABLES for v in VERBS}
missing = [k for k, x in new_privs.items() if not x]
if missing:
    raise SystemExit("privileges not found (run swap_fy27_schema.py first): %s" % missing)

roles = dvapi.query("roles", **{"$select": "roleid,name",
                                "$filter": "_parentroleid_value eq null and startswith(name,'Book - ')"})
for role in sorted(roles, key=lambda r: r["name"]):
    rp = dvapi.get("RetrieveRolePrivilegesRole(RoleId=%s)" % role["roleid"]).get("RolePrivileges", [])
    depth_by_priv = {p["PrivilegeId"]: p["Depth"] for p in rp}
    adds, held = [], []
    for v in VERBS:
        d = depth_by_priv.get(item_privs[v])
        if d is None:
            continue
        depth = d if isinstance(d, str) else DEPTHS[d]
        held.append("%s:%s" % (v, depth))
        for t in NEW_TABLES:
            if new_privs[(t, v)] not in depth_by_priv:
                adds.append({"PrivilegeId": new_privs[(t, v)], "Depth": depth})
    if not held:
        continue
    if adds:
        dvapi._req("POST", "roles(%s)/Microsoft.Dynamics.CRM.AddPrivilegesRole" % role["roleid"], {"Privileges": adds})
    print("%-36s +%-2d  (%s)" % (role["name"], len(adds), ", ".join(held)))
print("done.")
