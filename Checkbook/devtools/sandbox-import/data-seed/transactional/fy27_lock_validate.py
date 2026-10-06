#!/usr/bin/env python3
"""Validate increase-only funded locks (book_LockManualFundedEdits = yes):
  1. Direct reduction of an ItemizedDetail funded -> BLOCKED.
  2. Direct reduction of a PrioritizationFunding funded -> BLOCKED.
  3. A Realignment still reduces funded (authorized ancestor bypass) -> ALLOWED.
Confirms only Realignments/Turn-Ins/State-Swaps can deduct."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, MODE_STATE, APPROVED = 2027, 4, 0, 0

def ref(entity, attr, es, gid):
    return {"%s@odata.bind" % dvapi.navprop(entity, attr): "/%s(%s)" % (es, gid)}
def rid(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit("NOT FOUND %s '%s'" % (es, name))
    return g
def one(es, flt, select):
    r = dvapi.query(es, **{"$select": select, "$filter": flt}); return r[0] if r else None
def expect_block(label, fn):
    try:
        fn(); print("  FAIL (not blocked):", label)
    except RuntimeError as e:
        m = str(e); print("  BLOCKED:", label, "->", (m.split("message")[-1][:120]).strip(' :"{'))

prioA = one("book_prioritizations", "book_name eq 'FY2027-Texas-A18TX-REQ-TX-FY27-P'",
            "book_prioritizationid")["book_prioritizationid"]
pfA = one("book_prioritizationfundings", "_book_prioritization_value eq %s" % prioA,
          "book_prioritizationfundingid,book_fundedamount")
det = one("book_itemizeddetailses", "_book_prioritization_value eq %s" % prioA,
          "book_itemizeddetailsid,book_fundedamount,book_name")

print("### Test 1: direct reduce ItemizedDetail funded -> blocked")
print("  detail %s funded=%s" % (det.get("book_name"), det.get("book_fundedamount")))
expect_block("reduce detail funded by 10k",
    lambda: dvapi.patch("book_itemizeddetailses", det["book_itemizeddetailsid"],
                        {"book_fundedamount": det["book_fundedamount"] - 10000}))

print("\n### Test 2: direct reduce PF funded -> blocked")
print("  PF-A funded=%s" % pfA.get("book_fundedamount"))
expect_block("reduce PF funded by 10k",
    lambda: dvapi.patch("book_prioritizationfundings", pfA["book_prioritizationfundingid"],
                        {"book_fundedamount": pfA["book_fundedamount"] - 10000}))

print("\n### Test 3: realignment reduces funded (authorized bypass) -> allowed")
reqC = rid("book_requirementses", "REQ-TX-FY27-RC")
prioC = one("book_prioritizations", "_book_requirement_value eq %s" % reqC, "book_prioritizationid")["book_prioritizationid"]
rfC = one("book_requirementfundings", "_book_requirement_value eq %s" % reqC, "book_requirementfundingid")["book_requirementfundingid"]
pfA_before = dvapi.get("book_prioritizationfundings(%s)?$select=book_fundedamount" % pfA["book_prioritizationfundingid"])["book_fundedamount"]
realign = dvapi.post("book_realignmentses", {
    "book_name": "REALIGN-LOCK-TEST", "book_fiscalyear": FY, "book_realignmententrymode": MODE_STATE,
    **ref("book_realignments", "book_debitedprioritization", "book_prioritizations", prioA),
    **ref("book_realignments", "book_creditedprioritization", "book_prioritizations", prioC)})
dvapi.post("book_realignmentitems", {"book_newamount": 50000,
    **ref("book_realignmentitem", "book_realignment", "book_realignmentses", realign),
    **ref("book_realignmentitem", "book_debitprioritizationfunding", "book_prioritizationfundings", pfA["book_prioritizationfundingid"]),
    **ref("book_realignmentitem", "book_creditrequirementfunding", "book_requirementfundings", rfC)})
dvapi.patch("book_realignmentses", realign, {"book_newstateapproved": APPROVED})
pfA_after = dvapi.get("book_prioritizationfundings(%s)?$select=book_fundedamount" % pfA["book_prioritizationfundingid"])["book_fundedamount"]
print("  PF-A funded %s -> %s (realignment reduced it by 50k despite lock ON)" % (pfA_before, pfA_after))
print("  %s" % ("PASS" if abs((pfA_before - 50000) - pfA_after) < 0.5 else "UNEXPECTED"))
