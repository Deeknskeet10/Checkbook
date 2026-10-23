#!/usr/bin/env python3
"""End-to-end validation of FY27 State Swaps — PF -> PF legs (docs/StateSwap-FY27-Redesign.md).

Setup (Texas = State A, Oklahoma = State B; all RFs on the seeded G3 / G4 OPR LOAs):
  TX-D  Direct     PF G3 30k (RF TXA3) + PF G4 20k (RF TXA4)          requested 50k
  TX-I  Itemized   single RF on G4: details 12k + 8k -> auto PF G4 20k (RF TXB4)
  OK-D  Direct     PF G3 10k (RF OKA3) + PF G4 10k (RF OKA4)          requested 20k (= funded)
  OK-I  Itemized   multi-RF: PF G3 10k (RF OKB3) + PF G4 10k (RF OKB4); details 10k + 10k

One swap, four legs (many-to-many, both directions, one PF on both sides):
  L1  TX-D G3 -> OK-D G3   5k
  L2  TX-D G4 -> OK-I G4   6k   (itemized multi-RF credit: detail increase 6k)
  L3  TX-I G4 -> OK-D G4   4k   (itemized debit: detail reduction 4k)
  L4  OK-D G3 -> TX-D G3   2k   (return leg: TX-D G3 is debited by L1 and credited by L4)

  Blocks: Fund/PG mismatch at save; unfunded credit PF at save; approval
  without the detail increase / reduction; over-draw of a PF; edits after State A approval.
  Then State A -> State B -> BE: PFs, Prio totals (OK-D Requested lifted 20k -> 27k, TX-D
  Requested unchanged), Σ details ≡ total ≡ Σ PF on both itemized Prios, RF TDP / Funded,
  G3 / G4 TDP + remaining unchanged (same-LOA legs, no ledgers), G4 distributions, deactivated.

Not covered here: the cross-LOA ledger pair (the sandbox has one OPR LOA per Fund/PG) and the
FY26 path (only Texas is seeded for FY26).
Cleans up its own swaps / Requirements from earlier runs first (lock toggled off).
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/data-seed/transactional/fy27_swap_validate.py
"""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, STATE_INPUT, TYPE_STATE = 2027, 4, 0, 0
MODE_DIRECT, MODE_ITEMIZED = 0, 1
SP_USER = "3f90bd45-7cbe-f111-aaaf-70a8a5af378b"
CHECKBOOK_ADMIN_ROLE = "14ee21c6-2121-f011-998a-001dd805b842"
LOCK_VAL_ID = "ab79ea15-b1c1-f111-aaaf-70a8a5af378b"  # book_LockManualFundedEdits value
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


def set_lock(v): dvapi.patch("environmentvariablevalues", LOCK_VAL_ID, {"value": v})


# ------------------------------------------------------------------ cleanup earlier runs
def wipe_req(rid_):
    for p in _q("book_prioritizations", "book_prioritizationid", "_book_requirement_value eq %s" % rid_):
        pid = p["book_prioritizationid"]
        for pf in _q("book_prioritizationfundings", "book_prioritizationfundingid", "_book_prioritization_value eq %s" % pid):
            dvapi.delete("book_prioritizationfundings", pf["book_prioritizationfundingid"])
        for d in _q("book_itemizeddetailses", "book_itemizeddetailsid", "_book_prioritization_value eq %s" % pid):
            dvapi.delete("book_itemizeddetailses", d["book_itemizeddetailsid"])
        dvapi.delete("book_prioritizations", pid)
    for rf in _q("book_requirementfundings", "book_requirementfundingid", "_book_requirement_value eq %s" % rid_):
        dvapi.delete("book_requirementfundings", rf["book_requirementfundingid"])
    for rd in _q("book_requirementdetailses", "book_requirementdetailsid", "_book_requirement_value eq %s" % rid_):
        dvapi.delete("book_requirementdetailses", rd["book_requirementdetailsid"])
    dvapi.delete("book_requirementses", rid_)


print("cleanup...")
set_lock("no")
try:
    for s in _q("book_stateswaps", "book_stateswapid,book_name", "startswith(book_name,'SWAP-FY27-TEST-')"):
        sid = s["book_stateswapid"]
        for d in _q("book_distributionses", "book_distributionsid", "_book_stateswap_value eq %s" % sid):
            dvapi.delete("book_distributionses", d["book_distributionsid"])
        for l in _q("book_ledgers", "book_ledgerid", "_book_stateswap_value eq %s" % sid):
            dvapi.delete("book_ledgers", l["book_ledgerid"])
        try: dvapi.delete("book_stateswaps", sid)  # cascades items + detail adjustments
        except Exception as e: print("  swap delete failed:", str(e)[:160])
    for r in _q("book_requirementses", "book_requirementsid,book_name", "startswith(book_name,'REQ-FY27-SW-')"):
        try: wipe_req(r["book_requirementsid"])
        except Exception as e: print("  requirement wipe failed:", str(e)[:160])
finally:
    set_lock("yes")

# ------------------------------------------------------------------ setup
roles = dvapi.get("systemusers(%s)?$select=systemuserid&$expand=systemuserroles_association($select=roleid)" % SP_USER)
if not any(r["roleid"] == CHECKBOOK_ADMIN_ROLE for r in roles.get("systemuserroles_association", [])):
    dvapi._req("POST", "systemusers(%s)/systemuserroles_association/$ref" % SP_USER,
               {"@odata.id": "%s/api/data/v9.2/roles(%s)" % (dvapi.ORG, CHECKBOOK_ADMIN_ROLE)})
    print("granted SP Checkbook Administrator")

G3 = rid("book_fundinglines", "G3-206510D27-111-TRNG-CON")
G4 = rid("book_fundinglines", "G4-202010D27-112-BASOPS-CON")
TX, OK = rid("book_states", "Texas"), rid("book_states", "Oklahoma")
FC = {TX: rid("book_fundcenters", "A18TX"), OK: rid("book_fundcenters", "A18OK")}
APE1 = rid("book_apes", "APE000001")


def loa_state(g):
    r = dvapi.get("book_fundinglines(%s)?$select=book_newtdp,book_newtdpremaining" % g)
    return r.get("book_newtdp") or 0, r.get("book_newtdpremaining") or 0


def mkreq(tag, state):
    return dvapi.post("book_requirementses", {
        "book_name": "REQ-FY27-SW-%s-%s" % (tag, TAG), "book_type": TYPE_STATE, "book_pomstatus": False,
        "book_statutoryjustification": "FY27 state swap validation (dev).",
        **ref("book_requirements", "book_fundcenter", "book_fundcenters", FC[state]),
        **ref("book_requirements", "book_ape", "book_apes", APE1),
    })


def mkrf(tag, req, loa, tdp):
    return dvapi.post("book_requirementfundings", {
        "book_name": "RF-FY27-SW-%s-%s" % (tag, TAG), "book_newfiscalyear": FY, "book_newtdp": tdp,
        **ref("book_requirementfunding", "book_requirement", "book_requirementses", req),
        **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", loa),
        **ref("book_requirementfunding", "book_ape", "book_apes", APE1),
    })


def mkrd(name, req, item, order, amt):
    return dvapi.post("book_requirementdetailses", {
        "book_name": name, "book_priorityorder": order,
        "book_validatedamount": amt, "book_fundedamount": amt,
        **ref("book_requirementdetails", "book_requirement", "book_requirementses", req),
        **ref("book_requirementdetails", "book_item", "book_items", rid("book_items", item)),
    })


def mkprio(tag, req, state, mode, requested=None, status=FINAL_APPROVED):
    body = {
        "book_name": "PRI-FY27-SW-%s" % tag, "book_newfiscalyear": FY,
        "book_approvalstatus": status, "book_quantities": 1, "book_fundingmode": mode,
        "book_statutoryjustification": "FY27 state swap validation (dev).",
        **ref("book_prioritization", "book_requirement", "book_requirementses", req),
        **ref("book_prioritization", "book_fundcenter", "book_fundcenters", FC[state]),
        **ref("book_prioritization", "book_state", "book_states", state),
    }
    if requested is not None: body["book_newrequestedamount"] = requested
    return dvapi.post("book_prioritizations", body)


def mkpf(prio, rf, amt):
    return dvapi.post("book_prioritizationfundings", {
        "book_fundedamount": amt, "book_validatedamount": amt,
        **ref("book_prioritizationfunding", "book_prioritization", "book_prioritizations", prio),
        **ref("book_prioritizationfunding", "book_requirementfunding", "book_requirementfundings", rf)})


def mkid(name, prio, rd, state, amt):
    return dvapi.post("book_itemizeddetailses", {
        "book_name": name, "book_quantity": 1,
        "book_requestedamount": amt, "book_validatedamount": amt, "book_fundedamount": amt,
        **ref("book_itemizeddetails", "book_prioritization", "book_prioritizations", prio),
        **ref("book_itemizeddetails", "book_requirementitem", "book_requirementdetailses", rd),
        **ref("book_itemizeddetails", "book_fundcenter", "book_fundcenters", FC[state])})


def pf_of(prio, rf):
    r = _q("book_prioritizationfundings", "book_prioritizationfundingid",
           "_book_prioritization_value eq %s and _book_requirementfunding_value eq %s and statecode eq 0" % (prio, rf))
    return r[0]["book_prioritizationfundingid"] if r else None


def pf_funded(pf): return val("book_prioritizationfundings", pf, "book_fundedamount")
def prio_val(p, col): return val("book_prioritizations", p, col)
def rf_val(rf, col): return val("book_requirementfundings", rf, col)


def detail_sum(prio):
    return sum(d.get("book_fundedamount") or 0 for d in _q(
        "book_itemizeddetailses", "book_fundedamount", "_book_prioritization_value eq %s and statecode eq 0" % prio))


print("\n########## setup ##########")
# TX-D: Direct, split G3 / G4.
reqTXA = mkreq("TXA", TX)
rfTXA3, rfTXA4 = mkrf("TXA3", reqTXA, G3, 30000), mkrf("TXA4", reqTXA, G4, 20000)
txD = mkprio("TXD", reqTXA, TX, MODE_DIRECT, requested=50000)
pfTXD3, pfTXD4 = mkpf(txD, rfTXA3, 30000), mkpf(txD, rfTXA4, 20000)

# TX-I: Itemized single-RF on G4 (auto PF).
reqTXB = mkreq("TXB", TX)
rdTX1 = mkrd("RD-SW-TX-RADIO-" + TAG, reqTXB, "ITEM-RADIO", 1, 12000)
rdTX2 = mkrd("RD-SW-TX-VEH-" + TAG, reqTXB, "ITEM-VEHICLE", 2, 8000)
rfTXB4 = mkrf("TXB4", reqTXB, G4, 20000)
txI = mkprio("TXI", reqTXB, TX, MODE_ITEMIZED)
idTX1 = mkid("ID-SW-TX-RADIO-" + TAG, txI, rdTX1, TX, 12000)
mkid("ID-SW-TX-VEH-" + TAG, txI, rdTX2, TX, 8000)
pfTXI4 = pf_of(txI, rfTXB4)
check("TX-I auto-allocated PF", pf_funded(pfTXI4) if pfTXI4 else None, 20000)

# OK-D: Direct, split G3 / G4; Requested == Funded so a credit must lift it.
reqOKA = mkreq("OKA", OK)
rfOKA3, rfOKA4 = mkrf("OKA3", reqOKA, G3, 10000), mkrf("OKA4", reqOKA, G4, 10000)
okD = mkprio("OKD", reqOKA, OK, MODE_DIRECT, requested=20000)
pfOKD3, pfOKD4 = mkpf(okD, rfOKA3, 10000), mkpf(okD, rfOKA4, 10000)

# OK-I: Itemized multi-RF (G3 + G4), PFs allocated by hand.
reqOKB = mkreq("OKB", OK)
rdOK1 = mkrd("RD-SW-OK-RADIO-" + TAG, reqOKB, "ITEM-RADIO", 1, 10000)
rdOK2 = mkrd("RD-SW-OK-VEH-" + TAG, reqOKB, "ITEM-VEHICLE", 2, 10000)
rfOKB3, rfOKB4 = mkrf("OKB3", reqOKB, G3, 10000), mkrf("OKB4", reqOKB, G4, 10000)
okI = mkprio("OKI", reqOKB, OK, MODE_ITEMIZED)
idOK1 = mkid("ID-SW-OK-RADIO-" + TAG, okI, rdOK1, OK, 10000)
mkid("ID-SW-OK-VEH-" + TAG, okI, rdOK2, OK, 10000)
pfOKI3, pfOKI4 = mkpf(okI, rfOKB3, 10000), mkpf(okI, rfOKB4, 10000)

# OK-X: an NPM Review Prio whose PF holds no funding — must not be swappable. (A Prio
# outside NPM Review can't be funded at all: an existing guard blocks it.)
reqOKX = mkreq("OKX", OK)
rfOKX4 = mkrf("OKX4", reqOKX, G4, 1000)
okX = mkprio("OKX", reqOKX, OK, MODE_DIRECT, requested=1000)
pfOKX4 = mkpf(okX, rfOKX4, 0)

for label, prio, want in (("TX-D total", txD, 50000), ("TX-I total", txI, 20000),
                          ("OK-D total", okD, 20000), ("OK-I total", okI, 20000)):
    check(label, prio_val(prio, "book_newfundedamounttdp"), want)
g3_before, g4_before = loa_state(G3), loa_state(G4)

# ------------------------------------------------------------------ swap + legs
swap = dvapi.post("book_stateswaps", {
    "book_name": "SWAP-FY27-TEST-" + TAG, "book_newfiscalyear": FY,
    **ref("book_stateswap", "book_statea", "book_states", TX),
    **ref("book_stateswap", "book_stateb", "book_states", OK),
})


def mkleg(debit_pf, amount, credit_pf=None):
    body = {"book_newamount": amount,
            **ref("book_swapitem", "book_stateswap", "book_stateswaps", swap),
            **ref("book_swapitem", "book_debitprioritizationfunding", "book_prioritizationfundings", debit_pf)}
    if credit_pf:
        body.update(ref("book_swapitem", "book_creditprioritizationfunding", "book_prioritizationfundings", credit_pf))
    return dvapi.post("book_swapitems", body)


def set_credit(item, credit_pf):
    dvapi.patch("book_swapitems", item, ref("book_swapitem", "book_creditprioritizationfunding",
                                            "book_prioritizationfundings", credit_pf))


def mkadj(es, entity, detail, amount):
    return dvapi.post(es, {"book_newamount": amount,
                           **ref(entity, "book_stateswap", "book_stateswaps", swap),
                           **ref(entity, "book_itemizeddetail", "book_itemizeddetailses", detail)})


def approve(**flags): dvapi.patch("book_stateswaps", swap, flags)


print("\n########## legs (debit-first drafting, then credits) ##########")
L1 = mkleg(pfTXD3, 5000)
L2 = mkleg(pfTXD4, 6000)
L3 = mkleg(pfTXI4, 4000)
L4 = mkleg(pfOKD3, 2000, pfTXD3)
check("L1 derived debit Prio = TX-D", 1 if val("book_swapitems", L1, "_book_debitprioritization_value") == txD else 0, 1)
check("L1 credit Prio empty until paired", 1 if val("book_swapitems", L1, "_book_creditprioritization_value") is None else 0, 1)
check("swap not ready while unpaired", 1 if not val("book_stateswaps", swap, "book_isbalanced") else 0, 1)

expect_block("Fund/PG mismatch (G3 -> G4)", lambda: set_credit(L1, pfOKD4), "same Fund and PG")
expect_block("credit PF with no funding", lambda: set_credit(L3, pfOKX4), "has no funding")
set_credit(L1, pfOKD3)
set_credit(L2, pfOKI4)
set_credit(L3, pfOKD4)
check("L1 derived credit Prio = OK-D", 1 if val("book_swapitems", L1, "_book_creditprioritization_value") == okD else 0, 1)
check("swap ready once paired", 1 if val("book_stateswaps", swap, "book_isbalanced") else 0, 1)
check("total sent by TX", val("book_stateswaps", swap, "book_totalsentbya"), 15000)
check("total sent by OK", val("book_stateswaps", swap, "book_totalsentbyb"), 2000)

print("\n########## approval blocks ##########")
expect_block("debit itemized without detail reduction", lambda: approve(book_stateaapproved=True), "reduce its Itemized Details")
red = mkadj("book_swapdetailreductions", "book_swapdetailreduction", idTX1, 4000)
expect_block("credit itemized without detail increase", lambda: approve(book_stateaapproved=True), "increase its Itemized Details")
inc = mkadj("book_swapdetailincreases", "book_swapdetailincrease", idOK1, 6000)
dvapi.patch("book_swapitems", L1, {"book_newamount": 31000})
expect_block("PF over-draw (L1 31k of 30k)", lambda: approve(book_stateaapproved=True), "holds only")
dvapi.patch("book_swapitems", L1, {"book_newamount": 5000})

print("\n########## State A -> lock -> State B -> BE ##########")
approve(book_stateaapproved=True)
check("State A approved", 1 if val("book_stateswaps", swap, "book_stateaapproved") else 0, 1)
expect_block("edit a leg after State A approval", lambda: dvapi.patch("book_swapitems", L1, {"book_newamount": 4000}), "can no longer be added")
expect_block("add a detail row after State A approval",
             lambda: mkadj("book_swapdetailincreases", "book_swapdetailincrease", idOK1, 1), "can no longer be added")
approve(book_statebapproved=True)
approve(book_beapproved=True)

print("\n########## after BE approval ##########")
check("swap deactivated", val("book_stateswaps", swap, "statecode"), 1)
check("TX-D PF G3 (30 - 5 + 2)", pf_funded(pfTXD3), 27000)
check("TX-D PF G4 (20 - 6)", pf_funded(pfTXD4), 14000)
check("TX-D funded", prio_val(txD, "book_newfundedamounttdp"), 41000)
check("TX-D requested unchanged", prio_val(txD, "book_newrequestedamount"), 50000)
check("TX-I PF G4 (20 - 4)", pf_funded(pfTXI4), 16000)
check("TX-I total", prio_val(txI, "book_newfundedamounttdp"), 16000)
check("TX-I details", detail_sum(txI), 16000)
check("OK-D PF G3 (10 + 5 - 2)", pf_funded(pfOKD3), 13000)
check("OK-D PF G4 (10 + 4)", pf_funded(pfOKD4), 14000)
check("OK-D funded", prio_val(okD, "book_newfundedamounttdp"), 27000)
check("OK-D requested lifted to funded", prio_val(okD, "book_newrequestedamount"), 27000)
check("OK-I PF G4 (10 + 6)", pf_funded(pfOKI4), 16000)
check("OK-I PF G3 untouched", pf_funded(pfOKI3), 10000)
check("OK-I total", prio_val(okI, "book_newfundedamounttdp"), 26000)
check("OK-I details", detail_sum(okI), 26000)
for label, rf, want in (("RF TXA3", rfTXA3, 27000), ("RF TXA4", rfTXA4, 14000), ("RF TXB4", rfTXB4, 16000),
                        ("RF OKA3", rfOKA3, 13000), ("RF OKA4", rfOKA4, 14000),
                        ("RF OKB3", rfOKB3, 10000), ("RF OKB4", rfOKB4, 16000)):
    check(label + " TDP", rf_val(rf, "book_newtdp"), want)
    check(label + " funded", rf_val(rf, "book_newfundedamount"), want)
g3_after, g4_after = loa_state(G3), loa_state(G4)
check("G3 TDP unchanged", g3_after[0], g3_before[0])
check("G3 remaining unchanged", g3_after[1], g3_before[1])
check("G4 TDP unchanged", g4_after[0], g4_before[0])
check("G4 remaining unchanged", g4_after[1], g4_before[1])
check("no ledgers (same-LOA legs)", len(_q("book_ledgers", "book_ledgerid", "_book_stateswap_value eq %s" % swap)), 0)
dists = _q("book_distributionses", "book_newamount", "_book_stateswap_value eq %s" % swap)
print("  distributions linked to the swap: %d (G4 has AFP 50 %% / Allotment 25 %% events if fy27_turnin_validate ran)" % len(dists))

print("\nRESULT: %s" % ("PASS" if not fails else "FAIL: " + ", ".join(fails)))
