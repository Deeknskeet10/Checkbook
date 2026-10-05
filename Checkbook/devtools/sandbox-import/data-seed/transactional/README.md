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
