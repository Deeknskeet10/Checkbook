#!/usr/bin/env python3
"""Phase 1: Funding Tracks (Beginning Balance) -> Generate LOAs -> verify TDP."""
import sys
sys.path.insert(0, "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad")
import dvapi

FY = 2026
def bind(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit(f"REF NOT FOUND {es} '{name}'")
    return f"/{es}({g})"

# MDEPs (reference gap)
mdep = {m: (dvapi.find_id("book_mdeps", m) or dvapi.post("book_mdeps", {"book_name": m})) for m in ("QZMO", "WZMO")}
print("mdeps:", list(mdep))

# BOC + DollarType (needed for FY26 LOA grain: OPR-Fund-BOC-DT-{PG|SAG}-MDEP)
boc = dvapi.find_id("book_bocs", "0001") or dvapi.post("book_bocs", {"book_name": "0001"})
dt = {}
for d in ("BASE", "OOC"):
    dt[d] = dvapi.find_id("book_dollartypes", d) or dvapi.post("book_dollartypes", {"book_name": d})
print("boc:", bool(boc), "dollartypes:", list(dt))

# Funding Tracks with Beginning Balance + full FY26 grain
def mkft(name, bb, fund, pg, opr, sag, md, dollartype):
    grain = {
        "book_BOC@odata.bind": f"/book_bocs({boc})",
        "book_DollarType@odata.bind": f"/book_dollartypes({dt[dollartype]})",
    }
    g = dvapi.find_id("book_fundingtracks", name)
    if g:
        dvapi.patch("book_fundingtracks", g, {"book_beginningbalancereadonly": bb, **grain}); return g
    return dvapi.post("book_fundingtracks", {
        "book_name": name, "book_fiscalyear": FY, "book_beginningbalancereadonly": bb,
        "book_Fund@odata.bind": bind("book_funds", fund),
        "book_PG@odata.bind": bind("book_pgs", pg),
        "book_DisbursingOfficial@odata.bind": bind("book_oprs", opr),
        "book_SAG@odata.bind": bind("book_sags", sag),
        "book_MDEP@odata.bind": f"/book_mdeps({mdep[md]})", **grain})

ft1 = mkft("FT-TX-OMNG-FY26", 1000000, "206510D26", "10010", "G3", "111", "QZMO", "BASE")
ft2 = mkft("FT-TX-OMA-FY26",   500000, "202010D26", "10020", "G4", "112", "WZMO", "BASE")
print("funding tracks:", bool(ft1), bool(ft2))
for n, g in (("FT1", ft1), ("FT2", ft2)):
    r = dvapi.get(f"book_fundingtracks({g})?$select=book_name,book_beginningbalancereadonly,book_newresourceamount,book_newdecisiontotal")
    print(f"   {n}: BB={r.get('book_beginningbalancereadonly')} resource={r.get('book_newresourceamount')} decisionTotal={r.get('book_newdecisiontotal')}")

# Generate LOAs
print("\n=== book_GenerateLOAs(FiscalYear=2026, BatchSize=100) ===")
resp = dvapi.action("book_GenerateLOAs", {"FiscalYear": FY, "BatchSize": 100})
print("   response:", {k: v for k, v in (resp or {}).items() if not k.startswith("@")})

# read generated LOAs
print("\n=== LOAs now present ===")
for l in dvapi.get("book_fundinglines?$select=book_name,book_newtdp,book_newtdpremaining").get("value", []):
    print(f"   {l.get('book_name')}: tdp={l.get('book_newtdp')} remaining={l.get('book_newtdpremaining')}")
