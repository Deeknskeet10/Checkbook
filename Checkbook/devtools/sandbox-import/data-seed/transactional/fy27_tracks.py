#!/usr/bin/env python3
"""FY27 Funding Tracks -> book_GenerateLOAs(2027) -> verify FY27 LOA grain.

FY27 LOA name (LOANameBuilder): {DisbursingOfficial}-{Fund}-{PG|SAG}-{FundedProgram}-{Category}
  - no BOC / DollarType / MDEP (dropped in FY27)
  - PG for NGPA/NGPM/NGREA appropriations, SAG otherwise
  - FundedProgram comes off the Fund (set by fy27_ref.py); Category is on the FT
Category choice: RISK=0, TSP=1, RPA=2, CON=3.

ARNG-as-RISK model: Funding Tracks feed ARNG LOAs (disbursing official = ARNG).
OPR LOAs are *really* funded by a BE realigning ARNG->OPR; we seed them here via
OPR funding tracks as a sandbox shortcut so the RF/Prio/RD chain has LOAs to hang on.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY = 2027
RISK, CON = 0, 3

def bind(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit(f"REF NOT FOUND {es} '{name}'")
    return f"/{es}({g})"

def mkft(name, bb, fund, opr, pg, sag, category):
    body = {
        "book_name": name, "book_fiscalyear": FY,
        "book_beginningbalancereadonly": bb, "book_category": category,
        "book_Fund@odata.bind": bind("book_funds", fund),
        "book_DisbursingOfficial@odata.bind": bind("book_oprs", opr),
        "book_PG@odata.bind": bind("book_pgs", pg),
        "book_SAG@odata.bind": bind("book_sags", sag),
    }
    g = dvapi.find_id("book_fundingtracks", name)
    if g:
        dvapi.patch("book_fundingtracks", g,
                    {"book_beginningbalancereadonly": bb, "book_category": category})
        return g
    return dvapi.post("book_fundingtracks", body)

tracks = [
    # ARNG holding account (the real FY27 funding source)
    ("FT-ARNG-TRNG-FY27",    2000000, "206510D27", "ARNG", "10010", "111", RISK),   # OMNG -> SAG
    ("FT-ARNG-OPTEMPO-FY27", 1500000, "206010D27", "ARNG", "10010", "111", RISK),   # NGPA -> PG
    # OPR chain LOAs (sandbox shortcut)
    ("FT-G3-TRNG-FY27",      1000000, "206510D27", "G3",   "10010", "111", CON),    # OMNG -> SAG
    ("FT-G4-BASOPS-FY27",     800000, "202010D27", "G4",   "10020", "112", CON),    # OMA  -> SAG
]
made = {}
for name, bb, fund, opr, pg, sag, cat in tracks:
    made[name] = mkft(name, bb, fund, opr, pg, sag, cat)
    print(f"  {name}: {bool(made[name])}")

print("\nFT resource amounts:")
for name, g in made.items():
    r = dvapi.get(f"book_fundingtracks({g})?$select=book_name,book_beginningbalancereadonly,"
                  "book_newresourceamount,book_category,book_fiscalyear")
    print(f"   {name}: BB={r.get('book_beginningbalancereadonly')} "
          f"resource={r.get('book_newresourceamount')} cat={r.get('book_category')} fy={r.get('book_fiscalyear')}")

print("\n=== book_GenerateLOAs(FiscalYear=2027, BatchSize=100) ===")
resp = dvapi.action("book_GenerateLOAs", {"FiscalYear": FY, "BatchSize": 100})
print("   response:", {k: v for k, v in (resp or {}).items() if not k.startswith("@")})

print("\n=== all LOAs now present ===")
for l in dvapi.get("book_fundinglines?$select=book_name,book_newtdp,book_newtdpremaining,"
                   "book_fiscalyear,book_category&$orderby=book_name").get("value", []):
    print(f"   {l.get('book_name')}: tdp={l.get('book_newtdp')} "
          f"remaining={l.get('book_newtdpremaining')} fy={l.get('book_fiscalyear')} cat={l.get('book_category')}")
