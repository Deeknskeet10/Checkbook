#!/usr/bin/env python3
"""FY27 reference gaps (idempotent):
  - book_fundedprogram rows (FY27 Fund model: FP replaces BOC/DollarType)
  - assign book_newfundedprogram to every FY2027 book_fund
  - 'ARNG' disbursing-official OPR (ARNG-as-RISK model: Funding Tracks feed ARNG LOAs)
  - a few catalog book_item rows for RequirementDetails
Run before fy27_tracks.py."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

def getcreate(es, name, extra=None):
    g = dvapi.find_id(es, name)
    if g: return g
    return dvapi.post(es, {"book_name": name, **(extra or {})})

# ---- Funded Programs (GFEBS cost objects; FY27 fund key = Fund + FundedProgram) ----
FPS = ["BASOPS", "OPTEMPO", "TRNG", "RECRUIT"]
fp = {n: getcreate("book_fundedprograms", n) for n in FPS}
print("funded programs:", {n: bool(g) for n, g in fp.items()})

# appropriation -> which FP (deterministic). Appropriation option values from metadata:
#   NGPA=1, OMNG=3, OMA=4 (the three present in FY27 funds)
APPR_FP = {1: "OPTEMPO", 3: "TRNG", 4: "BASOPS"}
DEFAULT_FP = "BASOPS"

fp_nav = dvapi.navprop("book_fund", "book_newfundedprogram")
print("fund->FP nav property:", fp_nav)

funds = dvapi.get("book_funds?$select=book_name,book_appropriation,book_fiscalyear,"
                  "_book_newfundedprogram_value&$orderby=book_name").get("value", [])
assigned = 0
for f in funds:
    if f.get("book_fiscalyear") != 2027:
        continue
    if f.get("_book_newfundedprogram_value"):
        continue  # already has an FP
    fpname = APPR_FP.get(f.get("book_appropriation"), DEFAULT_FP)
    dvapi.patch("book_funds", f[[k for k in f if k.endswith("fundid")][0]],
                {f"{fp_nav}@odata.bind": f"/book_fundedprograms({fp[fpname]})"})
    assigned += 1
    print(f"   {f['book_name']:14s} appr={f.get('book_appropriation')} -> FP {fpname}")
print(f"assigned FP to {assigned} FY2027 funds")

# ---- ARNG disbursing official ----
arng = getcreate("book_oprs", "ARNG")
print("ARNG OPR:", bool(arng), arng)

# ---- catalog items for RequirementDetails ----
items = {n: getcreate("book_items", n) for n in ("ITEM-RADIO", "ITEM-VEHICLE", "ITEM-AMMO", "ITEM-MED")}
print("items:", {n: bool(g) for n, g in items.items()})
