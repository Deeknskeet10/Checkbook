# Spend Plan — State Read Access & FY27 Prioritization/LOA Stamp

Covers two changes that ship together:

1. **State read access** — the Prioritization Spend Plan PCF renders for any
   state user, not only the Prioritization owner.
2. **Prioritization + LOA stamp** — FY27 spend plan rows now carry
   `book_prioritization` and `book_lineofaccountingloa`, and a Prioritization
   may have **many** spend plan rows (one per Prioritization Funding / Fund
   Center / Row Type).

---

## 1. Why the PCF showed "RF not allocated" to non-owners

The Prioritization Spend Plan PCF builds its whole table from the bound
`book_prioritizationfunding` subgrid, plus Web API reads of
`book_itemizeddetails` and `book_prioritization`. A user who cannot read those
junction/detail rows sees an **empty** subgrid → the grid falls back to its
"No Requirement Funding has been allocated" empty state, even though the
Prioritization and the spend plan record itself are readable.

`Book - State PM` read on those tables was **Local** (own business unit only),
while `Book - State Approver` / `Book - State Administrator` were **Deep**.

### Fix — security role read depth

Set **Read** on these tables to at least **Business Unit (Deep)** for the
state-facing roles so a state's own users see the plan the same way the owner
does. In the repo this is done for `Book - State PM`
(`src/ARNGCheckbook/Roles/Book - State PM.xml`), bumped Local → Deep on:

- `book_prioritizationfunding`
- `book_itemizeddetails`
- `book_prioritization`
- `book_spendplan`

> **Delivery:** role privileges are **not** shipped by the extension `.zip`
> (re-importing the full `src/ARNGCheckbook` solution would overwrite in-env
> role edits). Make the same change directly in the Maker Portal:
> Solutions/Security → **Book - State PM** → each table → set **Read** to the
> business-unit (or Parent: Child) level.

### Env-side caveat (verify this if it still fails)

A `Book - State Administrator` is already **Deep** yet still could not see the
grid in one reported case (Minnesota admin, Minnesota-owned plan). Deep only
reaches your BU **subtree**, so if the `book_prioritizationfunding` junctions
or `book_itemizeddetails` for that Prioritization are **owned in a different
business unit** (e.g. a central/national BU) than the reader, Deep will not
reach them. To confirm:

1. Open the affected Prioritization as the failing user.
2. In an Advanced Find / table view, check whether that user can see the
   **Prioritization Funding** rows and **Itemized Details** rows for it.
3. If not, check those rows' **Owning Business Unit**. If it is not the state's
   BU, the fix is to correct the ownership stamp (see the `Prio Funding BU
   scoping` design — junctions should carry the parent Prioritization owning
   BU) rather than to widen read depth further.

If cross-state visibility is actually desired, set Read to **Organization**
(matches `Book - Read Only` / `Book - Budget Executor`, which are already Org).

---

## 2. Prioritization + LOA stamp on FY27 rows

`book_spendplan` already has the `book_prioritization` and
`book_lineofaccountingloa` lookups. Previously FY27 rows left
`book_prioritization` empty because a single-column **alternate key**
(`book_uniquestatespendplan` on `book_prioritization`) allowed only one row per
Prioritization — fine for FY26 (one plan per Prio) but wrong for FY27, where a
Prioritization has one row per Prioritization Funding × Fund Center × Row Type.

### 2a. Drop the alternate key (Maker Portal)

Tables → **Spend Plan** (`book_spendplan`) → **Keys** → delete
**`book_uniquestatespendplan`** (the key whose only column is
`book_prioritization`).

- The repo copy has been removed from
  `src/ARNGCheckbook/Entities/book_SpendPlan/Entity.xml`.
- FY27 uniqueness is enforced in code instead: `SpendPlanFY27Validator`
  rejects a second active row for the same (PF, Fund Center, Row Type) anchor —
  so a state still cannot submit two spend plans for one Prioritization Funding.
- FY26 rows are frozen and no longer created, so losing the FY26 uniqueness key
  is acceptable.
- Keep the other keys (`book_StateRollupBucket`, `book_uniqueUFRSpend`).

### 2b. Stamping (already in the plugin — no maker step)

`SpendPlanFY27Validator` (Pre-Operation **Create** on `book_spendplan`) stamps
Breakout rows from the anchor Prioritization Funding:

- `book_prioritization` ← PF `book_prioritization`
- `book_lineofaccountingloa` ← PF `book_lineofaccounting`

Both are set only if the caller did not already supply them, and only on
Create (the anchor is immutable afterward). The FY27 validator's legacy-anchor
exclusivity check was relaxed to permit `book_prioritization` on FY27 rows
(`book_requirement` / `book_unfundedrequest` stay FY26-only).

### 2c. Surface the stamped fields

Add `book_prioritization` and `book_lineofaccountingloa` to the Spend Plan
views / forms the states use, so they can filter and pull LOA off the row
without walking the Prioritization Funding.
