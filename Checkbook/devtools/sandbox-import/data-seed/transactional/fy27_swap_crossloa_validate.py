#!/usr/bin/env python3
"""FY27 State Swap — cross-LOA legs and their ledger pairs (docs/StateSwap-FY27-Redesign.md §6 step 2).

fy27_swap_validate.py keeps every leg on one LOA (the sandbox had one OPR LOA per Fund/PG), so
it never writes ledgers. This seeds a second OPR LOA with the same Fund + PG as G3:
  FT-G5-TRNG-FY27 -> book_GenerateLOAs -> G5-206510D27-111-TRNG-CON  (same Fund / SAG / FP / Category)
and swaps across the two:
  TX-D  Direct  PF on RF TXC3 (G3) 30k   requested 30k
  OK-D  Direct  PF on RF OKC5 (G5) 10k   requested 10k (= funded)
  L1  TX-D G3 -> OK-D G5   5k
  L2  OK-D G5 -> TX-D G3   2k   (TX-D's PF is debited by L1 and credited by L2)
Expected after BE approval: one linked Swap ledger pair per leg (4 rows); G3 TDP -3k, G5 TDP +3k,
both LOAs' remaining unchanged (each RF TDP moves with its LOA); PFs / RFs / Prios net 27k / 13k;
OK-D Requested lifted to 13k, TX-D Requested unchanged.
Cleans up its own swaps / Requirements from earlier runs first (lock toggled off). The G5
funding track / LOA are reference data and stay.
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/data-seed/transactional/fy27_swap_crossloa_validate.py
"""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, TYPE_STATE, MODE_DIRECT, CON = 2027, 4, 0, 0, 3
LEDGER_SWAP, CREDITED, DEBITED = 2, 0, 1
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


def val(es, gid, col):
    return dvapi.get("%s(%s)?$select=%s" % (es, gid, col)).get(col)


def set_lock(v): dvapi.patch("environmentvariablevalues", LOCK_VAL_ID, {"value": v})


# ------------------------------------------------------------------ cleanup earlier runs
def wipe_req(rid_):
    for p in _q("book_prioritizations", "book_prioritizationid", "_book_requirement_value eq %s" % rid_):
        pid = p["book_prioritizationid"]
        for pf in _q("book_prioritizationfundings", "book_prioritizationfundingid", "_book_prioritization_value eq %s" % pid):
            dvapi.delete("book_prioritizationfundings", pf["book_prioritizationfundingid"])
        dvapi.delete("book_prioritizations", pid)
    for rf in _q("book_requirementfundings", "book_requirementfundingid", "_book_requirement_value eq %s" % rid_):
        dvapi.delete("book_requirementfundings", rf["book_requirementfundingid"])
    dvapi.delete("book_requirementses", rid_)


print("cleanup...")
set_lock("no")
try:
    for s in _q("book_stateswaps", "book_stateswapid", "startswith(book_name,'SWAP-FY27-XLOA-')"):
        sid = s["book_stateswapid"]
        for d in _q("book_distributionses", "book_distributionsid", "_book_stateswap_value eq %s" % sid):
            dvapi.delete("book_distributionses", d["book_distributionsid"])
        for l in _q("book_ledgers", "book_ledgerid", "_book_stateswap_value eq %s" % sid):
            dvapi.delete("book_ledgers", l["book_ledgerid"])
        try: dvapi.delete("book_stateswaps", sid)
        except Exception as e: print("  swap delete failed:", str(e)[:160])
    for r in _q("book_requirementses", "book_requirementsid", "startswith(book_name,'REQ-FY27-SX-')"):
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

print("\n########## second OPR LOA (G5) with G3's Fund + PG ##########")
if not dvapi.find_id("book_fundinglines", "G5-206510D27-111-TRNG-CON"):
    if not dvapi.find_id("book_fundingtracks", "FT-G5-TRNG-FY27"):
        dvapi.post("book_fundingtracks", {
            "book_name": "FT-G5-TRNG-FY27", "book_fiscalyear": FY,
            "book_beginningbalancereadonly": 500000, "book_category": CON,
            "book_Fund@odata.bind": "/book_funds(%s)" % rid("book_funds", "206510D27"),
            "book_DisbursingOfficial@odata.bind": "/book_oprs(%s)" % rid("book_oprs", "G5"),
            "book_PG@odata.bind": "/book_pgs(%s)" % rid("book_pgs", "10010"),
            "book_SAG@odata.bind": "/book_sags(%s)" % rid("book_sags", "111"),
        })
        print("  created FT-G5-TRNG-FY27")
    dvapi.action("book_GenerateLOAs", {"FiscalYear": FY, "BatchSize": 100})
G3 = rid("book_fundinglines", "G3-206510D27-111-TRNG-CON")
G5 = rid("book_fundinglines", "G5-206510D27-111-TRNG-CON")
loa_cols = "book_newtdp,book_newtdpremaining,_book_fund_value,_book_pg_value"
g3, g5 = dvapi.get("book_fundinglines(%s)?$select=%s" % (G3, loa_cols)), dvapi.get("book_fundinglines(%s)?$select=%s" % (G5, loa_cols))
check("G5 same Fund as G3", 1 if g5["_book_fund_value"] == g3["_book_fund_value"] else 0, 1)
check("G5 same PG as G3", 1 if g5["_book_pg_value"] == g3["_book_pg_value"] else 0, 1)
print("  G3 tdp=%s remaining=%s · G5 tdp=%s remaining=%s" % (
    g3["book_newtdp"], g3["book_newtdpremaining"], g5["book_newtdp"], g5["book_newtdpremaining"]))

TX, OK = rid("book_states", "Texas"), rid("book_states", "Oklahoma")
FC = {TX: rid("book_fundcenters", "A18TX"), OK: rid("book_fundcenters", "A18OK")}
APE1 = rid("book_apes", "APE000001")


def mkreq(tag, state):
    return dvapi.post("book_requirementses", {
        "book_name": "REQ-FY27-SX-%s-%s" % (tag, TAG), "book_type": TYPE_STATE, "book_pomstatus": False,
        "book_statutoryjustification": "FY27 cross-LOA state swap validation (dev).",
        **ref("book_requirements", "book_fundcenter", "book_fundcenters", FC[state]),
        **ref("book_requirements", "book_ape", "book_apes", APE1),
    })


def mkrf(tag, req, loa, tdp):
    return dvapi.post("book_requirementfundings", {
        "book_name": "RF-FY27-SX-%s-%s" % (tag, TAG), "book_newfiscalyear": FY, "book_newtdp": tdp,
        **ref("book_requirementfunding", "book_requirement", "book_requirementses", req),
        **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", loa),
        **ref("book_requirementfunding", "book_ape", "book_apes", APE1),
    })


def mkprio(tag, req, state, requested):
    return dvapi.post("book_prioritizations", {
        "book_name": "PRI-FY27-SX-%s" % tag, "book_newfiscalyear": FY,
        "book_approvalstatus": FINAL_APPROVED, "book_quantities": 1, "book_fundingmode": MODE_DIRECT,
        "book_newrequestedamount": requested,
        "book_statutoryjustification": "FY27 cross-LOA state swap validation (dev).",
        **ref("book_prioritization", "book_requirement", "book_requirementses", req),
        **ref("book_prioritization", "book_fundcenter", "book_fundcenters", FC[state]),
        **ref("book_prioritization", "book_state", "book_states", state),
    })


def mkpf(prio, rf, amt):
    return dvapi.post("book_prioritizationfundings", {
        "book_fundedamount": amt, "book_validatedamount": amt,
        **ref("book_prioritizationfunding", "book_prioritization", "book_prioritizations", prio),
        **ref("book_prioritizationfunding", "book_requirementfunding", "book_requirementfundings", rf)})


def loa_state(g):
    r = dvapi.get("book_fundinglines(%s)?$select=book_newtdp,book_newtdpremaining" % g)
    return r.get("book_newtdp") or 0, r.get("book_newtdpremaining") or 0


print("\n########## setup ##########")
reqTX = mkreq("TXC", TX)
rfTX3 = mkrf("TXC3", reqTX, G3, 30000)
txD = mkprio("TXC", reqTX, TX, 30000)
pfTX3 = mkpf(txD, rfTX3, 30000)
reqOK = mkreq("OKC", OK)
rfOK5 = mkrf("OKC5", reqOK, G5, 10000)
okD = mkprio("OKC", reqOK, OK, 10000)
pfOK5 = mkpf(okD, rfOK5, 10000)
check("TX-D funded", val("book_prioritizations", txD, "book_newfundedamounttdp"), 30000)
check("OK-D funded", val("book_prioritizations", okD, "book_newfundedamounttdp"), 10000)
# Earlier runs' ledgers were deleted in cleanup: reconcile FY27 LOA TDP so the baseline is true.
dvapi.action("book_RecalculateLOATDP", {"FiscalYear": FY})
g3_before, g5_before = loa_state(G3), loa_state(G5)
print("  before: G3 tdp/remaining=%s · G5 tdp/remaining=%s" % (g3_before, g5_before))

swap = dvapi.post("book_stateswaps", {
    "book_name": "SWAP-FY27-XLOA-" + TAG, "book_newfiscalyear": FY,
    **ref("book_stateswap", "book_statea", "book_states", TX),
    **ref("book_stateswap", "book_stateb", "book_states", OK),
})


def mkleg(debit_pf, credit_pf, amount):
    return dvapi.post("book_swapitems", {
        "book_newamount": amount,
        **ref("book_swapitem", "book_stateswap", "book_stateswaps", swap),
        **ref("book_swapitem", "book_debitprioritizationfunding", "book_prioritizationfundings", debit_pf),
        **ref("book_swapitem", "book_creditprioritizationfunding", "book_prioritizationfundings", credit_pf)})


print("\n########## legs + approval ##########")
L1 = mkleg(pfTX3, pfOK5, 5000)
L2 = mkleg(pfOK5, pfTX3, 2000)
check("swap ready", 1 if val("book_stateswaps", swap, "book_isbalanced") else 0, 1)
for flag in ("book_stateaapproved", "book_statebapproved", "book_beapproved"):
    dvapi.patch("book_stateswaps", swap, {flag: True})

print("\n########## after BE approval ##########")
check("swap deactivated", val("book_stateswaps", swap, "statecode"), 1)
check("TX PF (30 - 5 + 2)", val("book_prioritizationfundings", pfTX3, "book_fundedamount"), 27000)
check("OK PF (10 - 2 + 5)", val("book_prioritizationfundings", pfOK5, "book_fundedamount"), 13000)
check("TX-D funded", val("book_prioritizations", txD, "book_newfundedamounttdp"), 27000)
check("OK-D funded", val("book_prioritizations", okD, "book_newfundedamounttdp"), 13000)
check("TX-D requested unchanged", val("book_prioritizations", txD, "book_newrequestedamount"), 30000)
check("OK-D requested lifted to funded", val("book_prioritizations", okD, "book_newrequestedamount"), 13000)
for label, rf, want in (("RF TXC3 (G3)", rfTX3, 27000), ("RF OKC5 (G5)", rfOK5, 13000)):
    check(label + " TDP", val("book_requirementfundings", rf, "book_newtdp"), want)
    check(label + " funded", val("book_requirementfundings", rf, "book_newfundedamount"), want)

ledgers = _q("book_ledgers",
             "book_newamount,book_ledgerdirection,book_ledgertype,_book_lineofaccounting_value,_book_relatedentry_value,statecode",
             "_book_stateswap_value eq %s" % swap)
check("ledger rows (one pair per leg)", len(ledgers), 4)
check("all ledgers type Swap", sum(1 for l in ledgers if l["book_ledgertype"] == LEDGER_SWAP), 4)
check("all ledgers active", sum(1 for l in ledgers if l["statecode"] == 0), 4)
def amt(loa, direction):
    return sum(l["book_newamount"] for l in ledgers
               if l["_book_lineofaccounting_value"] == loa and l["book_ledgerdirection"] == direction)
check("G3 debited (L1)", amt(G3, DEBITED), 5000)
check("G5 credited (L1)", amt(G5, CREDITED), 5000)
check("G5 debited (L2)", amt(G5, DEBITED), 2000)
check("G3 credited (L2)", amt(G3, CREDITED), 2000)
by_id = {l["book_ledgerid"]: l for l in ledgers}
linked = all(l["_book_relatedentry_value"] in by_id
             and by_id[l["_book_relatedentry_value"]]["_book_relatedentry_value"] == l["book_ledgerid"]
             and by_id[l["_book_relatedentry_value"]]["book_ledgerdirection"] != l["book_ledgerdirection"]
             and by_id[l["_book_relatedentry_value"]]["book_newamount"] == l["book_newamount"]
             for l in ledgers)
check("each debit <-> credit linked both ways", 1 if linked else 0, 1)

g3_after, g5_after = loa_state(G3), loa_state(G5)
print("  after:  G3 tdp/remaining=%s · G5 tdp/remaining=%s" % (g3_after, g5_after))
check("G3 TDP (-5k + 2k)", g3_after[0], g3_before[0] - 3000)
check("G5 TDP (+5k - 2k)", g5_after[0], g5_before[0] + 3000)
check("G3 remaining unchanged", g3_after[1], g3_before[1])
check("G5 remaining unchanged", g5_after[1], g5_before[1])
dists = _q("book_distributionses", "book_newamount", "_book_stateswap_value eq %s" % swap)
print("  distributions linked to the swap: %d (0 expected unless a Funding Event covers G3/G5's Fund/PG;"
      " the sandbox only has G4 events)" % len(dists))

print("\nRESULT: %s" % ("PASS" if not fails else "FAIL: " + ", ".join(fails)))
