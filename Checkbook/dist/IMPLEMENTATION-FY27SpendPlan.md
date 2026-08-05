# FY27 Spend Plans + Itemized Detail Fund Centers — Implementation & Deployment

Design agreed Jul 2026. Two connected features:

> **Revised Aug 2026 — FC lock retired.** The original design forced and
> locked the Prioritization-level FC to the state-level FC while Itemized
> Details existed (`PrioritizationItemizedFundCenterDefault` +
> `PrioritizationFundCenterLockGuard`). Both plugins were removed before ever
> being registered: the submitting state sets the FC on its own
> Prioritizations. The per-line FC on Itemized Details stays (likely unused
> this FY), and centrally managed Requirements still push their FC onto
> Prios (backfill + cascade).

1. **Fund Center on Itemized Details** — per-line FC granularity.
2. **FY27+ Spend Plans** — a new Prioritization form tab
   (`book_ARNGCheckbook.PrioritizationSpendPlanGrid`) with one section per
   Prioritization Funding row, Planned / Actual / Variance bands across the
   12 federal FY months, and per-Fund-Center breakdowns.

**Hard rule: FY26 keeps its current behavior.** FY26 spend plans stay on the
legacy custom page (`Page - Spend Plan`) and the legacy `book_spendplan`
columns; nothing in this delivery touches them. FY27 rows are invisible to the
legacy automation because they leave `book_prioritization` /
`book_unfundedrequest` empty (see Data shape below).

---

## 1. Schema (deploy first)

Authored in `src/ARNGCheckbook` (Entity.xml + Relationships + formula yaml);
mirror in the maker portal if deploying by hand:

### `book_itemizeddetails`
| Column | Type | Notes |
|---|---|---|
| `book_fundcenter` | Lookup → `book_fundcenter`, optional | Destination FC for the line. **Blank = state-level FC** (the Prio FC). |

### `book_spendplan`
| Column | Type | Notes |
|---|---|---|
| `book_prioritizationfunding` | Lookup → `book_prioritizationfunding`, optional | FY27 row anchor. Relationship cascade **Delete = Cascade** (removing an allocation removes its plan rows). |
| `book_fundcenter` | Lookup → `book_fundcenter`, optional | Set on per-FC breakdown rows; **null on the per-RF rollup row**. |
| `book_rowtype` | Choice (local): Planned = `0`, Actual = `1` | Variance is computed in the grid, never stored. |
| `book_newoctober` … `book_newseptember` | Decimal (2 dp), 12 columns | Decimal twins of the legacy float months, used only by FY27 rows. |
| `book_newspendplantotal` | Calculated decimal | Sum of the 12 decimal twins. |
| `book_spendplantype` (existing formula) | — | Extended so PF-anchored rows also evaluate to "Prioritization". |

### Data shape for FY27 rows
- Anchor: `book_prioritizationfunding` (one section per allocated RF).
  `book_prioritization` **must stay empty** — the `book_uniquestatespendplan`
  alternate key allows only one legacy row per Prio, and legacy flows key off
  that lookup.
- Single destination (no Itemized Details, or all lines on one FC): one
  Planned + one Actual row per PF, `book_fundcenter` null.
- Multiple destinations: one Planned + one Actual row per PF × FC; the grid
  computes the rollup, nothing rollup-level is stored.

---

## 2. Plugins (register after schema is published)

Register `Checkbook_Plugins.dll` steps per
[`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md):

| Plugin | What it does |
|---|---|
| `Validation.SpendPlanFY27Validator` (new) | FY27 rows only: PF/Prio anchor exclusivity, one active row per (PF, FC, RowType), **Planned total ≤ PF funded** (equality intentionally not enforced so plans can be entered incrementally — the grid badge shows completeness), and month locks (Planned frozen once the month passes; Actual only for completed months). |

*(The FC lock pair originally listed here — `PrioritizationItemizedFundCenterDefault`
and `PrioritizationFundCenterLockGuard` — was retired Aug 2026 before
registration; see the note at the top. `RequirementFundCenterCascade` is
unchanged from its pre-FY27 behavior.)*

---

## 3. PCF controls (import `ARNGCheckbookExtensions.zip`)

| Control | Change |
|---|---|
| `ItemizedDetailsGrid` v0.3.0 | New editable **Fund Center** column: dropdown of the Prio states FCs plus a "State level (…)" option that clears the field. Requires the new `fundCenter` property mapping (see wiring). |
| `PrioritizationFundingGrid` v0.2.5 | Itemized Detail sub-rows show a read-only Fund Center column ("State level" when blank). No wiring change. |
| `PrioritizationSpendPlanGrid` v0.1.0 | New. Binds the `book_prioritizationfunding` subgrid on the Prioritization form. |

### Grid behavior (PrioritizationSpendPlanGrid)
- One section per PF row, showing `Planned $X / Funded $Y` (green when equal).
- Single destination → the three bands are edited directly on the section.
- Multiple destinations → section bands become computed rollups and the
  chevron expands per-FC bands (union of the FCs on the Prios Itemized
  Details plus any FCs that already have stored rows, so data never hides).
- Planned cells editable until their month passes; Actual cells editable only
  after; Variance = Actual − Planned (red when over).
- Grid is editable only when the Prio is final approved
  (`book_approvalstatus` = 4) and FY ≥ 2027.
- Save is explicit (Save/Discard buttons); rows are created on first save.
- Advisory banner when per-FC planned totals differ from the Itemized Detail
  funding routed at that FC (Prio-level crosscheck — soft by design, revisit
  after field feedback).

---

## 4. Form + script wiring (maker portal)

1. **Prioritization main form** ("Information"): add a **Spend Plan** tab
   (name `tab_spendplan`) containing the `book_prioritizationfunding` subgrid
   (relationship `book_PrioritizationFunding_book_Prioritization_book_Prioritization`,
   view "Active Prioritization Fundings"), and replace its control with
   `book_ARNGCheckbook.PrioritizationSpendPlanGrid` on all form factors.
   Property mappings: `requirementFunding` → `book_requirementfunding`,
   `fundedAmount` → `book_fundedamount`, `validatedAmount` → `book_validatedamount`.
   (Already present in `src` FormXml if importing the solution.)
2. **Funding Details tab / ItemizedDetailsGrid**: add the new mapping
   `fundCenter` → `book_fundcenter` on all form factors after updating the
   control (Dataverse caches PCF metadata by version — confirm v0.3.0 shows).
3. **Web resource `book_Prioritizations`**: paste the updated
   [`../webresources/book_prioritization.js`](../webresources/book_prioritization.js)
   (adds the FY-gated Spend Plan tab visibility; the FC form lock still
   applies only to centrally managed Requirements), then publish.

---

## 5. Verification checklist

- [ ] Add an Itemized Detail to a Prio → the Prio FC is untouched and stays
      user-editable (form + API) for state-submitted work.
- [ ] Prio under a centrally managed Requirement → FC still Requirement-owned
      (backfilled on create, cascaded on Requirement FC change, disabled on
      the form).
- [ ] FY26 Prio: no Spend Plan tab; legacy Spend Plan button/page unchanged.
- [ ] FY27 Prio (final approved): tab visible; enter Planned months, Save →
      rows created with PF anchor, no `book_prioritization`, type shows
      "Prioritization".
- [ ] Planned > funded → save blocked by `SpendPlanFY27Validator`.
- [ ] Past month: Planned cell locked, Actual cell editable, Variance shown.
- [ ] Multi-FC Prio: section expands per FC; rollup bands read-only sums.
