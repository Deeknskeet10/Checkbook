#!/usr/bin/env python3
"""Phase 2: Requirements -> RFs -> approved Prioritizations -> funding junctions, on the generated LOAs."""
import sys
sys.path.insert(0, "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad")
import dvapi

FY, NPM_REVIEW, TYPE_STATE = 2026, 4, 0
def bind(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit(f"REF NOT FOUND {es} '{name}'")
    return f"/{es}({g})"

# identify the two generated LOAs by TDP
loas = {int(l["book_newtdp"]): l["book_fundinglineid"]
        for l in dvapi.get("book_fundinglines?$select=book_newtdp").get("value", []) if l.get("book_newtdp")}
loa1, loa2 = loas[1000000], loas[500000]   # OMNG 1M, OMA 500k
print("LOAs:", loa1[:8], loa2[:8])
mdep = {m: dvapi.find_id("book_mdeps", m) for m in ("QZMO", "WZMO")}

def mkreq(name, md, ape):
    return dvapi.post("book_requirementses", {
        "book_name": name, "book_type": TYPE_STATE, "book_pomstatus": False,
        "book_statutoryjustification": "Sample requirement for dev sandbox.",
        "book_FundCenter@odata.bind": bind("book_fundcenters", "A18TX"),
        "book_MDEP@odata.bind": f"/book_mdeps({mdep[md]})",
        "book_APE@odata.bind": bind("book_apes", ape)})
r1 = mkreq("REQ-TX-001", "QZMO", "APE000001")
r2 = mkreq("REQ-TX-002", "QZMO", "APE000002")
r3 = mkreq("REQ-TX-003", "WZMO", "APE000003")
print("requirements:", [bool(x) for x in (r1, r2, r3)])

def mkrf(name, rid, loaid, ape, md, tdp):
    g = dvapi.post("book_requirementfundings", {
        "book_name": name, "book_newfiscalyear": FY, "book_newtdp": tdp,
        "book_Requirement@odata.bind": f"/book_requirementses({rid})",
        "book_LineofAccounting@odata.bind": f"/book_fundinglines({loaid})",
        "book_APE@odata.bind": bind("book_apes", ape),
        "book_MDEP@odata.bind": f"/book_mdeps({mdep[md]})"})
    return g
rf1 = mkrf("RF-TX-001", r1, loa1, "APE000001", "QZMO", 300000)
rf2 = mkrf("RF-TX-002", r2, loa1, "APE000002", "QZMO", 250000)
rf3 = mkrf("RF-TX-003", r3, loa2, "APE000003", "WZMO", 150000)
print("rfs:", [bool(x) for x in (rf1, rf2, rf3)])

def mkprio(name, rid, rfid, loaid, md, req_amt, val_amt, fund_amt):
    return dvapi.post("book_prioritizations", {
        "book_name": name, "book_newfiscalyear": FY, "book_approvalstatus": NPM_REVIEW,
        "book_quantities": 1, "book_statutoryjustification": "Sample prioritization.",
        "book_newrequestedamount": req_amt, "book_validatedamount": val_amt, "book_newfundedamounttdp": fund_amt,
        "book_Requirement@odata.bind": f"/book_requirementses({rid})",
        "book_RequirementFunding@odata.bind": f"/book_requirementfundings({rfid})",
        "book_LineofAccounting@odata.bind": f"/book_fundinglines({loaid})",
        "book_FundCenter@odata.bind": bind("book_fundcenters", "A18TX"),
        "book_MDEP@odata.bind": f"/book_mdeps({mdep[md]})",
        "book_State@odata.bind": bind("book_states", "Texas")})
p1 = mkprio("PRI-TX-001", r1, rf1, loa1, "QZMO", 300000, 300000, 250000)
p2 = mkprio("PRI-TX-002", r2, rf2, loa1, "QZMO", 200000, 200000, 200000)
p3 = mkprio("PRI-TX-003", r3, rf3, loa2, "WZMO", 150000, 150000, 100000)
print("prioritizations:", [bool(x) for x in (p1, p2, p3)])

# NOTE: do NOT create book_prioritizationfunding rows for single-RF Prioritizations —
# setting the Prio's funded amount funds its RF directly (a manual junction double-counts
# and trips the PrioritizationFundingRollup TDP cap). Junctions are only for splitting
# one Prioritization across multiple RFs.

print("\n===== ROLL-UP CHECK =====")
for name, rid in (("RF-001", rf1), ("RF-002", rf2), ("RF-003", rf3)):
    r = dvapi.get(f"book_requirementfundings({rid})?$select=book_newtdp,book_newfundedamount,book_newvalidatedamount,book_newunfundedamount")
    print(f"  {name}: tdp={r.get('book_newtdp')} funded={r.get('book_newfundedamount')} validated={r.get('book_newvalidatedamount')} unfunded={r.get('book_newunfundedamount')}")
for name, lid in (("LOA-OMNG", loa1), ("LOA-OMA", loa2)):
    r = dvapi.get(f"book_fundinglines({lid})?$select=book_newtdp,book_newtdpremaining")
    print(f"  {name}: tdp={r.get('book_newtdp')} remaining={r.get('book_newtdpremaining')}")
for name, pid in (("PRI-001", p1), ("PRI-002", p2), ("PRI-003", p3)):
    r = dvapi.get(f"book_prioritizations({pid})?$select=book_newrequestedamount,book_newfundedamounttdp,book_unfundedamount")
    print(f"  {name}: requested={r.get('book_newrequestedamount')} funded={r.get('book_newfundedamounttdp')} unfunded={r.get('book_unfundedamount')}")
