#!/usr/bin/env python3
"""End-to-end validation of the TWO-SIDED itemized realignment (debit Itemized +
credit Itemized), docs/Prioritization-Funding-Reconciliation.md §5.

Both Prios Itemized, both single-RF on G3 (same Fund/SAG -> State approval only):
  Debit  Prio-TWD: details 40k + 20k = 60k, RF-TWD TDP 60k, auto PF 60k.
  Credit Prio-TWC: details 20k + 10k = 30k, RF-TWC TDP 30k, auto PF 30k.
Move 20k from PF-TWD to RF-TWC.

  Test A: approve, no adjustments        -> blocked (debit detail balance).
  Test B: add 20k debit reduction only   -> blocked (credit detail balance).
  Test C: add 20k credit increase, approve -> processes:
    debit  PF-TWD 60k->40k, RADIO 40k->20k, Prio-TWD total 60k->40k  (Σ PF == Σ details == 40k)
    credit RF-TWC TDP 30k->50k, credit detail 20k->40k, Prio-TWC total 30k->50k,
           auto-allocate syncs PF-TWC 30k->50k  (Σ PF == Σ details == 50k)
    RF-TWD TDP 60k->40k, G3 remaining unchanged (same-LOA), realignment processed.

Self-cleaning (TWD/TWC + the DRX/CRX leftovers, to reclaim G3 headroom). Not idempotent otherwise."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, TYPE_STATE = 2027, 4, 0
MODE_STATE, MODE_ITEMIZED, APPROVED = 0, 1, 0
SP_USER = "3f90bd45-7cbe-f111-aaaf-70a8a5af378b"
CHECKBOOK_ADMIN_ROLE = "14ee21c6-2121-f011-998a-001dd805b842"
MOVE = 20000

def ref(entity, attr, es, gid):
    nav = dvapi.navprop(entity, attr)
    if not nav: raise SystemExit("no nav prop for %s.%s" % (entity, attr))
    return {"%s@odata.bind" % nav: "/%s(%s)" % (es, gid)}

def rid(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit("NOT FOUND %s '%s'" % (es, name))
    return g

# Cleanup must toggle the increase-only lock OFF: deleting an ItemizedDetail cascades
# a PF reduction that FundedAmountLock would otherwise block, and Prios are renamed by
# PrioritizationNameSetter so children are found by _book_requirement_value, not by name.
LOCK_VAL_ID = "ab79ea15-b1c1-f111-aaaf-70a8a5af378b"  # book_LockManualFundedEdits value
def set_lock(v): dvapi.patch("environmentvariablevalues", LOCK_VAL_ID, {"value": v})
def _q(es, sel, flt=None):
    p = {"$select": sel}
    if flt: p["$filter"] = flt
    return dvapi.query(es, **p) or []

def wipe_req(name):
    reqs = _q("book_requirementses", "book_requirementsid", "book_name eq '%s'" % name)
    if not reqs: return
    rid = reqs[0]["book_requirementsid"]
    for p in _q("book_prioritizations", "book_prioritizationid", "_book_requirement_value eq %s" % rid):
        pid = p["book_prioritizationid"]
        for pf in _q("book_prioritizationfundings", "book_prioritizationfundingid", "_book_prioritization_value eq %s" % pid):
            dvapi.delete("book_prioritizationfundings", pf["book_prioritizationfundingid"])
        for d in _q("book_itemizeddetailses", "book_itemizeddetailsid", "_book_prioritization_value eq %s" % pid):
            dvapi.delete("book_itemizeddetailses", d["book_itemizeddetailsid"])
        dvapi.delete("book_prioritizations", pid)
    for rf in _q("book_requirementfundings", "book_requirementfundingid", "_book_requirement_value eq %s" % rid):
        rfid = rf["book_requirementfundingid"]
        for pf in _q("book_prioritizationfundings", "book_prioritizationfundingid", "_book_requirementfunding_value eq %s" % rfid):
            dvapi.delete("book_prioritizationfundings", pf["book_prioritizationfundingid"])
        for rdf in _q("book_requirementdetailfundings", "book_requirementdetailfundingid", "_book_requirementfunding_value eq %s" % rfid):
            dvapi.delete("book_requirementdetailfundings", rdf["book_requirementdetailfundingid"])
        dvapi.delete("book_requirementfundings", rfid)
    for rd in _q("book_requirementdetailses", "book_requirementdetailsid", "_book_requirement_value eq %s" % rid):
        dvapi.delete("book_requirementdetailses", rd["book_requirementdetailsid"])
    dvapi.delete("book_requirementses", rid)

print("cleanup...")
set_lock("no")
try:
    # Child realignment tables first (free PF/detail references), then our chains.
    for child, cid in (("book_realignmentdetailreductions", "book_realignmentdetailreductionid"),
                       ("book_realignmentdetailincreases", "book_realignmentdetailincreaseid"),
                       ("book_realignmentitems", "book_realignmentitemid")):
        for r in _q(child, cid):
            try: dvapi.delete(child, r[cid])
            except Exception: pass
    for r in _q("book_realignmentses", "book_realignmentsid,book_name"):
        if (r.get("book_name") or "").startswith("REALIGN-"):
            try: dvapi.delete("book_realignmentses", r["book_realignmentsid"])
            except Exception: pass
    for nm in ("REQ-TX-FY27-TWD", "REQ-TX-FY27-TWC", "REQ-TX-FY27-DRX", "REQ-TX-FY27-CRX"):
        wipe_req(nm)
finally:
    set_lock("yes")
print("cleanup done.")

roles = dvapi.get("systemusers(%s)?$select=systemuserid&$expand=systemuserroles_association($select=roleid)" % SP_USER)
if not any(r.get("roleid") == CHECKBOOK_ADMIN_ROLE for r in roles.get("systemuserroles_association", [])):
    dvapi._req("POST", "systemusers(%s)/systemuserroles_association/$ref" % SP_USER,
               {"@odata.id": "%s/api/data/v9.2/roles(%s)" % (dvapi.ORG, CHECKBOOK_ADMIN_ROLE)})
    print("assigned admin role to SP")

G3 = rid("book_fundinglines", "G3-206510D27-111-TRNG-CON")
A18TX = rid("book_fundcenters", "A18TX")
TX = rid("book_states", "Texas")
APE1 = rid("book_apes", "APE000001")
g0 = dvapi.get("book_fundinglines(%s)?$select=book_newtdpremaining" % G3)
print("G3 remaining before build:", g0.get("book_newtdpremaining"))

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

def build_itemized(tag, item1, item2, f1, f2, tdp):
    req = dvapi.post("book_requirementses", {
        "book_name": "REQ-TX-FY27-%s" % tag, "book_type": TYPE_STATE, "book_pomstatus": False,
        "book_statutoryjustification": "FY27 two-sided validation (dev).",
        **ref("book_requirements", "book_fundcenter", "book_fundcenters", A18TX),
        **ref("book_requirements", "book_ape", "book_apes", APE1),
    })
    rd1 = mkrd("RD-%s-%s" % (tag, item1[0]), req, item1[1], 1, f1, f1)
    rd2 = mkrd("RD-%s-%s" % (tag, item2[0]), req, item2[1], 2, f2, f2)
    rf = dvapi.post("book_requirementfundings", {
        "book_name": "RF-TX-FY27-%s" % tag, "book_newfiscalyear": FY, "book_newtdp": tdp,
        **ref("book_requirementfunding", "book_requirement", "book_requirementses", req),
        **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", G3),
        **ref("book_requirementfunding", "book_ape", "book_apes", APE1),
    })
    prio = dvapi.post("book_prioritizations", {
        "book_name": "PRI-TX-FY27-%s" % tag, "book_newfiscalyear": FY,
        "book_approvalstatus": FINAL_APPROVED, "book_quantities": 1, "book_fundingmode": MODE_ITEMIZED,
        "book_statutoryjustification": "FY27 two-sided validation (dev).",
        **ref("book_prioritization", "book_requirement", "book_requirementses", req),
        **ref("book_prioritization", "book_fundcenter", "book_fundcenters", A18TX),
        **ref("book_prioritization", "book_state", "book_states", TX),
    })
    d1 = mkid("ID-%s-%s" % (tag, item1[0]), prio, rd1, f1, f1, f1)
    d2 = mkid("ID-%s-%s" % (tag, item2[0]), prio, rd2, f2, f2, f2)
    pfs = dvapi.query("book_prioritizationfundings",
                      **{"$select": "book_prioritizationfundingid,book_fundedamount",
                         "$filter": "_book_prioritization_value eq %s and statecode eq 0" % prio})
    pfid = pfs[0]["book_prioritizationfundingid"] if pfs else None
    tot = dvapi.get("book_prioritizations(%s)?$select=book_newfundedamounttdp" % prio)
    print("  %s: Prio total=%s  PF=%s  (details %s+%s)" % (
        tag, tot.get("book_newfundedamounttdp"),
        pfs[0].get("book_fundedamount") if pfs else None, f1, f2))
    return dict(prio=prio, rf=rf, pf=pfid, d1=d1, d2=d2)

print("\n########## build debit (TWD) + credit (TWC), both Itemized single-RF ##########")
D = build_itemized("TWD", ("RADIO", "ITEM-RADIO"), ("VEH", "ITEM-VEHICLE"), 40000, 20000, 60000)
C = build_itemized("TWC", ("AMMO", "ITEM-AMMO"), ("MED", "ITEM-MED"), 20000, 10000, 30000)

print("\n########## build realignment (move 20k PF-TWD -> RF-TWC) ##########")
realign = dvapi.post("book_realignmentses", {
    "book_name": "REALIGN-TWD-001", "book_fiscalyear": FY, "book_realignmententrymode": MODE_STATE,
    **ref("book_realignments", "book_debitedprioritization", "book_prioritizations", D["prio"]),
    **ref("book_realignments", "book_creditedprioritization", "book_prioritizations", C["prio"]),
})
item = dvapi.post("book_realignmentitems", {
    "book_newamount": MOVE,
    **ref("book_realignmentitem", "book_realignment", "book_realignmentses", realign),
    **ref("book_realignmentitem", "book_debitprioritizationfunding", "book_prioritizationfundings", D["pf"]),
    **ref("book_realignmentitem", "book_creditrequirementfunding", "book_requirementfundings", C["rf"]),
})
print("  realignment + item:", all([realign, item]))

def snap(label):
    pd = dvapi.get("book_prioritizations(%s)?$select=book_newfundedamounttdp" % D["prio"])
    pfd = dvapi.get("book_prioritizationfundings(%s)?$select=book_fundedamount" % D["pf"])
    dr = dvapi.get("book_itemizeddetailses(%s)?$select=book_fundedamount" % D["d1"])
    rfd = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp" % D["rf"])
    pc = dvapi.get("book_prioritizations(%s)?$select=book_newfundedamounttdp" % C["prio"])
    cd = dvapi.get("book_itemizeddetailses(%s)?$select=book_fundedamount" % C["d1"])
    rfc = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp" % C["rf"])
    pfc = dvapi.query("book_prioritizationfundings", **{"$select": "book_fundedamount",
                      "$filter": "_book_prioritization_value eq %s and statecode eq 0" % C["prio"]})
    g = dvapi.get("book_fundinglines(%s)?$select=book_newtdpremaining" % G3)
    print("\n--- %s ---" % label)
    print("  DEBIT  Prio-TWD total=%s PF=%s RADIO=%s RF-TWD tdp=%s" % (
        pd.get("book_newfundedamounttdp"), pfd.get("book_fundedamount"),
        dr.get("book_fundedamount"), rfd.get("book_newtdp")))
    print("  CREDIT Prio-TWC total=%s PF=%s AMMO=%s RF-TWC tdp=%s" % (
        pc.get("book_newfundedamounttdp"), [x.get("book_fundedamount") for x in pfc],
        cd.get("book_fundedamount"), rfc.get("book_newtdp")))
    print("  G3 remaining=%s" % g.get("book_newtdpremaining"))

snap("BEFORE")

print("\n########## TEST A: approve, no adjustments (expect BLOCK: debit balance) ##########")
try:
    dvapi.patch("book_realignmentses", realign, {"book_newstateapproved": APPROVED})
    print("  !! UNEXPECTED: approved")
except Exception as e:
    m = str(e); i = m.find("This realignment")
    print("  blocked:", (m[i:i+200] if i >= 0 else m[:200]))

print("\n########## TEST B: add 20k debit reduction only (expect BLOCK: credit balance) ##########")
dvapi.post("book_realignmentdetailreductions", {
    "book_name": "RED-TWD-RADIO", "book_newamount": MOVE,
    **ref("book_realignmentdetailreduction", "book_realignment", "book_realignmentses", realign),
    **ref("book_realignmentdetailreduction", "book_itemizeddetail", "book_itemizeddetailses", D["d1"]),
})
try:
    dvapi.patch("book_realignmentses", realign, {"book_newstateapproved": APPROVED})
    print("  !! UNEXPECTED: approved")
except Exception as e:
    m = str(e); i = m.find("This realignment")
    print("  blocked:", (m[i:i+200] if i >= 0 else m[:200]))

print("\n########## TEST C: add 20k credit increase, approve (expect SUCCESS) ##########")
dvapi.post("book_realignmentdetailincreases", {
    "book_name": "INC-TWC-AMMO", "book_newamount": MOVE,
    **ref("book_realignmentdetailincrease", "book_realignment", "book_realignmentses", realign),
    **ref("book_realignmentdetailincrease", "book_itemizeddetail", "book_itemizeddetailses", C["d1"]),
})
dvapi.patch("book_realignmentses", realign, {"book_newstateapproved": APPROVED})
snap("AFTER approval")
rs = dvapi.get("book_realignmentses(%s)?$select=statecode" % realign)
print("  realignment statecode=%s (1=processed)" % rs.get("statecode"))
print("\nExpected AFTER: DEBIT Prio-TWD 40k / PF 40k / RADIO 20k / RF-TWD tdp 40k;")
print("  CREDIT Prio-TWC 50k / PF 50k / AMMO 40k / RF-TWC tdp 50k; G3 unchanged; statecode 1")
