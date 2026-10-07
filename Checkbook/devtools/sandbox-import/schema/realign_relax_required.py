#!/usr/bin/env python3
"""Relax the legacy ApplicationRequired fields on book_realignments to None so an
FY27 item-based realignment can be saved BEFORE the RealignmentBuilder PCF assembles
its items (the item path carries Fund/SAG/LOA/amount on the child book_realignmentitem
rows, not on the parent). The legacy FY26 single-row path still *uses* these fields —
they are merely no longer mandatory at the table level.

Fields relaxed: book_fund, book_newamount, book_newdebitedloa, book_newcreditedloa.

Must be replicated in gov as part of the FY27 realignment entry redesign.
See docs/Realignment-FY27-Redesign.md §5. Idempotent."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

ENTITY = "book_realignments"
TARGETS = ["book_fund", "book_newamount", "book_newdebitedloa", "book_newcreditedloa"]

for attr in TARGETS:
    full = dvapi.get("EntityDefinitions(LogicalName='%s')/Attributes(LogicalName='%s')" % (ENTITY, attr))
    rl = (full.get("RequiredLevel") or {}).get("Value")
    if rl == "None":
        print("  %s already None" % attr); continue
    # Flip RequiredLevel to None, keeping the attribute's concrete @odata.type.
    body = dict(full)
    body["RequiredLevel"] = {"Value": "None", "CanBeChanged": True,
                             "ManagedPropertyLogicalName": "canmodifyrequirementlevelsettings"}
    dvapi._req("PUT",
               "EntityDefinitions(LogicalName='%s')/Attributes(LogicalName='%s')" % (ENTITY, attr),
               body, {"If-Match": "*", "MSCRM.MergeLabels": "true"})
    print("  %s: %s -> None" % (attr, rl))

print("publishing...")
dvapi.action("PublishAllXml", {})
print("done.")
