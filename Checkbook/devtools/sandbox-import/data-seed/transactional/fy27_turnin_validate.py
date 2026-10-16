#!/usr/bin/env python3
"""End-to-end validation of FY27 Turn-Ins (docs/TurnIn-FY27-Redesign.md).

Setup (idempotent): env var book_TurnInCreditOPR -> the ARNG OPR; an ARNG holding LOA for
G4's Fund/SAG (G3's already exists: ARNG-206510D27-111-TRNG-RISK).

  Test 1  One State Turn-In, two Prioritizations, no header Fund/PG:
            Prio-1 Direct split across G3 (PF 10k) + G4 (PF 20k): 4k + 6k TDP, AFP 5k / Allotment 2k
            entered on the G4 line; Prio-2 Itemized on G4: 12k TDP, AFP / Allotment auto (50 % / 25 %),
            detail reduced 12k. Over-draw blocked; AFP on G3 (no Funding Event) blocked; then State
            approval moves PFs, Prio funded + requested, RF TDP, LOAs, and distributes AFP 11k /
            Allotment 5k on G4.
  Test 2  Prioritization + RF lines on one Turn-In        -> blocked.
  Test 3  RF-level (NPM) on a direct-funded RF (TDP 16k = RDF 10k + Withholding 6k). Turn in 9k
          with AFP 4k / Allotment 2k entered. State approval refused; no RDF reduction blocked;
          with a 3k RDF reduction the RI / CSOR approval alone runs it -> RF 7k/7k/0, RDF 7k,
          ARNG-G4 +9k, AFP 4k + Allotment 2k distributed.
  Test 4  TurnInLineLock: deleting / changing / adding / re-parenting lines or reductions on a
          completed Turn-In is blocked; a draft's lines stay editable; the cleanup's Turn-In
          deletes (cascade) still work.

Cleans up its own Requirements / Turn-Ins from earlier runs first (lock toggled off).
"""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, TYPE_STATE = 2027, 4, 0
MODE_DIRECT, MODE_ITEMIZED = 0, 1
SP_USER = "3f90bd45-7cbe-f111-aaaf-70a8a5af378b"
CHECKBOOK_ADMIN_ROLE = "14ee21c6-2121-f011-998a-001dd805b842"
LOCK_VAL_ID = "ab79ea15-b1c1-f111-aaaf-70a8a5af378b"  # book_LockManualFundedEdits value
ARNG_OPR = "9b6d7541-02c1-f111-aaaf-70a8a5af378b"
CATEGORY_RISK = 0
TAG = time.strftime("%m%d%H%M")


def ref(entity, attr, es, gid):
    nav = dvapi.navprop(entity, attr)
    if not nav: raise SystemExit("no nav prop for %s.%s" % (entity, attr))
    return {"%s@odata.bind" % nav: "/%s(%s)" % (es, gid)}


def rid(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit("NOT FOUND %s '%s'" % (es, name))
    return g


def _q(es, sel, flt=None):
    p = {"$select": sel}
    if flt: p["$filter"] = flt
    return dvapi.query(es, **p) or []


fails = []
def check(label, got, want):
    ok = got is not None and abs(float(got) - float(want)) < 0.01
    print("  %s %-44s got=%s want=%s" % ("OK " if ok else "BAD", label, got, want))
    if not ok: fails.append(label)


def expect_block(label, fn, needle):
    try:
        fn()
        print("  BAD %s: went through" % label); fails.append(label)
    except RuntimeError as e:
        msg = str(e)
        i = msg.find("message")
        ok = needle in msg
        print("  %s %s blocked: %s" % ("OK " if ok else "BAD", label, msg[i:i + 240] if i >= 0 else msg[:240]))
        if not ok: fails.append(label + " (wrong error)")


def val(es, gid, col):
    return dvapi.get("%s(%s)?$select=%s" % (es, gid, col)).get(col)


# ------------------------------------------------------------------ cleanup earlier runs
def set_lock(v): dvapi.patch("environmentvariablevalues", LOCK_VAL_ID, {"value": v})


def wipe_req(rid_):
    for p in _q("book_prioritizations", "book_prioritizationid", "_book_requirement_value eq %s" % rid_):
        pid = p["book_prioritizationid"]
        for pf in _q("book_prioritizationfundings", "book_prioritizationfundingid", "_book_prioritization_value eq %s" % pid):
            dvapi.delete("book_prioritizationfundings", pf["book_prioritizationfundingid"])
        for d in _q("book_itemizeddetailses", "book_itemizeddetailsid", "_book_prioritization_value eq %s" % pid):
            dvapi.delete("book_itemizeddetailses", d["book_itemizeddetailsid"])
        dvapi.delete("book_prioritizations", pid)
    for rf in _q("book_requirementfundings", "book_requirementfundingid", "_book_requirement_value eq %s" % rid_):
        rfid = rf["book_requirementfundingid"]
        # Realignment items pointing at the RF (the OPR regression check) block its delete.
        for side in ("_book_debitrequirementfunding_value", "_book_creditrequirementfunding_value"):
            for it in _q("book_realignmentitems", "book_realignmentitemid", "%s eq %s" % (side, rfid)):
                dvapi.delete("book_realignmentitems", it["book_realignmentitemid"])
        for rdf in _q("book_requirementdetailfundings", "book_requirementdetailfundingid", "_book_requirementfunding_value eq %s" % rfid):
            dvapi.delete("book_requirementdetailfundings", rdf["book_requirementdetailfundingid"])
        dvapi.delete("book_requirementfundings", rfid)
    for rd in _q("book_requirementdetailses", "book_requirementdetailsid", "_book_requirement_value eq %s" % rid_):
        dvapi.delete("book_requirementdetailses", rd["book_requirementdetailsid"])
    dvapi.delete("book_requirementses", rid_)


print("cleanup...")
set_lock("no")
try:
    # The OPR regression check seeds REALIGN-TIREG-* against REQ-TX-FY27-TIREG-* RFs.
    for r in _q("book_realignmentses", "book_realignmentsid,book_name"):
        if (r.get("book_name") or "").startswith("REALIGN-TIREG-"):
            rl = r["book_realignmentsid"]
            for child, cid in (("book_realignmentrdfreductions", "book_realignmentrdfreductionid"),
                               ("book_realignmentitems", "book_realignmentitemid")):
                for c in _q(child, cid, "_book_realignment_value eq %s" % rl):
                    try: dvapi.delete(child, c[cid])
                    except Exception as e: print("  realignment child delete failed:", str(e)[:120])
            try: dvapi.delete("book_realignmentses", rl)
            except Exception as e: print("  realignment delete failed:", str(e)[:120])
    # Undo earlier runs' money movement so G3 / G4 headroom doesn't shrink run over run: the
    # sandbox had no Turn-Ins before these tests, so every Turn-In ledger on the four test LOAs
    # is ours. LOA TDP = tracks + active-ledger net, recalculated by the ledger plugins.
    test_loas = [x for x in (dvapi.find_id("book_fundinglines", n) for n in (
        "G3-206510D27-111-TRNG-CON", "G4-202010D27-112-BASOPS-CON", "ARNG-206510D27-111-TRNG-RISK")) if x]
    test_loas += [x["book_fundinglineid"] for x in _q("book_fundinglines", "book_fundinglineid",
                                                     "startswith(book_name,'ARNG-HOLDING-')")]
    test_tis = [t["book_turninid"] for t in _q("book_turnins", "book_turninid,book_name")
                if (t.get("book_name") or "").startswith("TI-FY27-")]
    for loa in test_loas:
        for l in _q("book_ledgers", "book_ledgerid", "_book_lineofaccounting_value eq %s and book_ledgertype eq 1" % loa):
            try: dvapi.delete("book_ledgers", l["book_ledgerid"])
            except Exception as e: print("  ledger delete failed:", str(e)[:160])
    # Ledger deletes don't recalculate LOA TDP; a ledger Create does — post and remove a
    # zero-amount one per LOA so the baseline the checks read is current.
    for loa in test_loas:
        z = dvapi.post("book_ledgers", {
            "book_name": "TI-FY27-RECALC", "book_newamount": 0, "book_ledgertype": 1, "book_ledgerdirection": 0,
            **ref("book_ledger", "book_lineofaccounting", "book_fundinglines", loa)})
        dvapi.delete("book_ledgers", z)
    for ti in test_tis:
        for d in _q("book_distributionses", "book_distributionsid", "_book_turnin_value eq %s" % ti):
            try: dvapi.delete("book_distributionses", d["book_distributionsid"])
            except Exception as e: print("  distribution delete failed:", str(e)[:160])
    for t in _q("book_turnins", "book_turninid,book_name"):
        if (t.get("book_name") or "").startswith("TI-FY27-"):
            try: dvapi.delete("book_turnins", t["book_turninid"])
            except Exception as e: print("  turn-in delete failed:", str(e)[:120])
    for r in _q("book_requirementses", "book_requirementsid,book_name"):
        if (r.get("book_name") or "").startswith("REQ-TX-FY27-TI"):
            try: wipe_req(r["book_requirementsid"])
            except Exception as e: print("  requirement wipe failed:", str(e)[:160])
finally:
    set_lock("yes")

# ------------------------------------------------------------------ setup
roles = dvapi.get("systemusers(%s)?$select=systemuserid&$expand=systemuserroles_association($select=roleid)" % SP_USER)
if not any(r.get("roleid") == CHECKBOOK_ADMIN_ROLE for r in roles.get("systemuserroles_association", [])):
    dvapi._req("POST", "systemusers(%s)/systemuserroles_association/$ref" % SP_USER,
               {"@odata.id": "%s/api/data/v9.2/roles(%s)" % (dvapi.ORG, CHECKBOOK_ADMIN_ROLE)})

ev = _q("environmentvariabledefinitions", "environmentvariabledefinitionid", "schemaname eq 'book_TurnInCreditOPR'")[0]
evv = _q("environmentvariablevalues", "environmentvariablevalueid,value",
         "_environmentvariabledefinitionid_value eq %s" % ev["environmentvariabledefinitionid"])
if not evv:
    dvapi.post("environmentvariablevalues", {
        "schemaname": "book_TurnInCreditOPR", "value": ARNG_OPR,
        "EnvironmentVariableDefinitionId@odata.bind": "/environmentvariabledefinitions(%s)" % ev["environmentvariabledefinitionid"]})
    print("set book_TurnInCreditOPR -> ARNG")
elif evv[0].get("value") != ARNG_OPR:
    dvapi.patch("environmentvariablevalues", evv[0]["environmentvariablevalueid"], {"value": ARNG_OPR})
    print("updated book_TurnInCreditOPR -> ARNG")

G3 = rid("book_fundinglines", "G3-206510D27-111-TRNG-CON")
G4 = rid("book_fundinglines", "G4-202010D27-112-BASOPS-CON")
ARNG3 = rid("book_fundinglines", "ARNG-206510D27-111-TRNG-RISK")


def arng_for(loa):
    l = dvapi.get("book_fundinglines(%s)?$select=_book_fund_value,_book_pg_value,_book_sag_value,book_fiscalyear" % loa)
    hit = _q("book_fundinglines", "book_fundinglineid",
             "_book_fund_value eq %s and _book_sag_value eq %s and _book_disbursingofficial_value eq %s"
             % (l["_book_fund_value"], l["_book_sag_value"], ARNG_OPR))
    if hit: return hit[0]["book_fundinglineid"]
    print("creating ARNG holding LOA for", loa)
    return dvapi.post("book_fundinglines", {
        "book_name": "ARNG-HOLDING-" + loa[:8], "book_fiscalyear": l["book_fiscalyear"], "book_category": CATEGORY_RISK,
        **ref("book_fundingline", "book_fund", "book_funds", l["_book_fund_value"]),
        **ref("book_fundingline", "book_pg", "book_pgs", l["_book_pg_value"]),
        **ref("book_fundingline", "book_sag", "book_sags", l["_book_sag_value"]),
        **ref("book_fundingline", "book_disbursingofficial", "book_oprs", ARNG_OPR),
    })


ARNG4 = arng_for(G4)
check("ARNG LOA for G3 resolves to existing", 1 if arng_for(G3) == ARNG3 else 0, 1)

A18TX = rid("book_fundcenters", "A18TX")
TX = rid("book_states", "Texas")
APE1 = rid("book_apes", "APE000001")


def loa_state(g):
    r = dvapi.get("book_fundinglines(%s)?$select=book_newtdp,book_newtdpremaining" % g)
    return r.get("book_newtdp") or 0, r.get("book_newtdpremaining") or 0


def mkreq(tag):
    return dvapi.post("book_requirementses", {
        "book_name": "REQ-TX-FY27-%s-%s" % (tag, TAG), "book_type": TYPE_STATE, "book_pomstatus": False,
        "book_statutoryjustification": "FY27 turn-in validation (dev).",
        **ref("book_requirements", "book_fundcenter", "book_fundcenters", A18TX),
        **ref("book_requirements", "book_ape", "book_apes", APE1),
    })


def mkrf(tag, req, loa, tdp):
    return dvapi.post("book_requirementfundings", {
        "book_name": "RF-TX-FY27-%s-%s" % (tag, TAG), "book_newfiscalyear": FY, "book_newtdp": tdp,
        **ref("book_requirementfunding", "book_requirement", "book_requirementses", req),
        **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", loa),
        **ref("book_requirementfunding", "book_ape", "book_apes", APE1),
    })


def mkrd(name, req, item, order, validated, funded):
    return dvapi.post("book_requirementdetailses", {
        "book_name": name, "book_priorityorder": order,
        "book_validatedamount": validated, "book_fundedamount": funded,
        **ref("book_requirementdetails", "book_requirement", "book_requirementses", req),
        **ref("book_requirementdetails", "book_item", "book_items", rid("book_items", item)),
    })


def mkprio(tag, req, mode, requested=None):
    body = {
        "book_name": "PRI-TX-FY27-%s" % tag, "book_newfiscalyear": FY,
        "book_approvalstatus": FINAL_APPROVED, "book_quantities": 1, "book_fundingmode": mode,
        "book_statutoryjustification": "FY27 turn-in validation (dev).",
        **ref("book_prioritization", "book_requirement", "book_requirementses", req),
        **ref("book_prioritization", "book_fundcenter", "book_fundcenters", A18TX),
        **ref("book_prioritization", "book_state", "book_states", TX),
    }
    if requested is not None: body["book_newrequestedamount"] = requested
    return dvapi.post("book_prioritizations", body)


def mkturnin(tag):
    return dvapi.post("book_turnins", {
        "book_name": "TI-FY27-%s-%s" % (tag, TAG), "book_fiscalyear": FY, "book_origin": 0,
        "book_turnindetails": "FY27 turn-in validation (dev).",
        **ref("book_turnin", "book_fundcenter", "book_fundcenters", A18TX),
    })


def mkitem(ti, amount, rf, prio=None, pf=None, afp=None, allot=None):
    body = {"book_newturninamount": amount,
            **ref("book_turninitems", "book_turnin", "book_turnins", ti),
            **ref("book_turninitems", "book_requirementfunding", "book_requirementfundings", rf)}
    if prio: body.update(ref("book_turninitems", "book_prioritization", "book_prioritizations", prio))
    if pf: body.update(ref("book_turninitems", "book_prioritizationfunding", "book_prioritizationfundings", pf))
    # Entered AFP / Allotment = override; omitted = sized automatically (TurnInItemAmountCalculator).
    if afp is not None: body.update({"book_afpamount": afp, "book_afpoverridden": True})
    if allot is not None: body.update({"book_allotmentamount": allot, "book_allotmentoverridden": True})
    return dvapi.post("book_turninitemses", body)


def approve(ti, **flags):
    dvapi.patch("book_turnins", ti, flags)


def ledgers(ti):
    return _q("book_ledgers", "book_newamount,book_ledgerdirection,_book_lineofaccounting_value", "_book_turnin_value eq %s" % ti)


def distributions(ti):
    return _q("book_distributionses", "book_newamount,book_disbursementdirection,_book_fund_value,book_remarks",
              "_book_turnin_value eq %s" % ti)


# ------------------------------------------------------------------ AFP / Allotment funding events
# Active events on G4's (Fund, PG) only — AFP 50 %, Allotment 25 %. G3 has none, so an
# AFP entered on a G3 line must be blocked (nothing to distribute it against).
g4 = dvapi.get("book_fundinglines(%s)?$select=_book_fund_value,_book_pg_value" % G4)
today = time.strftime("%Y-%m-%d")
for ftype, label, pct in ((0, "AFP", 50), (1, "ALLOT", 25)):
    name = "FE-FY27-TURNIN-TEST-" + label
    fe = _q("book_fundingevents", "book_fundingeventid", "book_name eq '%s'" % name)
    if fe:
        feid = fe[0]["book_fundingeventid"]
    else:
        feid = dvapi.post("book_fundingevents", {
            "book_name": name, "book_fundingtype": ftype, "book_fiscalyear": FY,
            "book_startdate": "2026-10-01", "book_enddate": "2027-09-30"})
        print("created funding event", name)
    if not _q("book_fundingdetailses", "book_fundingdetailsid", "_book_fundingevent_value eq %s" % feid):
        dvapi.post("book_fundingdetailses", {
            "book_name": name + "-G4", "book_distributionpercentage": pct,
            **ref("book_fundingdetails", "book_fundingevent", "book_fundingevents", feid),
            **ref("book_fundingdetails", "book_fund", "book_funds", g4["_book_fund_value"]),
            **ref("book_fundingdetails", "book_pgsag", "book_pgs", g4["_book_pg_value"])})

# ================================================================== Test 1
print("\n########## Test 1: one State Turn-In, two Prioritizations, entered + auto AFP/Allotment ##########")
# Prio-1: Direct, split across G3 (10k) + G4 (20k).
req1 = mkreq("TIA")
rfA1 = mkrf("TIA1", req1, G3, 10000)
rfA2 = mkrf("TIA2", req1, G4, 20000)
prio1 = mkprio("TIA", req1, MODE_DIRECT, requested=30000)
pf1 = dvapi.post("book_prioritizationfundings", {
    "book_fundedamount": 10000, "book_validatedamount": 10000,
    **ref("book_prioritizationfunding", "book_prioritization", "book_prioritizations", prio1),
    **ref("book_prioritizationfunding", "book_requirementfunding", "book_requirementfundings", rfA1)})
pf2 = dvapi.post("book_prioritizationfundings", {
    "book_fundedamount": 20000, "book_validatedamount": 20000,
    **ref("book_prioritizationfunding", "book_prioritization", "book_prioritizations", prio1),
    **ref("book_prioritizationfunding", "book_requirementfunding", "book_requirementfundings", rfA2)})

# Prio-2: Itemized, single RF on G4 (details 30k + 20k).
req2 = mkreq("TIB")
rd1 = mkrd("RD-TIB-RADIO-" + TAG, req2, "ITEM-RADIO", 1, 30000, 30000)
rd2 = mkrd("RD-TIB-VEH-" + TAG, req2, "ITEM-VEHICLE", 2, 20000, 20000)
rfB = mkrf("TIB", req2, G4, 50000)
prio2 = mkprio("TIB", req2, MODE_ITEMIZED)


def mkid(name, rd, amt):
    return dvapi.post("book_itemizeddetailses", {
        "book_name": name, "book_quantity": 1,
        "book_requestedamount": amt, "book_validatedamount": amt, "book_fundedamount": amt,
        **ref("book_itemizeddetails", "book_prioritization", "book_prioritizations", prio2),
        **ref("book_itemizeddetails", "book_requirementitem", "book_requirementdetailses", rd),
        **ref("book_itemizeddetails", "book_fundcenter", "book_fundcenters", A18TX)})


d1 = mkid("ID-TIB-RADIO-" + TAG, rd1, 30000)
mkid("ID-TIB-VEH-" + TAG, rd2, 20000)
pfB = _q("book_prioritizationfundings", "book_prioritizationfundingid,book_fundedamount",
         "_book_prioritization_value eq %s and statecode eq 0" % prio2)
check("Prio-2 auto-allocated PF", pfB[0]["book_fundedamount"] if pfB else None, 50000)
pfB = pfB[0]["book_prioritizationfundingid"]

g3_before, g4_before = loa_state(G3), loa_state(G4)
a3_before, a4_before = loa_state(ARNG3), loa_state(ARNG4)

ti1 = mkturnin("TIA")
it11 = mkitem(ti1, 4000, rfA1, prio1, pf1, afp=1000)                  # G3: AFP entered, no G3 event
it12 = mkitem(ti1, 25000, rfA2, prio1, pf2, afp=5000, allot=2000)     # G4: over-draw first
itB = mkitem(ti1, 12000, rfB, prio2, pfB)                             # G4: AFP/Allotment auto (50 % / 25 %)
check("line B AFP auto-sized (50 %)", val("book_turninitemses", itB, "book_afpamount"), 6000)
check("line B Allotment auto-sized (25 %)", val("book_turninitemses", itB, "book_allotmentamount"), 3000)
check("line 2 AFP kept as entered", val("book_turninitemses", it12, "book_afpamount"), 5000)
dvapi.post("book_turnindetailreductions", {
    "book_newamount": 12000,
    **ref("book_turnindetailreduction", "book_turnin", "book_turnins", ti1),
    **ref("book_turnindetailreduction", "book_itemizeddetail", "book_itemizeddetailses", d1)})

expect_block("Test 1a (PF over-draw)", lambda: approve(ti1, book_stateapproved=True), "holds only")
dvapi.patch("book_turninitemses", it12, {"book_newturninamount": 6000})
expect_block("Test 1b (AFP on a Fund/PG with no event)", lambda: approve(ti1, book_stateapproved=True), "no active")
dvapi.patch("book_turninitemses", it11, {"book_afpoverridden": False})  # back to auto -> 0 (no G3 event)
check("line 1 AFP back to auto (0)", val("book_turninitemses", it11, "book_afpamount"), 0)

check("header TDP = sum of lines", val("book_turnins", ti1, "book_newamount"), 22000)
check("header AFP = 5k entered + 6k auto", val("book_turnins", ti1, "book_afpamount"), 11000)
check("header Allotment = 2k entered + 3k auto", val("book_turnins", ti1, "book_allotmentamount"), 5000)
approve(ti1, book_stateapproved=True)

check("PF-1 funded", val("book_prioritizationfundings", pf1, "book_fundedamount"), 6000)
check("PF-2 funded", val("book_prioritizationfundings", pf2, "book_fundedamount"), 14000)
check("Prio-1 funded", val("book_prioritizations", prio1, "book_newfundedamounttdp"), 20000)
check("Prio-1 requested", val("book_prioritizations", prio1, "book_newrequestedamount"), 20000)
check("RF-A1 TDP", val("book_requirementfundings", rfA1, "book_newtdp"), 6000)
check("RF-A2 TDP", val("book_requirementfundings", rfA2, "book_newtdp"), 14000)
check("PF-B funded", val("book_prioritizationfundings", pfB, "book_fundedamount"), 38000)
check("detail-1 funded", val("book_itemizeddetailses", d1, "book_fundedamount"), 18000)
check("detail-1 requested", val("book_itemizeddetailses", d1, "book_requestedamount"), 18000)
check("Prio-2 funded", val("book_prioritizations", prio2, "book_newfundedamounttdp"), 38000)
check("Prio-2 requested", val("book_prioritizations", prio2, "book_newrequestedamount"), 38000)
check("RF-B TDP", val("book_requirementfundings", rfB, "book_newtdp"), 38000)
check("G3 TDP -4k", loa_state(G3)[0], g3_before[0] - 4000)
check("G3 remaining unchanged", loa_state(G3)[1], g3_before[1])
check("G4 TDP -18k", loa_state(G4)[0], g4_before[0] - 18000)
check("G4 remaining unchanged", loa_state(G4)[1], g4_before[1])
check("ARNG-G3 TDP +4k", loa_state(ARNG3)[0], a3_before[0] + 4000)
check("ARNG-G4 TDP +18k", loa_state(ARNG4)[0], a4_before[0] + 18000)
dist = distributions(ti1)
check("distribution rows (AFP + Allotment pairs on G4)", len(dist), 4)
check("distributed AFP (debit side)",
      sum(d["book_newamount"] for d in dist if "AFP Debit" in (d.get("book_remarks") or "")), 11000)
check("distributed Allotment (debit side)",
      sum(d["book_newamount"] for d in dist if "Allotment Debit" in (d.get("book_remarks") or "")), 5000)
check("Turn-In deactivated", val("book_turnins", ti1, "statecode"), 1)

# ================================================================== Test 2
print("\n########## Test 2: Prioritization + RF lines on one Turn-In ##########")
req3 = mkreq("TIC")
rdC = mkrd("RD-TIC-AMMO-" + TAG, req3, "ITEM-AMMO", 1, 10000, 0)
rfC = mkrf("TIC", req3, G4, 16000)
rdfC = dvapi.post("book_requirementdetailfundings", {
    "book_fundedamount": 10000, "book_validatedamount": 10000,
    **ref("book_requirementdetailfunding", "book_requirementdetail", "book_requirementdetailses", rdC),
    **ref("book_requirementdetailfunding", "book_requirementfunding", "book_requirementfundings", rfC)})
ti2 = mkturnin("TIM")
mkitem(ti2, 1000, rfA2, prio1, pf2)
mkitem(ti2, 1000, rfC)
expect_block("Test 2 (mixed lines)", lambda: approve(ti2, book_stateapproved=True), "not both")

# ================================================================== Test 3
print("\n########## Test 3: RF-level, one-step RI / CSOR approval ##########")
print("  RF-C tdp=%s funded=%s withholding=%s" % (
    val("book_requirementfundings", rfC, "book_newtdp"), val("book_requirementfundings", rfC, "book_newfundedamount"),
    val("book_requirementfundings", rfC, "book_newwithholding")))
a4_before = loa_state(ARNG4)
ti3 = mkturnin("TIC")
mkitem(ti3, 9000, rfC, afp=4000, allot=2000)
check("requires second-step approval flag", 1 if val("book_turnins", ti3, "book_requiresbeapproval") else 0, 1)
expect_block("Test 3a (State approval refused)", lambda: approve(ti3, book_stateapproved=True), "not by the State")
expect_block("Test 3b (no RDF reduction)", lambda: approve(ti3, book_beapproved=True), "Requirement Detail funding")
dvapi.post("book_turninrdfreductions", {
    "book_newamount": 3000,
    **ref("book_turninrdfreduction", "book_turnin", "book_turnins", ti3),
    **ref("book_turninrdfreduction", "book_requirementdetailfunding", "book_requirementdetailfundings", rdfC)})
approve(ti3, book_beapproved=True)   # RI / CSOR approval alone runs it (SP holds Checkbook Admin)

check("RF TDP", val("book_requirementfundings", rfC, "book_newtdp"), 7000)
check("RF funded", val("book_requirementfundings", rfC, "book_newfundedamount"), 7000)
check("RF withholding", val("book_requirementfundings", rfC, "book_newwithholding"), 0)
check("RDF funded", val("book_requirementdetailfundings", rdfC, "book_fundedamount"), 7000)
check("ARNG-G4 TDP +9k", loa_state(ARNG4)[0], a4_before[0] + 9000)
dist = distributions(ti3)
check("distributed AFP (entered 4k)",
      sum(d["book_newamount"] for d in dist if "AFP Debit" in (d.get("book_remarks") or "")), 4000)
check("distributed Allotment (entered 2k)",
      sum(d["book_newamount"] for d in dist if "Allotment Debit" in (d.get("book_remarks") or "")), 2000)
check("Turn-In deactivated", val("book_turnins", ti3, "statecode"), 1)

# ================================================================== Test 4
print("\n########## Test 4: completed Turn-Ins can't be undone through their lines ##########")
LOCK = "can no longer be added, changed or deleted"
expect_block("Test 4a (delete a line of completed Turn-In 1)",
             lambda: dvapi.delete("book_turninitemses", itB), LOCK)
expect_block("Test 4b (change a line amount)",
             lambda: dvapi.patch("book_turninitemses", it12, {"book_newturninamount": 1}), LOCK)
expect_block("Test 4c (add a line)", lambda: mkitem(ti1, 1000, rfA2, prio1, pf2), LOCK)
expect_block("Test 4d (move a line to a draft Turn-In)",
             lambda: dvapi.patch("book_turninitemses", it11, ref("book_turninitems", "book_turnin", "book_turnins", ti2)), LOCK)
red3 = _q("book_turninrdfreductions", "book_turninrdfreductionid", "_book_turnin_value eq %s" % ti3)
expect_block("Test 4e (delete an RDF reduction of completed Turn-In 3)",
             lambda: dvapi.delete("book_turninrdfreductions", red3[0]["book_turninrdfreductionid"]), LOCK)
check("Turn-In 1 lines intact", len(_q("book_turninitemses", "book_turninitemsid", "_book_turnin_value eq %s" % ti1)), 3)
# A draft (Turn-In 2, never approved) stays editable.
d2 = _q("book_turninitemses", "book_turninitemsid", "_book_turnin_value eq %s" % ti2)
dvapi.delete("book_turninitemses", d2[0]["book_turninitemsid"])
check("draft Turn-In line deletable", len(_q("book_turninitemses", "book_turninitemsid", "_book_turnin_value eq %s" % ti2)), 1)

print("\nRESULT:", "PASS" if not fails else "FAIL %s" % fails)
