# FY27 Spend Plan Modes — Breakout / State-Rollup / Centrally Managed

**Status:** plugin layer **built** (compiles; see `Plugins/` + registration
below). Schema is authored in the maker portal (not yet). PCF (Mode-C state
grid) + web-resource gate not started. See [§10](#10-build-state) for the split.
**Supersedes the grain assumptions in** [`IMPLEMENTATION-FY27SpendPlan.md`](./IMPLEMENTATION-FY27SpendPlan.md):
that doc's single PF-anchored spend plan becomes **one of three** spend-plan
grains described here. The already-built `PrioritizationSpendPlanGrid` becomes
the **Breakout-only** surface (see [§8](#8-knock-on-changes-to-already-built-work)).

---

## 1. Problem

A Requirement's spend plan is not always maintained at the same grain. Three
cases exist, driven by two flags on the **Requirement** (`book_requirements`):

- **Centrally Managed** requirements — the NPM maintains **one** spend plan at
  the Requirement level, per FY. Their Prioritizations must never get an
  individual plan, and must never be swept into a state rollup.
- **Distributed** requirements flagged **Breakout** — each child Prioritization
  gets its **own** individual spend plan (this is the FY27 grid already built).
- **Distributed** requirements **not** flagged Breakout (the default) — no
  per-Prio plans; instead the Prios' funded amounts **roll up by
  (State, Fund, SAG)** into a state-level plan that aggregates across *all*
  distributed non-breakout requirements in that state.

The hard constraint that shapes the whole design: **flipping a Requirement flag
must never rewrite a past fiscal year.** If in FY29 Requirement A stops being
centrally managed, FY27/FY28 must keep their CM plans exactly as they were.

---

## 2. The three modes

| Mode | Requirement state | Spend-plan grain | Anchor (which lookup is set) | Maintained by |
|---|---|---|---|---|
| **A — Centrally Managed** | `book_national` = Centrally Managed | one plan per Requirement, per FY | `book_requirementfunding` (RF is FY-specific) | NPM |
| **B — Breakout** | Distributed **+** `book_breakout` = true | one plan per Prioritization | `book_prioritizationfunding` (PF) | State PM |
| **C — State-Rollup** (default) | Distributed **+** `book_breakout` = false | one plan per **(State, Fund, SAG)**, per FY | `book_state` + `book_fund` + `book_sag` | State PM |

**Mode C aggregates across multiple requirements**: every distributed
non-breakout Prio in a state lands in the same (State, Fund, SAG) bucket. That
cross-requirement aggregation is why Mode C needs a brand-new anchor grain — it
cannot hang off any single Requirement, PF, or LOA.

Centrally managed Prios are excluded from **both** Breakout and the Mode-C
rollup — their money only ever appears in the Mode-A requirement plan.

---

## 3. What already exists (grounding)

Confirmed against committed source (`src/ARNGCheckbook/…`):

- **Centrally managed** is `book_national` on `book_requirements` — a **Boolean**
  labelled *"Centrally Managed vs Distributed"* (plugins read it as `bool`; the
  two-option `<optionset>` XML is just how Dataverse serializes a bit field).
  No mirror of it exists on the Prioritization today.
- **Fund + SAG** live on the **LOA** (`book_fundingline.book_fund`,
  `book_fundingline.book_sag`). Path from a Prio: **Prio → `book_requirementfunding`
  → `book_lineofaccountingloa` → `book_fund` / `book_sag`**.
- The **PF** (`book_prioritizationfunding`) already links both
  `book_prioritization` and `book_requirementfunding`, and carries
  `book_fundedamount` — so the *funded amount already lives at the PF grain*.
- **`book_spendplan`** already has `book_requirement`, `book_requirementfunding`,
  and `book_lineofaccountingloa` lookups, a `book_uniquestatespendplan` alternate
  key, and this formula:
  ```
  book_spendplantype =
    If(!IsBlank(book_UnfundedRequest), "Unfunded Request",
      If(!IsBlank(book_Prioritization), "Prioritization", "Requirement"))
  ```
- The FY27 base columns from `IMPLEMENTATION-FY27SpendPlan.md`
  (`book_prioritizationfunding` anchor on the spend plan, `book_fundcenter`,
  `book_rowtype`, `book_newoctober…september` decimal twins,
  `book_newspendplantotal`) are **not yet in committed source** — schema is
  authored in the environment. This design extends that same not-yet-deployed set.
- There is **no** "current/active FY" config today. FY is the
  `book_fiscalyear` / `book_newfiscalyear` picklist. The only lock is
  `book_lockfunding` on RF/Prio.

---

## 4. Core idea — the PF is the point-in-time snapshot

The Requirement flags (`book_national`, `book_breakout`) are a **single live
value with no history**; flipping one destroys the prior value. The design
protects history by **stamping the mode onto the PF** — a FY-specific record —
at create time. Once stamped, **the PF is that FY's record of truth** for how
its money is planned, regardless of what the Requirement says in a later year.

Two consequences drive everything below:

1. **Consumers read the mode from the stamped PF, never re-derive it from the
   live Requirement flag.** The grid and the Mode-C rollup filter on the PF's
   stamp. Re-deriving from the Requirement would reintroduce the past-FY bug.
2. **Re-stamping is FY-gated.** A flag flip only ever touches PFs at or after
   the active planning FY; prior-FY PFs are never loaded for write.

---

## 5. Schema changes

### 5.1 `book_requirements`

| Column | Type | Notes |
|---|---|---|
| `book_breakout` | Boolean | "Child Prioritizations get individual spend plans." Default **false** (⇒ State-Rollup). Meaningless when `book_national` = Centrally Managed — enforced in [§7](#7-validation--enforcement). |

### 5.2 `book_prioritizationfunding` (the PF — stamped, plugin-owned, read-only to users)

| Column | Type | Notes |
|---|---|---|
| `book_centrallymanaged` | Boolean | Mirror of the Requirement's `book_national`. Kept a bool to match the current process. |
| `book_spendplanmode` | Choice | `Breakout` / `State-Rollup` / `Central`. **System-set, read-only** — users never pick it (State-Rollup is the derived default). Authoritative for the grid and rollup. |
| `book_lineofaccountingloa` | Lookup → `book_fundingline` | Stamped from the RF's LOA so Fund/SAG are one link away (PF → LOA → `book_fund`/`book_sag`). Reuses the schema name already used on `book_spendplan`. |

> `book_centrallymanaged` and `book_spendplanmode = Central` are redundant by
> construction (CM ⇔ Central). The bool is retained for process continuity; the
> stamping plugin keeps the two consistent, and **mode is the authoritative
> read** for downstream logic.

We deliberately **do not** stamp flat State/Fund/SAG columns onto the PF. With
the LOA stamped, the rollup fetch reaches Fund/SAG one link-entity away and
State one link-entity away (PF → Prio → `book_state`) — cheap enough that the
extra denormalized columns (and their sync surface) are not worth it.

### 5.3 `book_spendplan` (Mode-C anchor; Mode-A/B reuse existing + FY27-base columns)

| Column | Type | Notes |
|---|---|---|
| `book_state` | Lookup → `book_state` | Mode-C anchor. |
| `book_fund` | Lookup → `book_fund` | Mode-C anchor. |
| `book_sag` | Lookup → `book_sag` | Mode-C anchor. |
| *FY* | `book_newfiscalyear` (picklist) | Store FY **explicitly** on Mode-C rows — they have no PF/RF to infer it from. (Fund is FY-scoped, but do not rely on inference.) |
| **new alternate key** | — | `(FY, State, Fund, SAG, RowType)` — one Planned + one Actual per bucket. Parallel to `book_uniquestatespendplan`; must not collide with the legacy per-Prio key. |

**Extend the `book_spendplantype` formula** with a leading branch so Mode-C rows
classify themselves:
```
book_spendplantype =
  If(!IsBlank(book_State) && !IsBlank(book_Fund), "State Rollup",
    If(!IsBlank(book_UnfundedRequest), "Unfunded Request",
      If(!IsBlank(book_PrioritizationFunding), "Prioritization",   // FY27 base extension
        If(!IsBlank(book_Prioritization), "Prioritization", "Requirement"))))
```

**`book_name` is a generated label, not an identity.** The stamping plugin
builds it from the structured columns for readability/debugging, e.g.
`FY27-VA-OMNG-SAG115-Rollup`, `FY27-<Prio>-Breakout`, `FY27-<Req>-CM`. Nothing
keys, filters, or enforces uniqueness on the name — identity rides on the
lookups + alternate keys.

### Anchor summary

| Mode | Anchor lookup(s) set | `book_spendplantype` | New schema? |
|---|---|---|---|
| A — CM | `book_requirementfunding` | "Requirement" (existing fallback) | none |
| B — Breakout | `book_prioritizationfunding` | "Prioritization" (FY27-base extension) | FY27-base PF anchor (already planned) |
| C — State-Rollup | `book_state` + `book_fund` + `book_sag` | **"State Rollup"** (new) | 3 lookups + explicit FY + alt key |

---

## 6. Stamping + rollup plugin behavior

### 6.1 Stamp the PF (`book_prioritizationfunding`)

- **On PF Create** — resolve the parent Requirement (PF → RF → Requirement),
  read `book_national` + `book_breakout`, and set `book_centrallymanaged`,
  `book_spendplanmode`, and `book_lineofaccountingloa` (from RF → LOA).
- **On RF LOA change** — re-stamp the PF's `book_lineofaccountingloa` (Fund/SAG
  are derived from it).
- **On Requirement `book_national` / `book_breakout` change** — re-stamp the
  mode/CM of the affected PFs **whose FY ≥ active planning FY only**
  (see [§7.2](#72-historical-immutability-the-fy-gate)). Prior-FY PFs are
  excluded from the query — never loaded, never written.

Depth-guarded (this cascade can touch many PFs and must not re-enter through
the spend-plan validators).

### 6.2 Mode-C rollup (funded amount per bucket)

- Recompute a `(State, Fund, SAG, FY)` bucket's funded amount = **Σ of
  `book_fundedamount`** over PFs where `book_spendplanmode = State-Rollup`,
  joined PF → Prio (`book_state`) and PF → LOA (`book_fund`, `book_sag`),
  filtered to that FY.
- Triggers: a PF's `book_fundedamount`, `book_spendplanmode`,
  `book_lineofaccountingloa`, or its Prio's `book_state` changing; and the
  Requirement flag flip cascade above.
- Funded amount is **stored** on the bucket row (consistent with the TDP
  rollups) so the validator can compare Planned ≤ funded server-side. The 12
  monthly Planned/Actual values are entered by the State PM (see [§8](#8-knock-on-changes-to-already-built-work));
  the rollup only owns the funded figure, never the monthly cells.

---

## 7. Validation & enforcement

### 7.1 Flag consistency (`book_requirements` / PF)

- A **Centrally Managed** Requirement may not also be **Breakout** — reject or
  auto-clear `book_breakout` when `book_national` = Centrally Managed.
- `book_spendplanmode` / `book_centrallymanaged` on the PF are **system-owned**
  — reject user writes; only the stamping plugin sets them.

### 7.2 Historical immutability (the FY gate)

**Active planning FY** — introduce a `book_activeplanningfy` **environment
variable** (read via `EnvironmentVariableHelper`) as the single source of truth,
with the **computed federal FY** (`month ≥ 9 ? year + 1 : year`) as the fallback
when unset. Everything strictly below that value is historical and immutable.

Two layers guard the past:

1. **FY-gated cascade** (intent) — [§6.1](#61-stamp-the-pf-book_prioritizationfunding):
   re-stamp queries filter `FY ≥ active`, so prior-FY PFs are never written.
2. **Validator immutability net** (invariant) — a pre-op validator on
   `book_prioritizationfunding` **and** `book_spendplan` **rejects any write**
   that would change a **closed-FY** row's stamped mode/CM or its spend-plan
   values — regardless of the path (bulk edit, import, another plugin, a future
   refactor bug). This makes "past FY is frozen" a hard invariant, not a
   convention.

This generalizes the existing hard rule *"FY26 stays on legacy, nothing touches
it"*: each FY, once below the active boundary, is frozen; the PF snapshot is
what history reads.

### 7.3 Spend-plan row rules (extends `SpendPlanFY27Validator`)

Carry the existing FY27 rules to the two new anchor types:

- **Anchor exclusivity** — exactly one of {`book_requirementfunding` (A),
  `book_prioritizationfunding` (B), `book_state`+`book_fund`+`book_sag` (C)} is
  set; none of these coexist with the legacy `book_prioritization` anchor.
- **One active row per (anchor, RowType)** — via the alt keys.
- **Planned total ≤ funded** — Mode A vs RF funded; Mode B vs PF funded; Mode C
  vs the stored bucket rollup. Equality still **not** required (incremental
  entry; grid badge shows completeness).
- **Month locks** — Planned frozen once the month passes; Actual only for
  completed months. FY resolved from the row's own anchor.

---

## 8. Knock-on changes to already-built work

- **`PrioritizationSpendPlanGrid` (v0.1.0, built)** becomes the **Breakout-only**
  surface: additionally gated on the Prio's PF `book_spendplanmode = Breakout`.
  For Central or State-Rollup Prios the tab is hidden (there is no per-Prio plan).
  Gate reads the **stamped PF mode**, not the live Requirement flag.
- **Mode C needs a new State-level grid** — rows per (Fund, SAG) for a State +
  FY, where the State PM enters the monthly Planned/Actual against the stored
  rollup funded amount. Different surface from the Prio form (likely a new page
  keyed by State + FY). **Not yet built.**
- **Mode A** — reuse/extend the existing Requirements-form `SpendPlanGrid` for
  the NPM's per-Requirement plan (FY27 schema + CM gating), rather than a fourth
  new control. **To confirm.**
- **`book_prioritization.js`** FY gate extends to also branch on the PF mode when
  deciding tab visibility.

---

## 9. Open decisions

1. **Mode-A UI** — reuse the legacy Requirements-form `SpendPlanGrid`, or a new
   control? (§8)
2. **Mode-C UI home** — new dedicated "State Spend Plan" page keyed by
   (State, FY), or bolt onto an existing NPM/state page? Who navigates to it?
3. **`book_fundingmode`** already exists on the Prioritization (a picklist) —
   confirm whether it already encodes central-vs-distributed before adding any
   Prio-level mirror.
4. **Active-FY boundary** — env variable (recommended) vs. an explicit per-FY /
   per-record close-lock (finer control, more admin overhead). §7.2
5. **Flag-flip on the current FY** — re-stamping a *current-FY* Prio whose plan
   is already final-approved/executing is disruptive; confirm whether a
   current-FY flip is allowed freely or itself gated behind an approval/lock.

---

## 10. Build state

**Built (compiles — `cd Plugins && dotnet build`):**
- Constants: `book_breakout` (Requirement); `book_centrallymanaged` /
  `book_spendplanmode` / `book_lineofaccounting` + `SpendPlanModeValues`
  (PF); `book_state` / `book_fund` / `book_sag` / `book_newfiscalyear` /
  `book_fundedamount` (SpendPlan); `book_activeplanningfy` env key.
- `Helpers/FiscalYearHelper` — active-FY resolution (env var → federal fallback).
- `Items/PrioritizationFundingSpendPlanStamp` — PF stamp on create / RF re-point.
- `Items/RequirementSpendPlanModeCascade` — FY-gated flag-flip re-stamp.
- `Items/RequirementFundingLoaCascade` — FY-gated LOA re-stamp.
- `Recalculations/SpendPlanStateRollup` — Mode-C bucket funded rollup.
- `Validation/SpendPlanFY27Validator` — extended to all three anchor modes.
- `Validation/SpendPlanImmutabilityGuard` — closed-FY freeze net.
- `Validation/RequirementBreakoutConsistencyGuard` — CM ⇒ not breakout.
- Registration for every step: [`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md)
  (schema-to-author table, `book_activeplanningfy` env var, all step rows).

**PCF — all three controls built** (compile; bundled in `dist/ARNGCheckbookExtensions.zip`):
- **`PrioritizationSpendPlanGrid` v0.2.0** — the **Breakout** surface: a bound
  `spendPlanMode` property (→ `book_spendplanmode`) filters to Breakout (0) PFs;
  State-Rollup/Central allocations are counted in a banner. Needs the
  `spendPlanMode` property mapped on the Prioritization form after re-import.
- **`RequirementSpendPlanGrid` v0.1.0** — the **Centrally Managed** (Mode-A)
  surface on the Requirement form: one section per RF (per FY), RF-anchored,
  shown only when `book_national`. Bind to the `book_requirementfunding` subgrid.
- **`StateSpendPlanGrid` v0.1.0** — the **State-Rollup** (Mode-C) surface as a
  PCF (custom-page host). **Shelved in favor of the HTML web resource below**
  (kept in the repo as an alternative host); the web resource avoids the canvas
  code-components toggle and canvas WebAPI limits.
- **`webresources/book_stateSpendPlan.html`** (new) — the chosen **Mode-C**
  surface: a standalone HTML web resource for the Spend Plan app site map.
  Auto-detects the user's state from their business unit (same rule as
  `book_prioritization.js`), defaults to the active planning FY (env var) with a
  FY selector, discovers (Fund, SAG) buckets from the state's State-Rollup PFs,
  and reads/writes bucket rows via `Xrm.WebApi`. No picker, no code-components
  toggle, no canvas WebAPI dependency.

**Web resource updated** — `book_prioritization.js` `applySpendPlanTabVisibility`
now gates the Prio Spend Plan tab on FY27+ **and** the presence of a Breakout
allocation (`book_spendplanmode = 0`), so the Breakout-only grid tab hides when
a Prio's money is all state-rollup/central. Must be pasted into the
`book_Prioritizations` web resource and published (ships in the repo, not the zip).

**UI decisions settled (Sep 2026):** `book_fundingmode` is Direct/Itemized
(funding style), unrelated to central-vs-distributed — no conflict.

**Not started:**
- **Schema** — author the columns/formula/alt key/env var in the maker portal.
  Step-by-step: [`SETUP-SpendPlanModes-Schema.md`](./SETUP-SpendPlanModes-Schema.md).
  Plugins + PCF reference these names; nothing works until they exist.
- **Form / page wiring** — map `spendPlanMode` on the Prio form; place
  `RequirementSpendPlanGrid` on the Requirement form; build the State Spend Plan
  custom page hosting `StateSpendPlanGrid`; paste the updated
  `book_prioritization.js` into the `book_Prioritizations` web resource. See the
  wiring section in the setup doc.

> **PCF caveat to verify on live metadata:** the Mode-C save binds lookups via
> `book_State` / `book_Fund` / `book_Sag` `@odata.bind` (PascalCase nav property
> convention, same as the working grids). If a lookup's navigation property was
> named differently at creation, adjust the bind names — reads use `_value`
> fields and are unaffected.

---

## 11. Verification checklist (when built)

- [ ] Distributed + Breakout Prio → PF stamped `Breakout`; per-Prio tab visible;
      plan anchors on PF.
- [ ] Distributed, non-breakout Prio → PF stamped `State-Rollup`; no per-Prio
      tab; its funded amount appears in the (State, Fund, SAG) bucket.
- [ ] Two non-breakout Prios, **different requirements**, same State+Fund+SAG →
      **one** bucket, funded = sum of both.
- [ ] Centrally managed Requirement → PFs stamped `Central`; excluded from every
      state bucket; single Requirement-level plan maintainable by NPM; setting
      `book_breakout` rejected/auto-cleared.
- [ ] **Flip `book_national` off in FY(active)** → active-FY PFs re-stamp; a
      prior-FY PF under the same Requirement keeps its old stamp and its plan
      rows unchanged.
- [ ] Direct write to a prior-FY PF mode or spend-plan row → rejected by the
      immutability validator.
- [ ] Planned > funded (any mode) → rejected. Past month: Planned locked, Actual
      editable.
- [ ] FY26 Prio: no new behavior; legacy Spend Plan page/columns untouched.
