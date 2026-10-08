# Realignment FY27 — Gov Cutover Checklist

Status: **living checklist** · Last updated 2026-10-08

Everything the FY27 realignment redesign needs in **gov** that is NOT carried by
simply re-importing `src/ARNGCheckbook`. Most of this was applied in the
Blipsnchitz sandbox directly (metadata API / portal) and must be reproduced in
gov. Grouped by delivery channel. See `Realignment-FY27-Redesign.md` and
`Prioritization-Funding-Reconciliation.md` for the why.

## 1. Schema — via a focused unmanaged solution (to build/export from sandbox)
Do **not** pack `src/ARNGCheckbook` (stale + overwrites gov roles). Import a focused
`book`-publisher solution containing:

- **New tables** (with all columns + relationships):
  - `book_realignmentitem` (+ parent fields on `book_realignments`:
    `book_realignmententrymode`, `book_totalamount`, `book_allsamefundsag`, `book_itemcount`)
  - `book_realignmentdetailreduction`
  - `book_realignmentdetailincrease`
- **`book_realignments` column:** `book_newfiscalyear` (Picklist bound to global
  `goal_fiscalyear`) — the editable FY; the existing `book_fiscalyear` is a formula column.
- **Relaxed required levels** on `book_realignments` (ApplicationRequired → None):
  `book_fund`, `book_newamount`, `book_newdebitedloa`, `book_newcreditedloa`.
  (Sandbox scripts: `realign_relax_required.py`. Carried by the solution if these
  attributes are included as components.)

> Sandbox scripts that built the above (Python, cannot run against gov — they are the
> source of truth for what the solution must contain):
> `schema/realign_item_schema.py`, `schema/realign_detailreduction_schema.py`,
> `schema/realign_detailincrease_schema.py`, `schema/realign_add_fiscalyear.py`,
> `schema/realign_relax_required.py`.

## 2. Plugin assembly — via PRT / plugin push
Update `Checkbook_Plugins.dll` in gov (same process as any plugin change). Code
changes in this effort: `RealignmentProcessor`, `RealignmentValidator`,
`SetSameFundSagFlagPlugin` (empty-shell guard), plus the new constants.
**No new SDK steps** — the detail tables are data-only; the item steps
(`RealignmentItemDerivedFields`, `RealignmentRollup`) were already registered.

## 3. PCF controls — via `ARNGCheckbookExtensions` delivery zip
Import `dist/ARNGCheckbookExtensions.zip` (as usual). Includes `RealignmentBuilder`
(v0.1.4) and `RealignmentApprovalProcess`.

## 4. Process state (portal / admin)
- **Deactivate the BPF `Realignments - Review/Approve`** (category 4 on
  `book_realignments`). It was retired in favor of the `RealignmentApprovalProcess`
  chevron; while active it renders the legacy process bar on every form. Sandbox:
  deactivated 2026-10-08.

## 5. Form edits (maker portal, per environment)
On the realignment entry form(s) State users use:
- Add the **Fiscal Year** field = **`book_newfiscalyear`** (NOT the formula `book_fiscalyear`).
- Add the **RealignmentBuilder** component, bound to the **Amount** field
  (`book_newamount`, Decimal). Full-width section.
- Add the **RealignmentApprovalProcess** component (bound to `book_name`) if not already present.
- Hide the now-optional legacy fields: Fund, Debited LOA, Credited LOA (and Amount if desired —
  the builder writes it).
- Realignment **Name** is auto-populated by a process, so it need not be on the form.

## 6. Flow of use (State path)
Create realignment → set **Fiscal Year** → **Save** (shell) → **RealignmentBuilder**:
pick debit/credit Prioritization, PF moves, credit RF, and (for itemized Prios) the
detail reduction/increase grids → **Save realignment items** → a State approver acts on
the **RealignmentApprovalProcess** chevron → the processor moves the funds and deactivates
the realignment.

## Still not built (not blockers for State-path cutover)
- OPR / direct path (RDF, RF→RF) entry in the builder.
- Automatic role detection + entry-mode override in the builder.
- Per-item credit-RF selection; multi-RF itemized credit (server rejects today).
