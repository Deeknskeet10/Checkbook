#!/usr/bin/env python3
import sys
sys.path.insert(0, "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad")
import dvapi

ARMY = 4
APPROP = {"2020": 4, "2060": 1, "2065": 3}   # OMA / NGPA / OMNG
FY = {26: 2026, 27: 2027}

_dropped = set()
def safe_post(es, body):
    """get-or-create by book_name; if a choice value is rejected, drop it and retry"""
    existing = dvapi.find_id(es, body["book_name"])
    if existing:
        return existing
    try:
        return dvapi.post(es, body)
    except RuntimeError as e:
        if "valid range" in str(e) or "0x8004431a" in str(e):
            keep = {k: v for k, v in body.items() if k == "book_name" or k.endswith("@odata.bind")}
            for k in body:
                if k not in keep: _dropped.add(f"{es}.{k}")
            return dvapi.post(es, keep)
        raise

# --- existing lookups created in phase 1 ---
states = {}   # abbr -> id
for r in dvapi.get("book_states?$select=book_name,book_abbreviation").get("value", []):
    states[r["book_abbreviation"]] = r["book_stateid"]
pgs = []      # ordered list of pg ids
for r in dvapi.get("book_pgs?$select=book_name&$orderby=book_name").get("value", []):
    pgs.append(r["book_pgid"])
print(f"found {len(states)} states, {len(pgs)} pgs")

# --- FundCenters (order matters for parent binds) ---
fc = {}  # name -> id
def mkfc(name, parent=None, state_abbr=None, cat=ARMY):
    body = {"book_name": name, "book_category": cat}
    if parent: body["book_ParentFundCenter@odata.bind"] = f"/book_fundcenters({fc[parent]})"
    if state_abbr and state_abbr in states:
        body["book_State@odata.bind"] = f"/book_states({states[state_abbr]})"
    fc[name] = safe_post("book_fundcenters", body)

mkfc("A18")                         # top
mkfc("A18NG", parent="A18")         # national guard
mkfc("A1830", parent="A18NG")       # NG HQ/staff
for i in range(1, 10):              # G1-G9 -> A1831..A1839
    mkfc(f"A183{i}", parent="A18NG")
for abbr in states:                 # state fund centers A18XX
    mkfc(f"A18{abbr}", parent="A18", state_abbr=abbr)
print(f"fundcenters: {len(fc)}")

# --- Funds: AAAA + DD(dollartype) + D/F + FY ---
DT = [("10", "BASE"), ("20", "OOC")]
nf = 0
for code, aval in APPROP.items():
    for dd, _ in DT:
        for dr in ("D", "F"):
            for fy, fyval in FY.items():
                name = f"{code}{dd}{dr}{fy}"
                safe_post("book_funds", {"book_name": name,
                                          "book_appropriation": aval,
                                          "book_fiscalyear": fyval})
                nf += 1
print(f"funds: {nf}")

# --- SAGs 111-132, round-robin across PGs ---
ns = 0
for idx, sag in enumerate(range(111, 133)):
    body = {"book_name": str(sag)}
    if pgs: body["book_PG@odata.bind"] = f"/book_pgs({pgs[idx % len(pgs)]})"
    safe_post("book_sags", body); ns += 1
print(f"sags: {ns}")

# --- APEs: 10 placeholder 9-char codes ---
na = 0
for i in range(1, 11):
    code = f"APE{i:06d}"  # 9 chars
    safe_post("book_apes", {"book_name": code, "book_apedescription": f"Placeholder APE {i}"}); na += 1
print(f"apes: {na}")

print("dropped (choice values needing later fixup):", sorted(_dropped) or "none")
print("--- final counts ---")
for es in ("book_fundcenters","book_funds","book_sags","book_apes"):
    print(f"  {es}: {dvapi.get(es+'?$count=true&$top=1').get('@odata.count')}")
