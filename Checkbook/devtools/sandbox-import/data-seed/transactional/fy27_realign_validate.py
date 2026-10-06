#!/usr/bin/env python3
"""End-to-end validation of the FY27 PF-granular realignment (same-Fund/SAG, State path).

Moves $100k of a Prioritization Funding from Prio-A (REQ-TX-FY27-P, on G3 LOA) to a new
credit Prioritization C via a book_realignmentitem, then drives State approval so
RealignmentProcessor executes. Verifies PF amounts, RF.TDP, Prio/RF rollups, and LOA remaining.

Same-Fund/SAG (both RFs on G3-206510D27-111) → State approval only, no ledger, no distributions.
Not idempotent (creates Req/RF/Prio/Realignment); clean up before re-running."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, TYPE_STATE, MODE_STATE, APPROVED = 2027, 4, 0, 0, 0
SP_USER = "3f90bd45-7cbe-f111-aaaf-70a8a5af378b"
CHECKBOOK_ADMIN_ROLE = "14ee21c6-2121-f011-998a-001dd805b842"
AMOUNT = 100000

def ref(entity, attr, es, gid):
    nav = dvapi.navprop(entity, attr)
    if not nav: raise SystemExit("no nav prop for %s.%s" % (entity, attr))
    return {"%s@odata.bind" % nav: "/%s(%s)" % (es, gid)}

def rid(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit("NOT FOUND %s '%s'" % (es, name))
    return g

def one(es, flt, select):
    r = dvapi.query(es, **{"$select": select, "$filter": flt})
    return r[0] if r else None

# 0) SP needs a Book role for the approval gate (admin bypass). Idempotent.
roles = dvapi.get("systemusers(%s)?$select=systemuserid&$expand=systemuserroles_association($select=roleid)" % SP_USER)
has_admin = any(r.get("roleid") == CHECKBOOK_ADMIN_ROLE for r in roles.get("systemuserroles_association", []))
if not has_admin:
    dvapi._req("POST", "systemusers(%s)/systemuserroles_association/$ref" % SP_USER,
               {"@odata.id": "%s/api/data/v9.2/roles(%s)" % (dvapi.ORG, CHECKBOOK_ADMIN_ROLE)})
    print("assigned Book - Checkbook Administrator to SP")
else:
    print("SP already has Checkbook Administrator")

# 1) resolve existing debit side
prioA = one("book_prioritizations", "book_name eq 'FY2027-Texas-A18TX-REQ-TX-FY27-P'",
            "book_prioritizationid,book_newfundedamounttdp")
pfA = one("book_prioritizationfundings", "_book_prioritization_value eq %s" % prioA["book_prioritizationid"],
          "book_prioritizationfundingid,book_fundedamount")
rfA = rid("book_requirementfundings", "G3-206510D27-111-TRNG-CON-REQ-TX-FY27-P")
g3 = rid("book_fundinglines", "G3-206510D27-111-TRNG-CON")
print("Prio-A funded=%s  PF-A funded=%s" % (prioA.get("book_newfundedamounttdp"), pfA.get("book_fundedamount")))

# 2) credit side: Requirement C -> RF-C (on G3, same Fund/SAG) -> Prio-C (status 4)
reqC = dvapi.post("book_requirementses", {
    "book_name": "REQ-TX-FY27-RC", "book_type": TYPE_STATE, "book_pomstatus": False,
    "book_statutoryjustification": "FY27 realignment credit target (dev validation).",
    **ref("book_requirements", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_requirements", "book_ape", "book_apes", rid("book_apes", "APE000004")),
})
rfC = dvapi.post("book_requirementfundings", {
    "book_name": "RF-TX-FY27-RC", "book_newfiscalyear": FY, "book_newtdp": 0,
    **ref("book_requirementfunding", "book_requirement", "book_requirementses", reqC),
    **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", g3),
    **ref("book_requirementfunding", "book_ape", "book_apes", rid("book_apes", "APE000004")),
})
prioC = dvapi.post("book_prioritizations", {
    "book_name": "PRI-TX-FY27-RC", "book_newfiscalyear": FY, "book_approvalstatus": FINAL_APPROVED,
    "book_quantities": 1, "book_statutoryjustification": "FY27 realignment credit (dev validation).",
    **ref("book_prioritization", "book_requirement", "book_requirementses", reqC),
    **ref("book_prioritization", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_prioritization", "book_state", "book_states", rid("book_states", "Texas")),
})
print("created Req-C/RF-C/Prio-C:", bool(reqC), bool(rfC), bool(prioC))

# 3) realignment (item-based, State entry mode) + one item (debit PF-A -> credit RF-C)
realign = dvapi.post("book_realignmentses", {
    "book_name": "REALIGN-VAL-001", "book_fiscalyear": FY, "book_realignmententrymode": MODE_STATE,
    **ref("book_realignments", "book_debitedprioritization", "book_prioritizations", prioA["book_prioritizationid"]),
    **ref("book_realignments", "book_creditedprioritization", "book_prioritizations", prioC),
})
item = dvapi.post("book_realignmentitems", {
    "book_newamount": AMOUNT,
    **ref("book_realignmentitem", "book_realignment", "book_realignmentses", realign),
    **ref("book_realignmentitem", "book_debitprioritizationfunding", "book_prioritizationfundings", pfA["book_prioritizationfundingid"]),
    **ref("book_realignmentitem", "book_creditrequirementfunding", "book_requirementfundings", rfC),
})
print("created realignment + item:", bool(realign), bool(item))

# 4) verify derived fields + parent rollup
it = dvapi.get("book_realignmentitems(%s)?$select=book_name,book_samefundandsag,_book_fund_value,_book_sag_value,_book_debitstate_value" % item)
rl = dvapi.get("book_realignmentses(%s)?$select=book_totalamount,book_itemcount,book_allsamefundsag" % realign)
print("  item: name=%s sameFundSAG=%s fund=%s sag=%s debitState=%s" % (
    it.get("book_name"), it.get("book_samefundandsag"),
    (it.get("_book_fund_value") or "")[:8], (it.get("_book_sag_value") or "")[:8], (it.get("_book_debitstate_value") or "")[:8]))
print("  parent rollup: total=%s itemcount=%s allSameFundSAG=%s" % (
    rl.get("book_totalamount"), rl.get("book_itemcount"), rl.get("book_allsamefundsag")))

def snapshot(label):
    a = dvapi.get("book_prioritizations(%s)?$select=book_newfundedamounttdp" % prioA["book_prioritizationid"])
    pa = dvapi.get("book_prioritizationfundings(%s)?$select=book_fundedamount" % pfA["book_prioritizationfundingid"])
    ra = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp,book_newfundedamount" % rfA)
    c = dvapi.get("book_prioritizations(%s)?$select=book_newfundedamounttdp" % prioC)
    rc = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp,book_newfundedamount" % rfC)
    g = dvapi.get("book_fundinglines(%s)?$select=book_newtdpremaining" % g3)
    pc = dvapi.query("book_prioritizationfundings", **{"$select": "book_fundedamount", "$filter": "_book_prioritization_value eq %s" % prioC})
    print("\n--- %s ---" % label)
    print("  Prio-A funded=%s | PF-A=%s | RF-A tdp=%s funded=%s" % (
        a.get("book_newfundedamounttdp"), pa.get("book_fundedamount"), ra.get("book_newtdp"), ra.get("book_newfundedamount")))
    print("  Prio-C funded=%s | PF-C=%s | RF-C tdp=%s funded=%s" % (
        c.get("book_newfundedamounttdp"), [x.get("book_fundedamount") for x in pc], rc.get("book_newtdp"), rc.get("book_newfundedamount")))
    print("  G3 LOA remaining=%s" % g.get("book_newtdpremaining"))

snapshot("BEFORE approval")

# 5) drive State approval -> RealignmentValidator (role gate + shape + stamps) -> RealignmentProcessor
dvapi.patch("book_realignmentses", realign, {"book_newstateapproved": APPROVED})

snapshot("AFTER approval")
rstate = dvapi.get("book_realignmentses(%s)?$select=statecode,book_newstateapproved" % realign)
print("  Realignment statecode=%s (1=Inactive/processed) stateApproved=%s" % (
    rstate.get("statecode"), rstate.get("book_newstateapproved")))
print("\nExpected: Prio-A 450k, PF-A 450k, RF-A tdp 500k/funded 450k; Prio-C 100k, PF-C 100k, RF-C tdp 100k/funded 100k; G3 rem 400k; statecode 1")
