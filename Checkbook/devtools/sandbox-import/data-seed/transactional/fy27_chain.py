#!/usr/bin/env python3
"""FY27 funding chain on the two OPR LOAs, exercising the FY27-specific tables
and the live plugin cascade (all steps verified registered via fy27_plugincheck.py).

Two Texas requirements, one per funding path (RequirementDetailFundingGuard enforces
Prio-XOR-RD-direct at the Requirement level):

  A) PRIORITIZED + ITEMIZED  -> on G3 LOA
     Requirement -> RequirementDetails (item rows)
                 -> RequirementFunding (TDP from LOA)
                 -> Prioritization (links ONLY book_Requirement; status 4; fundingmode=Itemized)
                 -> ItemizedDetails (Prio <-> RD)  --+ PrioritizationItemizedRollup (sync)
                                                     |   sums IDs onto the Prio totals
                                                     +-> PrioritizationSingleRfAutoAllocate (sync)
                                                         materializes the PrioritizationFunding junction
                                                     +-> PrioritizationFundingRollup -> RF.funded

  B) NON-PRIORITIZED (DIRECT) -> on G4 LOA
     Requirement -> RequirementDetails -> RequirementFunding
                 -> RequirementDetailFunding (RD <-> RF)
                    --> RequirementDetailFundingRollup (sync) -> RF.funded   (Validated + Funded, no Requested)

FY27 Prio shape matters: setting book_RequirementFunding on the Prio makes the
auto-allocate plugin treat it as the FY26 direct-RF model and skip (Gate 2), so the
junction never materializes. Link the Requirement only; the RF is found by (Req, FY).

Not idempotent (RF/Prio names are workflow-assigned). Re-seed via fy27_cleanup.py.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dvapi

FY, FINAL_APPROVED, TYPE_STATE, MODE_ITEMIZED = 2027, 4, 0, 1

def ref(entity, attr, es, gid):
    nav = dvapi.navprop(entity, attr)
    if not nav: raise SystemExit(f"no nav prop for {entity}.{attr}")
    return {f"{nav}@odata.bind": f"/{es}({gid})"}

def rid(es, name):
    g = dvapi.find_id(es, name)
    if not g: raise SystemExit(f"REF NOT FOUND {es} '{name}'")
    return g

G3 = rid("book_fundinglines", "G3-206510D27-111-TRNG-CON")
G4 = rid("book_fundinglines", "G4-202010D27-112-BASOPS-CON")
print("LOAs:", G3[:8], G4[:8])

def mkrd(name, req, item, prio_order, validated, funded):
    return dvapi.post("book_requirementdetailses", {
        "book_name": name, "book_priorityorder": prio_order,
        "book_validatedamount": validated, "book_fundedamount": funded,
        **ref("book_requirementdetails", "book_requirement", "book_requirementses", req),
        **ref("book_requirementdetails", "book_item", "book_items", rid("book_items", item)),
    })

# =====================================================================
# A) PRIORITIZED + ITEMIZED  (G3 LOA)
# =====================================================================
print("\n########## A) prioritized + itemized ##########")
reqA = dvapi.post("book_requirementses", {
    "book_name": "REQ-TX-FY27-P", "book_type": TYPE_STATE, "book_pomstatus": False,
    "book_statutoryjustification": "FY27 prioritized requirement (dev seed).",
    **ref("book_requirements", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_requirements", "book_ape", "book_apes", rid("book_apes", "APE000001")),
})
print("  requirement A:", bool(reqA))
rdA1 = mkrd("RD-A-RADIO",   reqA, "ITEM-RADIO",   1, 300000, 250000)
rdA2 = mkrd("RD-A-VEHICLE", reqA, "ITEM-VEHICLE", 2, 350000, 300000)
print("  RDs A:", [bool(x) for x in (rdA1, rdA2)])

rfA = dvapi.post("book_requirementfundings", {
    "book_name": "RF-TX-FY27-P", "book_newfiscalyear": FY, "book_newtdp": 600000,
    **ref("book_requirementfunding", "book_requirement", "book_requirementses", reqA),
    **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", G3),
    **ref("book_requirementfunding", "book_ape", "book_apes", rid("book_apes", "APE000001")),
})
print("  RF A:", bool(rfA))

# FY27 Prio: link ONLY the Requirement (no RF lookup); Itemized mode set up front.
prioA = dvapi.post("book_prioritizations", {
    "book_name": "PRI-TX-FY27-P", "book_newfiscalyear": FY,
    "book_approvalstatus": FINAL_APPROVED, "book_quantities": 1,
    "book_fundingmode": MODE_ITEMIZED,
    "book_statutoryjustification": "FY27 prioritized (dev seed).",
    **ref("book_prioritization", "book_requirement", "book_requirementses", reqA),
    **ref("book_prioritization", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_prioritization", "book_state", "book_states", rid("book_states", "Texas")),
})
fm = dvapi.get(f"book_prioritizations({prioA})?$select=book_fundingmode")
print(f"  Prio A: {bool(prioA)} fundingmode={fm.get('book_fundingmode')} (1=Itemized)")

def mkid(name, prio, rd, requested, validated, funded):
    return dvapi.post("book_itemizeddetailses", {
        "book_name": name, "book_quantity": 1,
        "book_requestedamount": requested, "book_validatedamount": validated, "book_fundedamount": funded,
        **ref("book_itemizeddetails", "book_prioritization", "book_prioritizations", prio),
        **ref("book_itemizeddetails", "book_requirementitem", "book_requirementdetailses", rd),
        **ref("book_itemizeddetails", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    })
idA1 = mkid("ID-A-RADIO",   prioA, rdA1, 300000, 300000, 250000)
idA2 = mkid("ID-A-VEHICLE", prioA, rdA2, 350000, 350000, 300000)
print("  ItemizedDetails A:", [bool(x) for x in (idA1, idA2)])

p = dvapi.get(f"book_prioritizations({prioA})?$select=book_newrequestedamount,"
              "book_validatedamount,book_newfundedamounttdp")
print(f"  Prio A rolled up: requested={p.get('book_newrequestedamount')} "
      f"validated={p.get('book_validatedamount')} funded={p.get('book_newfundedamounttdp')}")
pf = dvapi.query("book_prioritizationfundings",
                 **{"$filter": f"_book_prioritization_value eq {prioA}",
                    "$select": "book_name,book_fundedamount,book_validatedamount"})
print("  PF junction (auto):", [(j.get('book_fundedamount'), j.get('book_validatedamount')) for j in pf])

# =====================================================================
# B) NON-PRIORITIZED (DIRECT RD FUNDING)  (G4 LOA)
# =====================================================================
print("\n########## B) non-prioritized direct RD funding ##########")
reqB = dvapi.post("book_requirementses", {
    "book_name": "REQ-TX-FY27-D", "book_type": TYPE_STATE, "book_pomstatus": False,
    "book_statutoryjustification": "FY27 non-prioritized requirement (dev seed).",
    **ref("book_requirements", "book_fundcenter", "book_fundcenters", rid("book_fundcenters", "A18TX")),
    **ref("book_requirements", "book_ape", "book_apes", rid("book_apes", "APE000002")),
})
print("  requirement B:", bool(reqB))
rdB1 = mkrd("RD-B-AMMO", reqB, "ITEM-AMMO", 1, 250000, 200000)
rdB2 = mkrd("RD-B-MED",  reqB, "ITEM-MED",  2, 200000, 150000)
print("  RDs B:", [bool(x) for x in (rdB1, rdB2)])

rfB = dvapi.post("book_requirementfundings", {
    "book_name": "RF-TX-FY27-D", "book_newfiscalyear": FY, "book_newtdp": 500000,
    **ref("book_requirementfunding", "book_requirement", "book_requirementses", reqB),
    **ref("book_requirementfunding", "book_lineofaccounting", "book_fundinglines", G4),
    **ref("book_requirementfunding", "book_ape", "book_apes", rid("book_apes", "APE000002")),
})
print("  RF B:", bool(rfB))

def mkrdf(name, rd, rf, validated, funded):
    return dvapi.post("book_requirementdetailfundings", {
        "book_name": name, "book_validatedamount": validated, "book_fundedamount": funded,
        **ref("book_requirementdetailfunding", "book_requirementdetail", "book_requirementdetailses", rd),
        **ref("book_requirementdetailfunding", "book_requirementfunding", "book_requirementfundings", rf),
    })
rdfB1 = mkrdf("RDF-B-AMMO", rdB1, rfB, 250000, 200000)
rdfB2 = mkrdf("RDF-B-MED",  rdB2, rfB, 200000, 150000)
print("  RDF junctions B:", [bool(x) for x in (rdfB1, rdfB2)])

# =====================================================================
# ROLL-UP CHECK
# =====================================================================
print("\n===== ROLL-UP CHECK =====")
for name, g in (("RF-A (prio/itemized)", rfA), ("RF-B (direct RD)", rfB)):
    r = dvapi.get(f"book_requirementfundings({g})?$select=book_newtdp,book_newfundedamount,"
                  "book_newvalidatedamount,book_newunfundedamount")
    print(f"  {name}: tdp={r.get('book_newtdp')} funded={r.get('book_newfundedamount')} "
          f"validated={r.get('book_newvalidatedamount')} unfunded={r.get('book_newunfundedamount')}")
for name, g in (("G3 LOA", G3), ("G4 LOA", G4)):
    r = dvapi.get(f"book_fundinglines({g})?$select=book_name,book_newtdp,book_newtdpremaining")
    print(f"  {r.get('book_name')}: tdp={r.get('book_newtdp')} remaining={r.get('book_newtdpremaining')}")
p = dvapi.get(f"book_prioritizations({prioA})?$select=book_newrequestedamount,"
              "book_newfundedamounttdp,book_unfundedamount,book_approvalstatus")
print(f"  Prio A: requested={p.get('book_newrequestedamount')} funded={p.get('book_newfundedamounttdp')} "
      f"unfunded={p.get('book_unfundedamount')} status={p.get('book_approvalstatus')}")
