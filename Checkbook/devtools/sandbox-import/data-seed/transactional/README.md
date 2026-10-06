# Transactional seed (exercise the roll-ups)

Builds a small end-to-end funded scenario in the dev sandbox so the roll-up / validation
plugins actually run. Depends on the reference data (`../load_ref.py`, `../load_ref2.py`)
being loaded first. Uses `../dvapi.py` (Web API via the service principal).

## The funding model (learned the hard way)

Money flows **top-down**, and the money fields are plugin-derived — you can't set LOA/RF
totals directly:

```
cProbe Excel ─► Funding Track (Beginning Balance) ─► Decisions (±) ─► Resource Amount
     ─►  [Generate LOAs button = book_GenerateLOAs action]  ─► LOA (book_fundingline) gets TDP
     ─► RequirementFunding allocates TDP from the LOA  ─► Prioritization funds the RF
```

- **LOA TDP is not editable** — derived from Funding Track Resource Amounts + Ledger.
  You seed it by creating a Funding Track with a `book_beginningbalancereadonly`, then
  calling the **`book_GenerateLOAs`** unbound action (`{FiscalYear, BatchSize}`).
- **LOA name/grain is deterministic** (`LOANameBuilder`):
  - FY26-: `{OPR}-{Fund}-{BOC}-{DollarType}-{PG|SAG}-{MDEP}` (needs BOC + DollarType)
  - FY27+: `{OPR}-{Fund}-{PG|SAG}-{FundedProgram}-{Category}` (needs Fund.FundedProgram + FT.Category)
  - PG slot for NGPA/NGPM/NGREA appropriations, SAG otherwise.
  A Funding Track missing any grain field is **skipped** by GenerateLOAs.
- **RF `book_newtdp`** = the RF's TDP allocation from the LOA (capped at LOA remaining).
- **Prioritization** funded amount (`book_newfundedamounttdp`) funds its RF **directly** for
  single-RF prios — do NOT create `book_prioritizationfunding` rows (that double-counts and
  trips the TDP-cap plugin). Junctions are only for splitting one Prio across multiple RFs.
- Prioritization roll-up only counts toward the RF when `book_approvalstatus = 4` (NPM Review).

## Run order

```bash
cd Checkbook
direnv exec . bash -c 'python3 devtools/sandbox-import/data-seed/transactional/load_txn2.py'   # FTs + Generate LOAs
direnv exec . bash -c 'python3 devtools/sandbox-import/data-seed/transactional/load_txn3.py'   # Reqs -> RFs -> Prios
direnv exec . bash -c 'python3 devtools/sandbox-import/data-seed/transactional/check_rollups.py'  # verify
```

`load_txn3.py` is **not** idempotent (RF/Prio names are auto-set by workflows, so get-or-create
by name doesn't work). To re-seed, clear first:

```bash
direnv exec . bash -c 'python3 devtools/sandbox-import/data-seed/transactional/cleanup_txn.py'
```

## Scenario built (FY2026, Texas)

2 MDEPs, 1 BOC, 2 DollarTypes, 2 Funding Tracks (BB $1M / $500k) → 2 LOAs,
3 Requirements → 3 RFs → 3 approved Prioritizations.

## Verified roll-ups

- LOA TDP from FT Beginning Balance (via Generate LOAs): $1,000,000 / $500,000.
- LOA TDP **remaining** = LOA TDP − Σ(RF TDP allocations): $450k / $350k.
- RF **funded** = Σ(approved Prio funded): $250k / $200k / $100k; RF **unfunded** computed.

---

# FY27 seed (`fy27_*.py`)

FY27 restructures the fund model (GFEBS-aligned) and the funding chain. These scripts
build a complete FY2027 dataset that exercises every FY27-specific table and the live
plugin cascade. Run order (after reference data):

```bash
python3 fy27_ref.py       # FundedPrograms, assign FP to FY27 funds, ARNG OPR, catalog items
python3 fy27_tracks.py    # FY27 Funding Tracks -> book_GenerateLOAs(2027)
python3 fy27_chain.py     # Requirements -> RDs -> RFs -> Prio/ItemizedDetails + RD-direct funding
python3 fy27_cleanup.py   # delete the FY27 seed (keeps FY26 + reference data)
# diagnostics (read-only): fy27_discover.py, fy27_discover2.py, fy27_plugincheck.py
```

## FY27 fund model (vs FY26)

- **BOC / DollarType / MDEP are dropped.** The fund key becomes **Fund + FundedProgram**
  (`book_fundedprogram`, a lookup `book_newfundedprogram` on `book_fund`), plus a
  **Category** choice on the Funding Track (`book_category`: RISK=0, TSP=1, RPA=2, CON=3,
  …). Category is descriptive, never a matching dimension.
- **FY27 LOA name** = `{DisbursingOfficial}-{Fund}-{PG|SAG}-{FundedProgram}-{Category}`
  (`LOANameBuilder`, FY gate `LegacyGrainLastFy=26`). PG for NGPA/NGPM/NGREA, SAG otherwise.
  GenerateLOAs **skips** any FT whose Fund lacks a FundedProgram or whose FT lacks a Category.
- **ARNG-as-RISK model:** Funding Tracks feed **ARNG LOAs** (`book_disbursingofficial` =
  the `ARNG` OPR). OPR LOAs are really funded by a BE realigning ARNG→OPR; the seed
  takes a shortcut and feeds OPR LOAs via OPR funding tracks so the chain has LOAs.

## FY27 funding chain — two paths (Prio XOR RD-direct)

`RequirementDetailFundingGuard` enforces that a Requirement is on **one** path:

- **Prioritized + Itemized:** Requirement → RequirementDetails (item rows) →
  RequirementFunding → Prioritization → ItemizedDetails (Prio↔RD) → PrioritizationFunding
  (Prio↔RF).
- **Non-prioritized (direct):** Requirement → RequirementDetails → RequirementFunding →
  RequirementDetailFunding (RD↔RF). NPM-only; **Validated + Funded, no Requested**.

## Sequencing gotchas (learned the hard way)

- **FY27 Prio links ONLY `book_Requirement`, never `book_RequirementFunding`.** Setting the
  RF lookup makes `PrioritizationSingleRfAutoAllocate` treat the Prio as the FY26 direct-RF
  model and skip (Gate 2) → no junction. The RF is found by (Requirement, FY).
- **Set `book_fundingmode = Itemized (1)` on the Prio at create.** `ItemizedDetailsSynchronizer`
  (which flips the mode) is registered **async**, so seeding via API outruns it;
  `PrioritizationItemizedRollup` (sync) only aggregates when the mode is already Itemized.
- `PrioritizationSingleRfAutoAllocate` requires `book_approvalstatus = 4` (NPM Review / FinalApproved).
- All FY27 plugin steps are confirmed registered/active in Blipsnchitz (`fy27_plugincheck.py`).

## Scenario built (FY2027, Texas)

- 4 FundedPrograms; FP assigned to all 12 FY27 Funds; `ARNG` disbursing-official OPR; 4 catalog Items.
- 4 Funding Tracks → 4 FY27 LOAs: ARNG-206510D27-111-TRNG-RISK ($2.0M),
  ARNG-206010D27-10010-OPTEMPO-RISK ($1.5M), G3-206510D27-111-TRNG-CON ($1.0M),
  G4-202010D27-112-BASOPS-CON ($0.8M).
- Req A (prioritized/itemized) on G3: 2 RDs, RF (TDP $600k), Prio (status 4), 2 ItemizedDetails,
  1 auto PrioritizationFunding junction.
- Req B (direct) on G4: 2 RDs, RF (TDP $500k), 2 RequirementDetailFunding junctions.

## Verified FY27 roll-ups

- Itemized rollup → Prio A: requested 650k / validated 650k / funded 550k.
- Auto PrioritizationFunding junction: funded 550k / validated 650k → RF-A funded 550k.
- RD-direct rollup → RF-B: funded 350k / validated 450k.
- LOA remaining: G3 $400k (1.0M−600k), G4 $300k (800k−500k).
