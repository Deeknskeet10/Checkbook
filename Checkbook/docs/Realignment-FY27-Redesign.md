# Realignment FY27 Redesign — PF-granular, multi-line, role-branched entry

Status: **design, not yet built** · Author handoff doc · Last updated 2026-10-05

> Scope decided with the user 2026-10-05:
> - Model moves as **parent + child items** (new `book_realignmentitem` table), mirroring
>   State-Swap's `book_swapitem`. A single realignment can move **multiple Fund/SAG combos
>   from one Prioritization to another**, atomically.
> - Entry becomes a **new role-branched PCF** (State → Prioritization + PF subgrid;
>   OPR → Requirement Fundings), replacing the JS section-cascade for *entry*.
> - Realignments must operate at **Prioritization Funding (PF junction)** granularity, not
>   on the Prio's raw funded total.

Related: [Prioritization Funding invariant](PrioritizationFundingInvariant-Setup.md),
`Plugins/PLUGIN-REGISTRATION.md`, State-Swap design (`Plugins/StateSwaps/`),
`Plugins/Realignments/`.

---

## 1. Why

FY27 restructures funding so a Prioritization's money lives in **`book_prioritizationfunding`
junctions** (one per Requirement Funding = one Fund/SAG), not in a single funded number.
The current realignment:

- moves a Prio's `book_newfundedamounttdp` as a **raw total** and never touches the PF
  junctions (so a Prio→Prio move silently desyncs the junctions from the Prio total — the
  gap noted in `realignment-rollup-approval-filter-gap`); and
- is **single debit → single credit**, so moving several Fund/SAG combos between the same
  two Prios means several disjoint realignments, each approved separately.

The redesign makes the PF junction the unit of movement and lets one realignment carry N
Fund/SAG moves under one approval.

---

## 2. Current state (starting point)

- **Entity `book_realignments`** — single-row transaction. Paired single lookups:
  `book_newdebitedloa`/`book_newcreditedloa` (LOA), `book_newdebitedrequirement`/
  `book_newcreditedrequirement` (RF), `book_debitedprioritization`/
  `book_creditedprioritization` (Prio), plus `book_fund`, `book_newamount`,
  `book_samefundandsag`, `book_newstateapproved`, `book_bedecision`, audit stamps.
- **Entry** — native form **"Realign Requirement"** (`af33228b…`); `book_realignmentFormProgression.js`
  (commit 36bc911) reveals sections top-down Fund → LOA → RF → Prio; `book_hidePriRealignments.js`
  read-only-locks the Prioritization section for non-State users. **No entry PCF.**
- **Approval** — `RealignmentApprovalProcess` PCF (shape-aware chevron, role/BU-gated; built in
  `pcf/`, not yet in `src/`). `PendingRealignmentsQueue` PCF triages on dashboards.
  `RealignmentsFlow` PCF visualizes one record (debit→credit cards).
- **Validator** (`RealignmentValidator`, PreOp Update) — role/BU-gates the State and BE
  approval transitions on the **initiating user**, then enforces shape prerequisites
  (Case 1 RF-level: BE only; Case 2 Prio→Prio: State always; Case 3: +BE when cross Fund/SAG),
  then stamps approver/on.
- **Processor** (`RealignmentProcessor`, PostOp Update) — ledger-first for cross-LOA;
  `ExecutePriorToPrior` (debits/credits Prio funded + parent RFs) or `ExecuteRFtoRF`;
  `RealignmentDistributionCreator` emits the A18 round-trip AFP/Allotment pairs when cross
  Fund/SAG; `FinalizeRealignment` deactivates. `SetSameFundSagFlagPlugin` sets the boolean.

---

## 3. Target data model

### 3.1 `book_realignments` (parent) — changes

The parent keeps the **debit/credit Prioritization** (the "from one Pri to another"), the
**approvals**, remarks, FY, and gains roll-up totals. Per-Fund/SAG specifics move **down to
the item**.

| Field | Status | Notes |
|---|---|---|
| `book_debitedprioritization` / `book_creditedprioritization` | keep | the two Prios (State path). Null for a pure OPR RF→RF realignment. |
| `book_newstateapproved` (+by/on), `book_bedecision` (+by/on), `book_denialreason` | keep | approvals stay at the parent; one approval covers all items. |
| `book_newamount` | **retire for multi-line** | superseded by Σ item amounts; keep as a read-only rollup `book_totalamount` (new) or repurpose. |
| `book_realignmententrymode` | **new choice** | `State` / `OPR` — the entry branch the PCF used; drives validation + which lookups items carry. |
| `book_samefundandsag` | **move to item** | sameness is per Fund/SAG move now; see item. Keep a parent "all items same Fund/SAG" rollup bool for the approval-shape chevron. |
| `book_newdebitedloa`/`…creditedloa`, `book_newdebited/creditedrequirement` | **move to item** | no longer meaningful at the parent for multi-line. Keep temporarily for the legacy single-row path / migration, or drop. |
| `book_totalamount`, `book_allsamefundsag`, `book_itemcount` | **new** (rollup) | maintained by the new item rollup plugin; feed the approval chevron + validation. |

### 3.2 `book_realignmentitem` (new child) — mirrors `book_swapitem`

One row = **one Fund/SAG move** from the parent's debit Prio to its credit Prio (State path),
or one RF→RF leg (OPR path).

| Field | Type | Notes |
|---|---|---|
| `book_name` | text | autopopulated "`<debit> → <credit> : <amount>`" by derived-fields plugin. |
| `book_realignment` | Lookup → `book_realignments` | parent. |
| `book_newamount` | Money/Decimal | amount moved by this item. |
| `book_debitprioritizationfunding` | Lookup → `book_prioritizationfunding` | **State path**: the debit PF (Prio-A ↔ RF-X). Identifies debit RF-X, its LOA, Fund, SAG. Null on other paths. |
| `book_debitrequirementdetailfunding` | Lookup → `book_requirementdetailfunding` | **OPR / direct path**: the debit RDF (RD ↔ RF-X). The symmetric unit to the PF on the direct-funded (non-prioritized) requirement path — moving RDF allocations is what lets a single requirement be funded from multiple RFs. Null on other paths. |
| `book_creditrequirementfunding` | Lookup → `book_requirementfunding` | the **existing** RF the credit lands on (user picks it — decision §9.1). Same RF as debit for same-Fund/SAG; a different RF-Y for cross. Credit PF/RDF = parent credit parent ↔ this RF (created/synced by processor). |
| `book_debitrequirementfunding` | Lookup → `book_requirementfunding` | **plain RF→RF** (legacy/ARNG→OPR, no junction): debit RF-X directly. On the State/direct paths, derived = the debit PF/RDF's RF. |
| `book_fund` / `book_pg` / `book_sag` | Lookup (derived) | denormalized from the **debit** side by the derived-fields plugin (filtered views + rollup without traversing). |
| `book_samefundandsag` | Two Options (derived) | true iff debit RF-X and credit RF-Y share Fund **and** PG/SAG. Drives per-item distribution + parent `book_allsamefundsag`. |
| `book_debitstate` | Lookup → `book_state` (derived) | debit Prio's state, for BU-scoped approval resolution + rollup bucketing. |
| `statecode` | — | active/inactive. |

> **LOA is not stored on the item** (resolved from the RF/PF at execution time), matching the
> State-Swap/Turn-In convention (`SwapLOAResolver`, `TurnInLOAResolver`).

### 3.3 Maker-portal checklist (schema Eric creates; or create via Web API in the sandbox)

1. New table **`book_realignmentitem`** (`book` publisher), primary name `book_name`.
2. Lookups: `book_realignment` (→ book_realignments, parental or referential cascade TBD),
   `book_debitprioritizationfunding` (→ book_prioritizationfunding),
   `book_creditrequirementfunding` + `book_debitrequirementfunding` (→ book_requirementfunding),
   `book_fund` (→ book_fund), `book_pg` (→ book_pg), `book_sag` (→ book_sag),
   `book_debitstate` (→ book_state).
3. `book_newamount` (Money or Decimal — match LedgerAttributes.Amount convention), `book_samefundandsag` (Two Options).
4. On `book_realignments`: `book_realignmententrymode` (choice State/OPR), `book_totalamount`
   (Money, rollup), `book_allsamefundsag` (Two Options, rollup), `book_itemcount` (Whole Number, rollup).
5. A subgrid of `book_realignmentitem` on the realignment form (or hosted inside the entry PCF).

---

## 4. Money-movement semantics (processor)

`RealignmentProcessor` changes from reading single parent lookups to **iterating active
`book_realignmentitem` rows** on approval. Per item:

**Same Fund/SAG (debit RF-X == credit RF-Y):** fungible within one bucket.
- Debit PF (Prio-A ↔ RF-X) `book_fundedamount` −= amount.
- Credit PF (Prio-B ↔ RF-X): get-or-create, `book_fundedamount` += amount.
- `PrioritizationFundingRollup` recomputes RF.funded from the junctions (no manual RF write).
- No ledger, no distributions (same LOA/bucket).

**Cross Fund/SAG (RF-X ≠ RF-Y, different Fund or PG/SAG):**
- Debit PF (Prio-A ↔ RF-X) −= amount; credit PF (Prio-B ↔ RF-Y) += amount (get-or-create).
- If RF-X.LOA ≠ RF-Y.LOA: **ledger-first** debit/credit pair (reuse `LedgerCreator.CreateRealignmentPair`),
  then recalc both LOAs' TDP.
- Emit the A18 round-trip AFP/Allotment distributions (reuse `RealignmentDistributionCreator`,
  anchored on each side's Prio FundCenter), once per item.
- Requires BE approval (Case 3).

**Direct/OPR item (debit = RDF, RD-X ↔ RF-X):** symmetric to the PF case — debit RDF
`book_fundedamount` −= amount; credit RDF (credit requirement's RD ↔ RF-Y) get-or-create += amount;
`RequirementDetailFundingRollup` recomputes RF.funded from the junctions. Same/cross Fund/SAG
handled as above. This is how **a single requirement draws from multiple RFs** — each RDF ties a
Requirement Detail to a different RF.

**Plain RF→RF item (no junction):** the existing `ExecuteRFtoRF` leg, per item (ARNG→OPR and
legacy shapes).

This **replaces** today's `ExecutePriorToPrior` raw-funded manipulation: because we move the PF
(or RDF) junction amounts, the Prio/RF funded totals are recomputed by the existing rollups
instead of being hand-written — closing the junction-desync gap. The conservation guards
(abort, don't clamp, when the debit source is short) carry over per item.

### 4.1 Legacy FY26 coexistence (single-row, no items)

FY26 realignments (Pri→Pri and RF→RF, no junction detail) must keep working through the FY27
transition. The processor **branches on whether the realignment has active
`book_realignmentitem` rows**:

- **Has items** → new multi-item path (above).
- **No items** → the existing single-row `ExecutePriorToPrior` / `ExecuteRFtoRF` logic, reading
  the parent's `book_newdebited/creditedprioritization` / `…requirement` / `…loa` lookups, unchanged.

The validator mirrors the branch: shape prerequisites read the item rollup when items exist, else
the legacy parent lookups. This keeps legacy support to **minimal additional code** (the existing
methods stay; the item path is additive) and needs **no migration** of in-flight FY26 records.

---

## 5. Entry PCF (`RealignmentBuilder`, new)

A virtual PCF (React/Fluent, like `ItemizedDetailsGrid` / the FundingGrid family), hosted on
a custom page or embedded on the realignment form, reading the parent id from
`context.mode.contextInfo.entityId`.

- **Role detection:** reuse the `STATE_ROLES` team-role lookup from
  `book_realignmentFormProgression.js` (and the PCF role-query union that includes team-derived
  roles — see `pcf-role-query-team-derived`). Set `book_realignmententrymode` automatically;
  expose a **dropdown override** for dual-role / Checkbook Admin users.
- **State path:**
  1. Pick **debit Prioritization** → its active **PFs load into a subgrid** (one row per
     RF/Fund/SAG with its funded amount available to move).
  2. Multi-select PFs, enter an **amount** per selected PF (≤ that PF's funded).
  3. Pick **credit Prioritization**; for cross-Fund/SAG, pick the **credit RF** the funds land
     on (default = same RF for same-Fund/SAG).
  4. Commit → create the parent (debit/credit Prio, mode=State) + one `book_realignmentitem`
     per selected PF; derived-fields plugin denormalizes Fund/SAG/state + sameness.
- **OPR / direct path:** for a **direct-funded** requirement, pick the debit requirement → its
  active **RDFs** load into a subgrid (one row per RD/RF/Fund/SAG) → multi-select + amounts → pick
  the credit RF-Y (its requirement must also be RD-funded, §9.7) → parent (mode=OPR) + one RDF item
  per selection. For a plain **RF→RF** move (ARNG→OPR, no junction detail), pick debit/credit RF +
  amount. This RDF granularity is what lets one requirement draw from multiple RFs.
- Submit for approval routes into the existing `RealignmentApprovalProcess` chevron (see §6).

The JS section-cascade (`book_realignmentFormProgression.js`, `book_hidePriRealignments.js`) is
**retired for entry** once the PCF ships (keep the approval/field-lock business rules).

---

## 6. Approval (mostly unchanged)

Approvals stay at the **parent** and keep the State-Swap-style role/BU gate in
`RealignmentValidator` (State role scoped to the debiting state's BU via the debit Prio's
`book_state`; BE role for the BE decision; stamps on transition). One approval covers all items.

Shape for the chevron is now derived from the **items** rollup, not single lookups:
- all items same Fund/SAG (`book_allsamefundsag` = true) → `State Approval → Approved`.
- any item cross Fund/SAG → `State Approval → NPM Concurrence → BE Approval → Approved`.
- OPR (mode=OPR, no Prios) → `NPM Concurrence → BE Approval → Approved`.

`RealignmentValidator.ResolveDebitingState` already reads the debit Prioritization's state;
with multiple items it should resolve from the **parent** debit Prio (unchanged) — all State-path
items share the parent's debit Prio by construction.

---

## 7. New/changed plugins

| Plugin | Change |
|---|---|
| `RealignmentItemDerivedFields` (**new**) | PreOp Create/Update of `book_realignmentitem`: denormalize `book_fund`/`book_pg`/`book_sag`/`book_debitstate` from the debit unit's RF→LOA (debit PF, RDF, or RF) and its parent (Prio/Requirement); compute `book_samefundandsag` vs the credit RF; autopopulate `book_name`. Mirror `SwapItemDerivedFieldsPlugin`. |
| `RealignmentRollup` (**new**) | PostOp Create/Update/Delete of `book_realignmentitem`: maintain parent `book_totalamount`, `book_allsamefundsag`, `book_itemcount`. Mirror `SwapRollupPlugin` (PreImage for Update/Delete). |
| `RealignmentProcessor` | Iterate active items on approval; per-item PF debit/credit (§4); reuse Ledger/Distribution helpers per cross-Fund/SAG item; finalize once. |
| `RealignmentValidator` | Shape prerequisites read the item rollup (`book_allsamefundsag`, mode) instead of single parent lookups. Role/BU gate + stamps unchanged. |
| `SetSameFundSagFlagPlugin` | Superseded at the parent by the item-derived + rollup; retire or repurpose to set the parent rollup only. |

---

## 8. Build sequence

1. **Schema** — create `book_realignmentitem` + parent fields (maker portal, or Web API in the
   Blipsnchitz sandbox for the fast loop). Pull back into `src/` on export.
2. **Plugins** — `RealignmentItemDerivedFields`, `RealignmentRollup`, then rework
   `RealignmentProcessor` + `RealignmentValidator`. Build `Checkbook_Plugins.dll`, register steps
   per a new section in `Plugins/PLUGIN-REGISTRATION.md`.
3. **PCF** — `RealignmentBuilder` under `pcf/`; add to `ARNGCheckbookExtensions`; bump manifest
   version each import (`pcf-manifest-version-bump`); pin Fluent 9.46.2 (`fluent-version-dataverse`).
4. **Seed + validate** in the sandbox — extend `devtools/sandbox-import/data-seed/transactional/`
   with an FY27 realignment scenario on the matched `ARNG/G3 206510D27-111-TRNG` pair and a
   cross-Fund/SAG pair; drive State + BE approval; assert PF/RF/LOA + distribution effects.
5. **Docs** — update `Plugins/PLUGIN-REGISTRATION.md`, this file, and the registration/handoff docs.

---

## 9. Decisions

1. **Credit-side selection for cross-Fund/SAG — RESOLVED (user 2026-10-05):** the user picks an
   **existing RF-Y** under the credit parent's requirement; the processor creates/syncs only the
   junction. Creating RFs mid-realignment (collides with RF-TDP validation) is out.
2. **OPR path & items — RESOLVED (user 2026-10-05):** FY27 realignments use items for **all**
   paths — State (debit = PF), direct/OPR (debit = **RDF**, enabling one requirement funded from
   multiple RFs), and plain RF→RF. **Legacy FY26 single-row realignments (Pri→Pri, RF→RF, no
   items) stay supported** via the processor/validator "has items?" branch (§4.1) — minimal added
   code, no forced migration.
3. **`book_newamount` on the parent:** retire vs keep as a rollup mirror of Σ items. Affects the
   `RealignmentsFlow` PCF (`amount` bound property) and existing views. *(still open)*
4. ~~Migration of legacy records~~ — **RESOLVED:** no migration; dual-path processor (§4.1).
5. **Cascade behavior** `book_realignments` → `book_realignmentitem` (parental delete vs referential),
   and whether items lock after submission (likely lock on approval, like swap items). *(still open)*
6. **Credit PF/RDF get-or-create vs guards** — the processor's junction writes must satisfy
   `PrioritizationFundingGuard` / `RequirementDetailFundingGuard` (TDP cap, uniqueness, XOR). The
   writes land at depth ≥1; confirm the guards tolerate them the way
   `PrioritizationSingleRfAutoAllocate`'s junction writes are tolerated. *(verify while building)*
7. **Direct-path credit XOR** — the credit requirement on an RDF item must itself be on the
   direct (RD) path, not the Prio path (`RequirementDetailFundingGuard` enforces Prio-XOR-RD). The
   entry PCF must only offer RF-Y targets whose requirement is RD-funded. *(verify while building)*
