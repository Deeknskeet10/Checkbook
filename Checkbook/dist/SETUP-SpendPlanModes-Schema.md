# Maker-Portal Schema Setup — FY27 Spend Plan Modes

Hand-list of every column, choice, key, formula, and environment variable to
create for the three-mode spend plan (Breakout / State-Rollup / Centrally
Managed). Design: [`DESIGN-SpendPlanModes.md`](./DESIGN-SpendPlanModes.md).
Plugin steps to register *after* this: [`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md).

All schema names use the **`book`** publisher prefix — when the maker portal
pre-fills a schema name from the display name, **edit it to match exactly**.
The C# plugins hard-reference these names; a mismatch fails silently.

> **Prerequisite — the FY27 base spend-plan columns must exist first.** This
> build assumes the columns from
> [`IMPLEMENTATION-FY27SpendPlan.md`](./IMPLEMENTATION-FY27SpendPlan.md) §1 are
> already on `book_spendplan`: `book_prioritizationfunding`, `book_fundcenter`,
> `book_rowtype` (Choice: Planned = 0, Actual = 1), the 12 decimal month twins
> `book_newoctober … book_newseptember`, and `book_newspendplantotal`. If they
> are not deployed yet, create them per that doc before the columns below (the
> Mode-C alternate key and the validators depend on `book_rowtype` and the
> month twins).

---

## 1. `book_requirements` (existing table)

| Display name | Schema name | Data type | Settings |
|---|---|---|---|
| Breakout | `book_breakout` | **Yes/No** (Boolean) | Default value **No**. Description: "Child Prioritizations get individual (breakout) spend plans. Ignored when Centrally Managed." |

---

## 2. `book_prioritizationfunding` (existing table)

All three are **plugin-owned** — set by `PrioritizationFundingSpendPlanStamp`
and the cascades. Put them on the form **read-only** if shown at all; users
never edit them.

| Display name | Schema name | Data type | Settings |
|---|---|---|---|
| Centrally Managed | `book_centrallymanaged` | **Yes/No** (Boolean) | Default **No**. Mirror of the Requirement's `book_national`. |
| Spend Plan Mode | `book_spendplanmode` | **Choice** (local) | See the choice values in §4. |
| Line of Accounting | `book_lineofaccounting` | **Lookup** → `book_fundingline` | Stamped from the RF's LOA. (Same schema name the RF uses for its own LOA — that's intentional.) |

---

## 3. `book_spendplan` (existing table)

### Columns

| Display name | Schema name | Data type | Settings |
|---|---|---|---|
| State | `book_state` | **Lookup** → `book_state` | Mode-C anchor. |
| Fund | `book_fund` | **Lookup** → `book_fund` | Mode-C anchor. |
| SAG | `book_sag` | **Lookup** → `book_sag` | Mode-C anchor. |
| Fiscal Year | `book_newfiscalyear` | **Choice** | Use the **existing global choice `goal_fiscalyear`** (the same one on `book_prioritization.book_newfiscalyear` — option *values* are the calendar year, e.g. 2027). Do NOT make a new local set. |
| Funded Amount | `book_fundedamount` | **Decimal** | Precision **2**. The anchor's funded amount; on Mode-C rows this is the rollup written by `SpendPlanStateRollup`. Matches the PF's `book_fundedamount` (also Decimal). |

### Alternate key (Mode-C uniqueness)

Add a key on `book_spendplan`:

- **Display name:** State Rollup Bucket
- **Columns (in order):** `book_state`, `book_fund`, `book_sag`,
  `book_newfiscalyear`, `book_rowtype`

Gives one Planned + one Actual row per (State, Fund, SAG, FY) bucket. It does
not collide with the legacy `book_uniquestatespendplan` key (which keys the
per-Prio legacy shape).

> Alternate keys need all included columns to be searchable; lookups and
> choices are allowed. If key activation fails, confirm none of the five
> columns has *Searchable = No*.

### Formula column — extend `book_spendplantype`

`book_spendplantype` is a formula column. Replace its formula with (adds the
leading State-Rollup branch; keeps the FY27 PF branch and the legacy fallback):

```
If(!IsBlank(book_State) && !IsBlank(book_Fund), "State Rollup",
  If(!IsBlank(book_UnfundedRequest), "Unfunded Request",
    If(!IsBlank(book_PrioritizationFunding), "Prioritization",
      If(!IsBlank(book_Prioritization), "Prioritization", "Requirement"))))
```

Mode A (Centrally Managed) rows anchor on the existing `book_requirementfunding`
lookup and fall through to **"Requirement"** — no new branch needed.

---

## 4. Choice: `book_spendplanmode` (local, on `book_prioritizationfunding`)

Create as a **local** choice on the column. **Set the integer Value of each
option explicitly** to the numbers below (the maker portal proposes prefixed
values like `746490000` — override them, exactly as `book_rowtype` uses 0/1).
The plugins compare against these literal values.

| Label | Value |
|---|---|
| Breakout | **0** |
| State-Rollup | **1** |
| Central | **2** |

State-Rollup is the derived default (never user-picked); no default value need
be set — the stamp plugin always writes one.

---

## 5. Environment variable: `book_activeplanningfy`

| Setting | Value |
|---|---|
| Display name | Active Planning Fiscal Year |
| Schema name | `book_activeplanningfy` |
| Data type | **Text** |
| Default value | *(leave blank)* — or set to the open FY, e.g. `2027` |

The open planning FY as a plain integer string. FYs below it are frozen: the
flag-flip cascades never re-stamp them and `SpendPlanImmutabilityGuard` rejects
direct edits. **Text, not Number** — a decimal-typed value stores as `2027.00`
and won't parse. Leaving it blank makes `FiscalYearHelper` fall back to the
computed federal FY (October-start), which is a safe default.

---

## 6. Order of operations

1. Create everything in §1–§5, then **Publish all customizations**.
2. Build `Checkbook_Plugins.dll` (`cd Plugins && dotnet build -c Release`) and
   register / update the steps per
   [`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md) —
   the new classes are `PrioritizationFundingSpendPlanStamp`,
   `RequirementSpendPlanModeCascade`, `RequirementFundingLoaCascade`,
   `SpendPlanStateRollup`, `SpendPlanImmutabilityGuard`,
   `RequirementBreakoutConsistencyGuard`, plus the updated
   `SpendPlanFY27Validator` step filters.
3. Smoke test before the PCF/form work:
   - Create a PF under a Distributed, non-breakout Requirement → it stamps
     `book_spendplanmode = State-Rollup (1)`, `book_centrallymanaged = No`,
     `book_lineofaccounting` = the RF's LOA.
   - Flip the Requirement to Breakout → the PF re-stamps to `Breakout (0)`.
   - Flip it to Centrally Managed → `book_breakout` auto-clears and the PF
     re-stamps to `Central (2)` with `book_centrallymanaged = Yes`.
   - Set `book_activeplanningfy` below a PF's FY, then try to change that PF's
     mode → blocked by `SpendPlanImmutabilityGuard`.

---

## 7. Form / page wiring (after importing `ARNGCheckbookExtensions.zip`)

The three PCF controls ship in the delivery zip. After import + publish:

1. **Prioritization form** — on the existing `PrioritizationSpendPlanGrid`
   (now v0.2.0, Breakout surface), **map the new `spendPlanMode` property** to
   `book_spendplanmode` on all form factors (Dataverse caches PCF metadata by
   version — confirm v0.2.0 shows first). Without it the grid can't tell which
   allocations are breakout.
2. **Requirement form** — add the `book_requirementfunding` subgrid (RFs under
   the Requirement) and replace its control with
   `book_ARNGCheckbook.RequirementSpendPlanGrid`. Map `fundedAmount` →
   `book_newfundedamount`, `fiscalYear` → `book_newfiscalyear`. It self-hides
   for non-Centrally-Managed requirements.
3. **State Spend Plan page** (Mode-C) — an **HTML web resource**, not a form.
   The state rollup is generalized (spans many Prios/Requirements), so it lives
   on its own page that auto-detects the user's state:
   1. Create a web resource **Name `book_stateSpendPlan.html`**, Type
      **Webpage (HTML)**, upload
      [`../webresources/book_stateSpendPlan.html`](../webresources/book_stateSpendPlan.html),
      Save + **Publish**.
   2. Add it to the Spend Plan app's **site map**: edit the app → add a
      **Subarea** → Type **Web resource** → `book_stateSpendPlan.html` → give it
      a title (e.g. "State Spend Plan") and icon. Publish the app.
   3. Users open that nav item; the page finds their state by walking their
      business-unit chain up to the `book_state` whose `owningbusinessunit` is
      the nearest ancestor (id-based, same rule as the `StateScopeHelper`
      plugin — so users in **child BUs under a state BU** resolve correctly).
      It defaults to the active planning FY (with a FY selector) and reads/writes
      the (State, Fund, SAG) bucket rows via `Xrm.WebApi`. No state picker, no
      code-components toggle, no canvas WebAPI dependency.
   - Depends on `book_spendplanmode`, `book_activeplanningfy`, and the Mode-C
     `book_spendplan` columns (§2, §3, §5) existing and PFs being stamped.
   - The Mode-C save binds `book_State` / `book_Fund` / `book_Sag` via
     `@odata.bind` (PascalCase nav-property convention) — verify these match the
     live navigation-property names; reads use `_value` fields and are unaffected.
   - *(The `StateSpendPlanGrid` PCF + a custom page remain an alternative host;
     the HTML web resource was chosen to avoid the canvas code-components toggle
     and canvas WebAPI limits on the government network.)*
4. **Web resource `book_Prioritizations`** — ⚠ **update this web resource.**
   Paste the current
   [`../webresources/book_prioritization.js`](../webresources/book_prioritization.js)
   into the `book_Prioritizations` web resource and **Publish**. Its
   `applySpendPlanTabVisibility` now shows the Spend Plan tab only when the Prio
   is FY27+ **and** has at least one Breakout allocation
   (`book_spendplanmode = 0`) — so it depends on `book_spendplanmode` (§2)
   already existing and being stamped. Without this update the tab shows for
   every FY27 Prio, including ones whose money is planned on the state/requirement
   plan. (The `book_prioritization.js` change ships in the repo, **not** in the
   PCF `.zip` — it must be pasted in by hand.)

## Quick column reference (for copy/paste)

```
book_requirements:          book_breakout            (Yes/No)
book_prioritizationfunding: book_centrallymanaged    (Yes/No)
                            book_spendplanmode       (Choice 0/1/2)
                            book_lineofaccounting     (Lookup → book_fundingline)
book_spendplan:             book_state               (Lookup → book_state)
                            book_fund                (Lookup → book_fund)
                            book_sag                 (Lookup → book_sag)
                            book_newfiscalyear       (Choice → goal_fiscalyear global)
                            book_fundedamount        (Decimal, 2dp)
                            + alt key (state,fund,sag,newfiscalyear,rowtype)
                            + book_spendplantype formula extended
env var:                    book_activeplanningfy    (Text)
```
