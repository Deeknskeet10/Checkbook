#!/usr/bin/env python3
"""End-to-end validation of the FY27 OPR (RF->RF) realignment path with Requirement Detail
Funding adjustments (docs/Realignment-FY27-Redesign.md §9.9).

Debit:  RF-TX-FY27-D (direct-funded, seeded by fy27_chain.py on the G4 LOA):
        TDP 500k = Funded 350k (RDF-B-AMMO 200k + RDF-B-MED 150k) + Withholding 150k.
Credit: a fresh direct-funded Requirement on the same G4 LOA: 2 RDs, RF-E with TDP 0.

One OPR item moves 200k RF-D -> RF-E. Withholding covers 150k, so 50k must come out of
RF-D's RDF junctions; on the credit side 150k of the 200k is pushed into RF-E's details.

  Test A: BE-approve with NO RDF reductions          -> MUST be blocked by RealignmentValidator.
  Test B: add 50k reduction on RDF-B-MED, increases RD-E1 80k + RD-E2 70k, BE-approve
          -> RF-D tdp 500k->300k, funded 350k->300k, RDF-B-MED 150k->100k
          -> RF-E tdp 0->200k, funded 0->150k (withholding 50k), RDF E1 80k / E2 70k
          -> G4 LOA remaining unchanged, realignment deactivated.

Same LOA (G4) -> no ledger, no distributions. Each run seeds fresh records (names tagged with a
run id); it mutates RF-TX-FY27-D, so re-seed via fy27_cleanup.py + fy27_chain.py to re-run.
"""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, TYPE_STATE, MODE_OPR, APPROVED = 2027, 0, 1, 0
SP_USER = "3f90bd45-7cbe-f111-aaaf-70a8a5af378b"
CHECKBOOK_ADMIN_ROLE = "14ee21c6-2121-f011-998a-001dd805b842"
AMOUNT, REDUCE, INC1, INC2 = 200000, 50000, 80000, 70000
TAG = time.strftime("%m%d%H%M")


def ref(entity, attr, es, gid):
    nav = dvapi.navprop(entity, attr)
    if not nav: raise SystemExit("no nav prop for %s.%s" % (entity, attr))
    return {"%s@odata.bind" % nav: "/%s(%s)" % (es, gid)}


def rid(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit("NOT FOUND %s '%s'" % (es, name))
    return g


def rf_state(g):
    r = dvapi.get("book_requirementfundings(%s)?$select=book_newtdp,book_newfundedamount,book_newwithholding" % g)
    return r.get("book_newtdp"), r.get("book_newfundedamount"), r.get("book_newwithholding")


def rdf_funded(rd, rf):
    rows = dvapi.query("book_requirementdetailfundings", **{
        "$select": "book_fundedamount",
        "$filter": "_book_requirementdetail_value eq %s and _book_requirementfunding_value eq %s and statecode eq 0" % (rd, rf)})
    return rows[0]["book_fundedamount"] if rows else None


def loa_remaining(g):
    return dvapi.get("book_fundinglines(%s)?$select=book_newtdpremaining" % g).get("book_newtdpremaining")


fails = []
def check(label, got, want):
    ok = got is not None and abs(float(got) - float(want)) < 0.01
    print("  %s %-40s got=%s want=%s" % ("OK " if ok else "BAD", label, got, want))
    if not ok: fails.append(label)


# 0) SP admin role (approval gate bypass). Idempotent.
roles = dvapi.get("systemusers(%s)?$select=systemuserid&$expand=systemuserroles_association($select=roleid)" % SP_USER)
if not any(r.get("roleid") == CHECKBOOK_ADMIN_ROLE for r in roles.get("systemuserroles_association", [])):
    dvapi._req("POST", "systemusers(%s)/systemuserroles_association/$ref" % SP_USER,
               {"@odata.id": "%s/api/data/v9.2/roles(%s)" % (dvapi.ORG, CHECKBOOK_ADMIN_ROLE)})

G4 = rid("book_fundinglines", "G4-202010D27-112-BASOPS-CON")
rfD = rid("book_requirementfundings", "G4-202010D27-112-BASOPS-CON-REQ-TX-FY27-D")
rdfMed = rid("book_requirementdetailfundings", "RDF-B-MED")
rdMed = dvapi.get("book_requirementdetailfundings(%s)?$select=_book_requirementdetail_value" % rdfMed)["_book_requirementdetail_value"]

tdp, funded, wh = rf_state(rfD)
print("debit RF-D before: tdp=%s funded=%s withholding=%s" % (tdp, funded, wh))
if (tdp, funded, wh) != (500000, 350000, 150000):
    raise SystemExit("RF-D is not at the seeded 500k/350k/150k — re-seed (fy27_cleanup.py + fy27_chain.py).")
rem_before = loa_remaining(G4)

# 1) Credit side: fresh direct-funded Requirement + 2 RDs + RF-E (TDP 0) on G4.
print("\nseeding credit requirement (tag %s)..." % TAG)
reqE = dvapi.post("book_requirementses", {
    "book_name": "REQ-TX-FY27-OPRC-" + TAG, "book_type": TYPE_STATE, "book_pomstatus": False,
    "book_statutoryjustification": "FY27 OPR realignment credit target (dev seed).",
    **ref("book_requirements", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_requirements", "book_ape", "book_apes", rid("book_apes", "APE000002")),
})
def mkrd(name, item, order, validated):
    return dvapi.post("book_requirementdetailses", {
        "book_name": name, "book_priorityorder": order,
        "book_validatedamount": validated, "book_fundedamount": 0,
        **ref("book_requirementdetails", "book_requirement", "book_requirementses", reqE),
        **ref("book_requirementdetails", "book_item", "book_items", rid("book_items", item)),
    })
rdE1 = mkrd("RD-E-AMMO-" + TAG, "ITEM-AMMO", 1, 100000)
rdE2 = mkrd("RD-E-MED-" + TAG, "ITEM-MED", 2, 100000)
rfE = dvapi.post("book_requirementfundings", {
    "book_name": "RF-TX-FY27-OPRC-" + TAG, "book_newfiscalyear": FY, "book_newtdp": 0,
    **ref("book_requirementfunding", "book_requirement", "book_requirementses", reqE),
    **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", G4),
    **ref("book_requirementfunding", "book_ape", "book_apes", rid("book_apes", "APE000002")),
})
print("  credit RF-E:", rf_state(rfE))

# 2) OPR realignment + one RF->RF item.
rl = dvapi.post("book_realignmentses", {
    "book_name": "REALIGN-OPR-" + TAG, "book_newfiscalyear": FY, "book_realignmententrymode": MODE_OPR,
})
dvapi.post("book_realignmentitems", {
    "book_newamount": AMOUNT,
    **ref("book_realignmentitem", "book_realignment", "book_realignmentses", rl),
    **ref("book_realignmentitem", "book_debitrequirementfunding", "book_requirementfundings", rfD),
    **ref("book_realignmentitem", "book_creditrequirementfunding", "book_requirementfundings", rfE),
})
p = dvapi.get("book_realignmentses(%s)?$select=book_totalamount,book_itemcount,book_allsamefundsag" % rl)
print("  realignment rollup: total=%s items=%s allsame=%s" % (p.get("book_totalamount"), p.get("book_itemcount"), p.get("book_allsamefundsag")))

# Test A: no RDF reductions -> blocked.
print("\nTest A: BE approve with no RDF reductions (expect block)")
try:
    dvapi.patch("book_realignmentses", rl, {"book_bedecision": APPROVED})
    print("  BAD: approval went through")
    fails.append("Test A not blocked")
except RuntimeError as e:
    msg = str(e)
    blocked = "Requirement Detail" in msg
    print("  %s blocked: %s" % ("OK " if blocked else "BAD", msg[msg.find("message") : msg.find("message") + 260]))
    if not blocked: fails.append("Test A wrong error")

# Test B: balanced reductions + credit increases -> executes.
print("\nTest B: 50k RDF reduction + 150k RD increases, BE approve")
dvapi.post("book_realignmentrdfreductions", {
    "book_newamount": REDUCE,
    **ref("book_realignmentrdfreduction", "book_realignment", "book_realignmentses", rl),
    **ref("book_realignmentrdfreduction", "book_requirementdetailfunding", "book_requirementdetailfundings", rdfMed),
})
for rd, amt in ((rdE1, INC1), (rdE2, INC2)):
    dvapi.post("book_realignmentrdfincreases", {
        "book_newamount": amt,
        **ref("book_realignmentrdfincrease", "book_realignment", "book_realignmentses", rl),
        **ref("book_realignmentrdfincrease", "book_requirementdetail", "book_requirementdetailses", rd),
        **ref("book_realignmentrdfincrease", "book_requirementfunding", "book_requirementfundings", rfE),
    })
dvapi.patch("book_realignmentses", rl, {"book_bedecision": APPROVED})

tdp, funded, wh = rf_state(rfD)
check("RF-D tdp", tdp, 300000)
check("RF-D funded", funded, 300000)
check("RF-D withholding", wh, 0)
check("RDF-B-MED funded", rdf_funded(rdMed, rfD), 100000)
tdp, funded, wh = rf_state(rfE)
check("RF-E tdp", tdp, AMOUNT)
check("RF-E funded", funded, INC1 + INC2)
check("RF-E withholding", wh, AMOUNT - INC1 - INC2)
check("RDF E1 funded", rdf_funded(rdE1, rfE), INC1)
check("RDF E2 funded", rdf_funded(rdE2, rfE), INC2)
check("G4 LOA remaining unchanged", loa_remaining(G4), rem_before)
st = dvapi.get("book_realignmentses(%s)?$select=statecode" % rl).get("statecode")
check("realignment deactivated (statecode)", st, 1)

print("\nRESULT:", "PASS" if not fails else "FAIL %s" % fails)
