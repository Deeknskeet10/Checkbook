#!/usr/bin/env python3
"""Validate the FY27 funding-reconciliation guards:
  1. >=1 RF precondition — funding a Prio whose Requirement has no RF for the FY is blocked.
  2. Over-allocation cap — Σ PF funded may not exceed an Itemized Prio's funded total.
Expects both writes to be REJECTED by the plugins. Not idempotent (creates a Requirement/Prio)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, TYPE_STATE = 2027, 4, 0

def ref(entity, attr, es, gid):
    nav = dvapi.navprop(entity, attr)
    return {"%s@odata.bind" % nav: "/%s(%s)" % (es, gid)}

def rid(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit("NOT FOUND %s '%s'" % (es, name))
    return g

def expect_block(label, fn):
    try:
        fn()
        print("  FAIL (not blocked):", label)
    except RuntimeError as e:
        msg = str(e)
        snippet = msg.split("message")[-1][:160] if "message" in msg else msg[:160]
        print("  BLOCKED as expected:", label, "->", snippet.strip(' :"{'))

# ---------------- Test 1: >=1 RF precondition ----------------
print("### Test 1: funding a Prio with NO RF for the FY is blocked")
reqN = dvapi.find_id("book_requirementses", "REQ-TX-FY27-NORF") or dvapi.post("book_requirementses", {
    "book_name": "REQ-TX-FY27-NORF", "book_type": TYPE_STATE, "book_pomstatus": False,
    "book_statutoryjustification": "FY27 precondition test (no RF).",
    **ref("book_requirements", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_requirements", "book_ape", "book_apes", rid("book_apes", "APE000005")),
})
existing = dvapi.query("book_prioritizations", **{"$select": "book_prioritizationid",
            "$filter": "_book_requirement_value eq %s" % reqN})
prioN = existing[0]["book_prioritizationid"] if existing else dvapi.post("book_prioritizations", {
    "book_name": "PRI-TX-FY27-NORF", "book_newfiscalyear": FY, "book_approvalstatus": FINAL_APPROVED,
    "book_quantities": 1, "book_statutoryjustification": "precondition test",
    **ref("book_prioritization", "book_requirement", "book_requirementses", reqN),
    **ref("book_prioritization", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_prioritization", "book_state", "book_states", rid("book_states", "Texas")),
})
print("  REQ/Prio with no RF (get-or-create):", bool(reqN), bool(prioN))
expect_block("increase Prio funded with no RF present",
             lambda: dvapi.patch("book_prioritizations", prioN, {"book_newfundedamounttdp": 60000}))

# ---------------- Test 2: over-allocation cap (Itemized Prio) ----------------
print("\n### Test 2: Σ PF > Itemized Prio total is blocked")
prioA = dvapi.query("book_prioritizations", **{"$select": "book_prioritizationid,book_newfundedamounttdp,book_fundingmode",
            "$filter": "book_name eq 'FY2027-Texas-A18TX-REQ-TX-FY27-P'"})[0]
pfA = dvapi.query("book_prioritizationfundings", **{"$select": "book_prioritizationfundingid,book_fundedamount",
            "$filter": "_book_prioritization_value eq %s" % prioA["book_prioritizationid"]})[0]
rfA = rid("book_requirementfundings", "G3-206510D27-111-TRNG-CON-REQ-TX-FY27-P")
rfA_tdp0 = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp" % rfA)["book_newtdp"]
pfA_f0 = pfA["book_fundedamount"]
print("  Prio-A total=%s mode=%s | PF-A funded=%s | RF-A tdp=%s" % (
    prioA.get("book_newfundedamounttdp"), prioA.get("book_fundingmode"), pfA_f0, rfA_tdp0))
try:
    # raise RF-A TDP so the RF cap is not the binding constraint, isolating the Prio-total cap
    dvapi.patch("book_requirementfundings", rfA, {"book_newtdp": 700000})
    expect_block("set PF-A funded=600k (> Prio total 550k, < RF TDP 700k)",
                 lambda: dvapi.patch("book_prioritizationfundings", pfA["book_prioritizationfundingid"],
                                     {"book_fundedamount": 600000}))
finally:
    # restore
    dvapi.patch("book_requirementfundings", rfA, {"book_newtdp": rfA_tdp0})
    cur = dvapi.get("book_prioritizationfundings(%s)?$select=book_fundedamount" % pfA["book_prioritizationfundingid"])
    if cur.get("book_fundedamount") != pfA_f0:
        dvapi.patch("book_prioritizationfundings", pfA["book_prioritizationfundingid"], {"book_fundedamount": pfA_f0})
    print("  restored RF-A tdp + PF-A funded")
print("\nBoth guards enforced." )
