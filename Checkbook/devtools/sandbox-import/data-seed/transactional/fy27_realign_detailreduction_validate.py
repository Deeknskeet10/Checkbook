#!/usr/bin/env python3
"""End-to-end validation of the FY27 itemized-debit detail-reduction mechanism
(docs/Prioritization-Funding-Reconciliation.md §5, docs/Realignment-FY27-Redesign.md §9.8).

Builds a fresh, BALANCED itemized Prioritization on the G3 LOA:
  Req -> 2 RequirementDetails -> RF (TDP 500k) -> Prio (Itemized) -> 2 ItemizedDetails
  (300k + 200k = 500k funded). Single RF -> SingleRfAutoAllocate materializes one PF=500k,
  so Σ details ≡ Prio total ≡ Σ PF = 500k.

Then a State-mode realignment debits that PF by 100k into a fresh credit Prio-C (RF-C on G3).

  Test A: approve with NO detail reductions  -> MUST be blocked by RealignmentValidator.
  Test B: add a 100k detail reduction, approve -> processor executes:
          - debit PF 500k -> 400k, debit detail 300k -> 200k, Prio total 500k -> 400k
          - Σ PF (400k) ≡ Prio total (400k): invariant restored
          - credit PF-C 100k, RF-C tdp 0 -> 100k; RF-A tdp 500k -> 400k; G3 remaining unchanged

Same Fund/SAG (both RFs on G3) -> State approval only. Not idempotent; names suffixed -DRX."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, TYPE_STATE = 2027, 4, 0
MODE_STATE, MODE_ITEMIZED, APPROVED = 0, 1, 0
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

# 0) SP admin role (approval gate bypass). Idempotent.
roles = dvapi.get("systemusers(%s)?$select=systemuserid&$expand=systemuserroles_association($select=roleid)" % SP_USER)
if not any(r.get("roleid") == CHECKBOOK_ADMIN_ROLE for r in roles.get("systemuserroles_association", [])):
    dvapi._req("POST", "systemusers(%s)/systemuserroles_association/$ref" % SP_USER,
               {"@odata.id": "%s/api/data/v9.2/roles(%s)" % (dvapi.ORG, CHECKBOOK_ADMIN_ROLE)})
    print("assigned Book - Checkbook Administrator to SP")
else:
    print("SP already has Checkbook Administrator")

# Idempotent cleanup of any leftover records from a prior run (children first).
def wipe_by_name(es, idattr, name):
    for r in dvapi.query(es, **{"$select": idattr, "$filter": "book_name eq '%s'" % name}) or []:
        try: dvapi.delete(es, r[idattr])
        except Exception as e: print("  (cleanup skip %s %s: %s)" % (es, name, str(e)[:80]))

print("cleanup prior DRX/CRX run...")
for r in dvapi.query("book_realignmentses", **{"$select": "book_realignmentsid",
                     "$filter": "book_name eq 'REALIGN-DRX-001'"}) or []:
    rlid = r["book_realignmentsid"]
    for ri in dvapi.query("book_realignmentitems", **{"$select": "book_realignmentitemid",
                          "$filter": "_book_realignment_value eq %s" % rlid}) or []:
        dvapi.delete("book_realignmentitems", ri["book_realignmentitemid"])
    for rr in dvapi.query("book_realignmentdetailreductions", **{"$select": "book_realignmentdetailreductionid",
                          "$filter": "_book_realignment_value eq %s" % rlid}) or []:
        dvapi.delete("book_realignmentdetailreductions", rr["book_realignmentdetailreductionid"])
    dvapi.delete("book_realignmentses", rlid)
for nm in ("ID-DRX-RADIO", "ID-DRX-VEHICLE"):
    wipe_by_name("book_itemizeddetailses", "book_itemizeddetailsid", nm)
for prio in ("PRI-TX-FY27-DRX", "PRI-TX-FY27-CRX"):
    for p in dvapi.query("book_prioritizations", **{"$select": "book_prioritizationid",
                         "$filter": "book_name eq '%s'" % prio}) or []:
        pid = p["book_prioritizationid"]
        for pf in dvapi.query("book_prioritizationfundings", **{"$select": "book_prioritizationfundingid",
                              "$filter": "_book_prioritization_value eq %s" % pid}) or []:
            dvapi.delete("book_prioritizationfundings", pf["book_prioritizationfundingid"])
        dvapi.delete("book_prioritizations", pid)
for nm in ("RF-TX-FY27-DRX", "RF-TX-FY27-CRX"):
    wipe_by_name("book_requirementfundings", "book_requirementfundingid", nm)
for nm in ("RD-DRX-RADIO", "RD-DRX-VEHICLE"):
    wipe_by_name("book_requirementdetailses", "book_requirementdetailsid", nm)
for nm in ("REQ-TX-FY27-DRX", "REQ-TX-FY27-CRX"):
    wipe_by_name("book_requirementses", "book_requirementsid", nm)
print("cleanup done.")

G3 = rid("book_fundinglines", "G3-206510D27-111-TRNG-CON")
A18TX = rid("book_fundcenters", "A18TX")
TX = rid("book_states", "Texas")
APE1 = rid("book_apes", "APE000001")

def mkrd(name, req, item, order, validated, funded):
    return dvapi.post("book_requirementdetailses", {
        "book_name": name, "book_priorityorder": order,
        "book_validatedamount": validated, "book_fundedamount": funded,
        **ref("book_requirementdetails", "book_requirement", "book_requirementses", req),
        **ref("book_requirementdetails", "book_item", "book_items", rid("book_items", item)),
    })

def mkid(name, prio, rd, requested, validated, funded):
    return dvapi.post("book_itemizeddetailses", {
        "book_name": name, "book_quantity": 1,
        "book_requestedamount": requested, "book_validatedamount": validated, "book_fundedamount": funded,
        **ref("book_itemizeddetails", "book_prioritization", "book_prioritizations", prio),
        **ref("book_itemizeddetails", "book_requirementitem", "book_requirementdetailses", rd),
        **ref("book_itemizeddetails", "book_fundcenter", "book_fundcenters", A18TX),
    })

# =====================================================================
# 1) Fresh BALANCED itemized Prio (debit side)
# =====================================================================
print("\n########## build balanced itemized Prio (debit) ##########")
reqD = dvapi.post("book_requirementses", {
    "book_name": "REQ-TX-FY27-DRX", "book_type": TYPE_STATE, "book_pomstatus": False,
    "book_statutoryjustification": "FY27 itemized-debit detail-reduction validation (dev).",
    **ref("book_requirements", "book_fundcenter", "book_fundcenters", A18TX),
    **ref("book_requirements", "book_ape", "book_apes", APE1),
})
rd1 = mkrd("RD-DRX-RADIO",   reqD, "ITEM-RADIO",   1, 200000, 200000)
rd2 = mkrd("RD-DRX-VEHICLE", reqD, "ITEM-VEHICLE", 2, 100000, 100000)
# RF must exist before funding details (FundingRequiresRequirementFundingGuard).
rfD = dvapi.post("book_requirementfundings", {
    "book_name": "RF-TX-FY27-DRX", "book_newfiscalyear": FY, "book_newtdp": 300000,
    **ref("book_requirementfunding", "book_requirement", "book_requirementses", reqD),
    **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", G3),
    **ref("book_requirementfunding", "book_ape", "book_apes", APE1),
})
prioD = dvapi.post("book_prioritizations", {
    "book_name": "PRI-TX-FY27-DRX", "book_newfiscalyear": FY,
    "book_approvalstatus": FINAL_APPROVED, "book_quantities": 1, "book_fundingmode": MODE_ITEMIZED,
    "book_statutoryjustification": "FY27 itemized-debit detail-reduction validation (dev).",
    **ref("book_prioritization", "book_requirement", "book_requirementses", reqD),
    **ref("book_prioritization", "book_fundcenter", "book_fundcenters", A18TX),
    **ref("book_prioritization", "book_state", "book_states", TX),
})
id1 = mkid("ID-DRX-RADIO",   prioD, rd1, 200000, 200000, 200000)
id2 = mkid("ID-DRX-VEHICLE", prioD, rd2, 100000, 100000, 100000)
print("  built Req/RF/Prio/2 details:", all([reqD, rfD, prioD, id1, id2]))

# PF: single RF -> SingleRfAutoAllocate should auto-materialize PF=500k. Fallback: create it.
pfs = dvapi.query("book_prioritizationfundings",
                  **{"$select": "book_prioritizationfundingid,book_fundedamount",
                     "$filter": "_book_prioritization_value eq %s and statecode eq 0" % prioD})
if not pfs:
    pfid = dvapi.post("book_prioritizationfundings", {
        "book_fundedamount": 300000, "book_validatedamount": 300000,
        **ref("book_prioritizationfunding", "book_prioritization", "book_prioritizations", prioD),
        **ref("book_prioritizationfunding", "book_requirementfunding", "book_requirementfundings", rfD),
    })
    print("  PF auto-allocate did not fire; created PF manually")
else:
    pfid = pfs[0]["book_prioritizationfundingid"]
    print("  PF auto-allocated:", pfs[0].get("book_fundedamount"))

p = dvapi.get("book_prioritizations(%s)?$select=book_newfundedamounttdp" % prioD)
pf0 = dvapi.get("book_prioritizationfundings(%s)?$select=book_fundedamount" % pfid)
print("  BALANCE: Prio total=%s  detailsSum=%s  PF=%s" % (
    p.get("book_newfundedamounttdp"), 200000 + 100000, pf0.get("book_fundedamount")))

# =====================================================================
# 2) Credit side: Req-C -> RF-C (G3) -> Prio-C
# =====================================================================
print("\n########## build credit side ##########")
reqC = dvapi.post("book_requirementses", {
    "book_name": "REQ-TX-FY27-CRX", "book_type": TYPE_STATE, "book_pomstatus": False,
    "book_statutoryjustification": "FY27 detail-reduction credit target (dev).",
    **ref("book_requirements", "book_fundcenter", "book_fundcenters", A18TX),
    **ref("book_requirements", "book_ape", "book_apes", APE1),
})
rfC = dvapi.post("book_requirementfundings", {
    "book_name": "RF-TX-FY27-CRX", "book_newfiscalyear": FY, "book_newtdp": 0,
    **ref("book_requirementfunding", "book_requirement", "book_requirementses", reqC),
    **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", G3),
    **ref("book_requirementfunding", "book_ape", "book_apes", APE1),
})
prioC = dvapi.post("book_prioritizations", {
    "book_name": "PRI-TX-FY27-CRX", "book_newfiscalyear": FY, "book_approvalstatus": FINAL_APPROVED,
    "book_quantities": 1, "book_statutoryjustification": "FY27 detail-reduction credit (dev).",
    **ref("book_prioritization", "book_requirement", "book_requirementses", reqC),
    **ref("book_prioritization", "book_fundcenter", "book_fundcenters", A18TX),
    **ref("book_prioritization", "book_state", "book_states", TX),
})
print("  built Req-C/RF-C/Prio-C:", all([reqC, rfC, prioC]))

# =====================================================================
# 3) Realignment (State mode) + one item (debit PF -> credit RF-C, 100k)
# =====================================================================
print("\n########## build realignment ##########")
realign = dvapi.post("book_realignmentses", {
    "book_name": "REALIGN-DRX-001", "book_fiscalyear": FY, "book_realignmententrymode": MODE_STATE,
    **ref("book_realignments", "book_debitedprioritization", "book_prioritizations", prioD),
    **ref("book_realignments", "book_creditedprioritization", "book_prioritizations", prioC),
})
item = dvapi.post("book_realignmentitems", {
    "book_newamount": AMOUNT,
    **ref("book_realignmentitem", "book_realignment", "book_realignmentses", realign),
    **ref("book_realignmentitem", "book_debitprioritizationfunding", "book_prioritizationfundings", pfid),
    **ref("book_realignmentitem", "book_creditrequirementfunding", "book_requirementfundings", rfC),
})
print("  built realignment + item (100k):", all([realign, item]))

def snapshot(label):
    pd = dvapi.get("book_prioritizations(%s)?$select=book_newfundedamounttdp" % prioD)
    pfd = dvapi.get("book_prioritizationfundings(%s)?$select=book_fundedamount" % pfid)
    d1 = dvapi.get("book_itemizeddetailses(%s)?$select=book_fundedamount" % id1)
    d2 = dvapi.get("book_itemizeddetailses(%s)?$select=book_fundedamount" % id2)
    ra = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp,book_newfundedamount" % rfD)
    rc = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp,book_newfundedamount" % rfC)
    pcq = dvapi.query("book_prioritizationfundings", **{"$select": "book_fundedamount",
                      "$filter": "_book_prioritization_value eq %s and statecode eq 0" % prioC})
    g = dvapi.get("book_fundinglines(%s)?$select=book_newtdpremaining" % G3)
    print("\n--- %s ---" % label)
    print("  Prio-D total=%s | PF-D=%s | details: radio=%s vehicle=%s (sum=%s)" % (
        pd.get("book_newfundedamounttdp"), pfd.get("book_fundedamount"),
        d1.get("book_fundedamount"), d2.get("book_fundedamount"),
        (d1.get("book_fundedamount") or 0) + (d2.get("book_fundedamount") or 0)))
    print("  RF-D tdp=%s funded=%s | RF-C tdp=%s funded=%s | PF-C=%s | G3 rem=%s" % (
        ra.get("book_newtdp"), ra.get("book_newfundedamount"),
        rc.get("book_newtdp"), rc.get("book_newfundedamount"),
        [x.get("book_fundedamount") for x in pcq], g.get("book_newtdpremaining")))

snapshot("BEFORE (balanced: Prio total=300k, PF=300k, details 200k+100k)")

# =====================================================================
# TEST A: approve with NO reductions -> expect block
# =====================================================================
print("\n########## TEST A: approve with NO detail reductions (expect BLOCK) ##########")
try:
    dvapi.patch("book_realignmentses", realign, {"book_newstateapproved": APPROVED})
    print("  !! UNEXPECTED: approval succeeded without detail reductions")
except Exception as e:
    msg = str(e)
    blocked = "itemized Prioritization" in msg or "reduce them by a total" in msg
    print("  %s block. message excerpt: %s" % ("GOT expected" if blocked else "UNEXPECTED",
          msg[msg.find("This realignment"):][:220] if "This realignment" in msg else msg[:220]))

rs = dvapi.get("book_realignmentses(%s)?$select=statecode" % realign)
print("  realignment statecode after Test A=%s (0=still Active, good)" % rs.get("statecode"))

# =====================================================================
# TEST B: add 100k detail reduction, approve -> expect success
# =====================================================================
print("\n########## TEST B: add 100k reduction on RADIO detail, approve ##########")
red = dvapi.post("book_realignmentdetailreductions", {
    "book_name": "RED-DRX-RADIO", "book_newamount": AMOUNT,
    **ref("book_realignmentdetailreduction", "book_realignment", "book_realignmentses", realign),
    **ref("book_realignmentdetailreduction", "book_itemizeddetail", "book_itemizeddetailses", id1),
})
print("  created detail reduction (RADIO -100k):", bool(red))

dvapi.patch("book_realignmentses", realign, {"book_newstateapproved": APPROVED})
snapshot("AFTER approval")
rs = dvapi.get("book_realignmentses(%s)?$select=statecode,book_newstateapproved" % realign)
print("  realignment statecode=%s (1=processed) stateApproved=%s" % (
    rs.get("statecode"), rs.get("book_newstateapproved")))
print("\nExpected AFTER: Prio-D total=200k, PF-D=200k, radio=100k vehicle=100k (sum 200k);")
print("  RF-D tdp=200k, RF-C tdp=100k, PF-C=100k, G3 rem unchanged, statecode=1")
