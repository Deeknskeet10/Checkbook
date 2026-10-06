#!/usr/bin/env python3
"""Delete the FY27 transactional seed, leaving the FY26 seed + reference data intact.

Safe because the FY26 seed created NO ItemizedDetails / RequirementDetails /
RequirementDetailFunding / PrioritizationFunding rows — every such row is FY27.
Prioritizations / RequirementFundings / Requirements are shared, so those are
filtered to FY27 (book_newfiscalyear=2027 / REQ-TX-FY27* name)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

def wipe_all(es, idfield, label):
    n = 0
    for r in dvapi.query(es, **{"$select": idfield}):
        dvapi.delete(es, r[idfield]); n += 1
    print(f"  deleted ALL {label}: {n}")

def wipe_filtered(es, idfield, flt, label):
    n = 0
    for r in dvapi.query(es, **{"$select": idfield, "$filter": flt}):
        dvapi.delete(es, r[idfield]); n += 1
    print(f"  deleted {label}: {n}")

# children / junctions first (all FY27)
wipe_all("book_itemizeddetailses",        "book_itemizeddetailsid",        "ItemizedDetails")
wipe_all("book_prioritizationfundings",   "book_prioritizationfundingid",  "PrioritizationFunding junctions")
wipe_all("book_requirementdetailfundings","book_requirementdetailfundingid","RequirementDetailFunding junctions")
# FY27 prioritizations + requirement fundings
wipe_filtered("book_prioritizations",     "book_prioritizationid",  "book_newfiscalyear eq 2027", "FY27 Prioritizations")
wipe_filtered("book_requirementfundings", "book_requirementfundingid","book_newfiscalyear eq 2027", "FY27 RequirementFundings")
# requirement details (all FY27) then the FY27 requirements
wipe_all("book_requirementdetailses",     "book_requirementdetailsid",     "RequirementDetails")
wipe_filtered("book_requirementses",      "book_requirementsid",    "startswith(book_name,'REQ-TX-FY27')", "FY27 Requirements")
print("done.")
