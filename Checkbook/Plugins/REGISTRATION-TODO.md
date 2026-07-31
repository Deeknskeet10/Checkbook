# Pending Manual Registration — Checkbook (gov env)

Working checklist of everything that must be registered/updated **by hand** in
the Dataverse environment (Plugin Registration Tool + maker portal) to catch the
environment up to `main`. Derived from [`PLUGIN-REGISTRATION.md`](PLUGIN-REGISTRATION.md)
and the changes landed since the last merge (`d75d195`).

> ⚠️ **Status tags.** The **FY27 Spend Plan** and **Fund-Center-lock** plugins
> (3 classes) were still **untracked/uncommitted** (a parallel session's
> in-progress work) when this list was written — their `.cs` files build locally
> but schema/filters could still change. Confirm that work is finished before
> registering their steps. Everything else is committed and stable. Each item is
> tagged **[COMMITTED]** or **[PENDING – other session]**.

---

## A. Schema first — maker portal, publish BEFORE registering dependent steps

- [ ] **`book_distributions`** — add lookup **`book_stateswap`** -> `book_stateswap`
  (peer of `book_turnin`). Swap-linked Distribution views filter on it; reconcile
  treats these rows as immutable. **[COMMITTED — Swap Distributions]**
- [ ] **`book_itemizeddetails`** — add optional lookup **`book_fundcenter`** ->
  `book_fundcenter` (blank = state-level FC). **[PENDING – other session]**
- [ ] **`book_spendplan`** — **[PENDING – other session]**
  - [ ] lookup **`book_prioritizationfunding`** -> `book_prioritizationfunding`
    (FY27 row anchor — leave `book_prioritization` empty on FY27 rows; the
    `book_uniquestatespendplan` alt-key allows only one legacy row per Prio)
  - [ ] lookup **`book_fundcenter`** -> `book_fundcenter` (null on per-RF rollup rows)
  - [ ] Choice **`book_rowtype`** — **Planned = 0**, **Actual = 1**
  - [ ] 12 decimal twins **`book_newoctober` … `book_newseptember`** (2 decimals each)
  - [ ] calculated decimal **`book_newspendplantotal`** = sum of the 12 twins
  - [ ] extend the **`book_spendplantype`** formula to treat PF-anchored rows as "Prioritization"
- [ ] *Verify already-present from earlier swap work* (skip if done):
  `book_ledger.book_stateswap` lookup · `book_ledgertype` value **2** relabeled
  Add->**Swap** · `book_swapitem` 1:N from `book_stateswap` = **Share cascade: Cascade All**.

## B. Custom API

- [ ] **`book_GenerateDistributions`** — add response property **`Updated`**
  (Integer) for the amend-in-place build (count of pending rows amended).
  Handler is wired via the Custom API's Plugin Type — no separate step. **[COMMITTED]**

## C. Environment variables

- [ ] **`book_DistributionHoldingFundCenter`** — confirm set to the A18 record
  GUID. Now *also* read by the FC-lock pair (defines "state-level FC" = child of
  holding FC), not just Distributions. **[likely already set]**

## D. Re-register the plugin assembly

- [ ] Update **`Checkbook_Plugins.dll`** in PRT. This one assembly carries: the
  **RealignmentProcessor fix** (code-only, no step change), the RF-rollup change,
  Swap Distributions, GenerateDistributions amend-in-place, plus the new plugin
  types below.

## E. New plugin STEPS to register

- [ ] **`Items.PrioritizationItemizedFundCenterDefault`** **[PENDING]**
  - Create `book_itemizeddetails` — Post-Op **Sync**, no filter
  - Update `book_itemizeddetails` — Post-Op **Sync**, filter **`statecode`**, **PreImage** (`book_prioritization`)
  - *(no Delete/Deactivate step — by design)*
- [ ] **`Validation.PrioritizationFundCenterLockGuard`** **[PENDING]**
  - Update `book_prioritization` — Pre-Op **Sync**, filter **`book_fundcenter`**, **PreImage** (`book_fundcenter, book_state`)
- [ ] **`Validation.SpendPlanFY27Validator`** **[PENDING]**
  - Create `book_spendplan` — Pre-Op **Sync**, no filter
  - Update `book_spendplan` — Pre-Op **Sync**, **PreImage** (all month/anchor attrs **+ `statecode`**),
    filter = `book_prioritizationfunding, book_fundcenter, book_rowtype, book_prioritization, book_newoctober…book_newseptember` (all 12 months)
- [ ] **`StateSwaps.SwapItemAutoSharePlugin`** **[COMMITTED]**
  - Create `book_swapitem` — Post-Op **Sync**, no filter

## F. Existing plugin STEPS to MODIFY

- [ ] **`Recalculations.PrioritizationFundingRollup`** — now rolls up to parent **RF** as well as Prio: **[COMMITTED]**
  - Update `book_prioritizationfunding`: **add `book_requirementfunding`** to the filter ->
    `book_fundedamount, book_validatedamount, book_prioritization, book_requirementfunding, statecode`;
    **add `book_requirementfunding` to the PreImage**
  - Delete `book_prioritizationfunding`: **add `book_requirementfunding` to the PreImage**
- [ ] **`StateSwaps.SwapAutoSharePlugin`** — Update `book_stateswap`: **remove the
  filtering attributes** (must fire on *any* user save for the backfill sweep);
  keep the **PreImage** (`book_statea, book_stateb`). **[COMMITTED]**

## G. Security roles / teams

- [ ] Swap drafter's role needs **User-level Share on `book_swapitem`** —
  `SwapItemAutoSharePlugin` runs as the calling user and shares each new item with
  the state teams. **[COMMITTED]**
- [ ] *Verify* per-state owner teams exist (`{Abbr} - State Approver` /
  `{Abbr} - State Administrator`) and swap role grants from earlier swap work are in place.

## H. PCF / Extensions delivery (separate from PRT)

- [ ] `ItemizedDetailsGrid` and `PrioritizationFundingGrid` changed — rebuild the
  `ARNGCheckbookExtensions` zip, **bump each manifest version**, import + publish,
  and **re-point any canvas/custom pages** that host them (reimport alone won't
  pick up the new version).

## I. Verify after registering

- [ ] **Realignment approval** now processes end-to-end (toggle BE Decision ->
  ledger pair + funding move + record deactivates). Expected trace now includes
  `Approved and beginning execution`, not `self re-entry — skipping`.
  *(This is the bug that started this — needs the DLL re-registered, step D.)*
- [ ] Swap approval creates the AFP/Allotment **Swap Distributions** and shares
  child items to both states.
- [ ] A `book_prioritizationfunding` edit updates **both** the parent Prio and
  parent RF funded/validated amounts.
