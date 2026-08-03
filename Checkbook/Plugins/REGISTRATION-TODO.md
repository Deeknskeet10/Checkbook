# Pending Manual Registration — Checkbook (gov env)

Working checklist of everything that must be registered/updated **by hand** in
the Dataverse environment (Plugin Registration Tool + maker portal) to catch the
environment up to `main`. Derived from [`PLUGIN-REGISTRATION.md`](PLUGIN-REGISTRATION.md)
and the changes landed since the last merge (`d75d195`).

> ✅ **Update (2026-08-02).** The **FY27 Spend Plan** and **Fund-Center-lock**
> work formerly tagged *[PENDING – other session]* landed as commit `794cac1`
> — schema, filters, and pre-images below are now final (source of truth:
> [`PLUGIN-REGISTRATION.md`](PLUGIN-REGISTRATION.md) and
> [`../dist/IMPLEMENTATION-FY27SpendPlan.md`](../dist/IMPLEMENTATION-FY27SpendPlan.md)).
> Those items are tagged **[⭐ FY27 SpendPlan/FC]** and are the current focus.

---

## ⭐ Fast path — deploying commit `794cac1` (FY27 Spend Plan + Itemized-Detail FC)

Do these **in order**; each step points at the detail below:

1. **Schema** (maker portal, publish first): `book_itemizeddetails.book_fundcenter`
   lookup + the six `book_spendplan` changes → section **A**.
2. **Env var**: confirm `book_DistributionHoldingFundCenter` is set → section **C**.
3. **Assembly**: re-register `Checkbook_Plugins.dll` in PRT → section **D**.
4. **Steps**: register `PrioritizationItemizedFundCenterDefault`,
   `PrioritizationFundCenterLockGuard`, `SpendPlanFY27Validator` → section **E**.
   ⚠️ Only after step 1 is published — the FC pair needs the
   `book_itemizeddetails` column, the validator needs the `book_spendplan` columns.
5. **PCF**: import [`../dist/ARNGCheckbookExtensions.zip`](../dist/README.md)
   (already rebuilt + version-bumped in the commit) → section **H**.
6. **Form + script wiring** (maker portal): Spend Plan tab, `fundCenter`
   mapping, `book_Prioritizations` web resource → section **H**.
7. **Verify** → section **I** (FY27 items).

---

## 🔧 Fast path — State Swap approval fixes (Aug 2026)

Fixes the reported swap issues: approvals silently skipped (same nesting
re-entry bug as Realignments — no ledgers/distributions/deactivation),
Approved By/On never populated, and one-sided swaps now allowed. **All
code-only** — two deploy actions, no step or schema changes:

1. **Assembly**: re-register `Checkbook_Plugins.dll` in PRT (section **D**).
   Carries: `SwapApprovalPlugin` nesting-guard removal, `SwapValidator`
   Approved By/On stamping + one-sided-swap rule, `SwapRollupPlugin`
   ready-to-approve semantics, and the **preemptive** nesting-guard removal
   in `TurnInApprovalPlugin` + `TurnInDeactivator` (same latent bug — would
   have silently dropped turn-in approvals/denials the moment a real-time
   BR landed on `book_turnin`).
2. **PCF**: import [`../dist/ARNGCheckbookExtensions.zip`](../dist/README.md)
   (rebuilt; `StateSwapApprovalProcess` **v0.2.2** — updated
   readiness message) and publish.
3. **Verify** → section **I** (State Swap items).

---

## A. Schema first — maker portal, publish BEFORE registering dependent steps

- [ ] **`book_distributions`** — add lookup **`book_stateswap`** -> `book_stateswap`
  (peer of `book_turnin`). Swap-linked Distribution views filter on it; reconcile
  treats these rows as immutable. **[COMMITTED — Swap Distributions]**
- [ ] **`book_itemizeddetails`** — add optional lookup **`book_fundcenter`** ->
  `book_fundcenter` (blank = state-level FC). **[⭐ FY27 SpendPlan/FC — `794cac1`]**
- [ ] **`book_spendplan`** — **[⭐ FY27 SpendPlan/FC — `794cac1`]**
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
  holding FC), not just Distributions. **[likely already set — ⭐ verify before E]**

## D. Re-register the plugin assembly

- [ ] Update **`Checkbook_Plugins.dll`** in PRT. This one assembly carries: the
  **RealignmentProcessor fix** (code-only, no step change), the RF-rollup change,
  Swap Distributions, GenerateDistributions amend-in-place, plus — from
  `794cac1` ⭐ — the three new plugin types below, the `StateFundCenterResolver`
  helper, and the **`RequirementFundCenterCascade` change** (now skips FC-locked
  Prios; code-only, its existing step needs no edit). 🔧 Also carries the
  **State Swap approval fixes** (Aug 2026, all code-only, no step changes):
  `SwapApprovalPlugin` nesting-guard removal (approvals were silently
  skipped as "self re-entry"), `SwapValidator` now stamps
  `book_*approvedby/on` on each false→true approval transition (existing
  step filter + pre-image already cover it), and the one-sided-swap rule
  (`SwapValidator` both-sides-contribute check removed; `SwapRollupPlugin`
  isbalanced = at least one side sends + all items paired). 🔧 And the
  **preemptive Turn-In guard removal**: `TurnInApprovalPlugin` +
  `TurnInDeactivator` no longer carry the `IsNestedUpdateOf` guard (their
  step filters + statecode-only deactivation writes make self re-entry
  impossible; a future real-time BR on `book_turnin` would have silently
  killed all approvals, exactly as on realignments/swaps).

## E. New plugin STEPS to register

- [ ] **`Items.PrioritizationItemizedFundCenterDefault`** **[⭐ FY27 SpendPlan/FC — `794cac1`]**
  - Create `book_itemizeddetails` — Post-Op **Sync**, no filter
  - Update `book_itemizeddetails` — Post-Op **Sync**, filter **`statecode`**, **PreImage** (`book_prioritization`)
  - *(no Delete/Deactivate step — by design: removing the last Itemized Detail
    only releases the lock, the Prio keeps the state FC)*
- [ ] **`Validation.PrioritizationFundCenterLockGuard`** **[⭐ FY27 SpendPlan/FC — `794cac1`]**
  - Update `book_prioritization` — Pre-Op **Sync**, filter **`book_fundcenter`**, **PreImage** (`book_fundcenter, book_state`)
- [ ] **`Validation.SpendPlanFY27Validator`** **[⭐ FY27 SpendPlan/FC — `794cac1`]**
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

## H. PCF / Extensions delivery (separate from PRT) **[⭐ FY27 SpendPlan/FC — `794cac1`]**

The zip is **already rebuilt and version-bumped** in the commit — import
[`../dist/ARNGCheckbookExtensions.zip`](../dist/README.md), publish all, then
wire the forms (details in
[`../dist/IMPLEMENTATION-FY27SpendPlan.md`](../dist/IMPLEMENTATION-FY27SpendPlan.md) §3–4):

- [ ] Import the dist zip. Carries `ItemizedDetailsGrid` **v0.3.0** (new
  editable Fund Center column), `PrioritizationFundingGrid` **v0.2.5** (FC on
  sub-rows, no wiring change), and the **new** `PrioritizationSpendPlanGrid`
  **v0.1.0**.
- [ ] **Prioritization main form** — add a **Spend Plan** tab, name exactly
  **`tab_spendplan`** (the form script keys on it), containing the
  `book_prioritizationfunding` subgrid (relationship
  `book_PrioritizationFunding_book_Prioritization_book_Prioritization`, view
  "Active Prioritization Fundings"); replace its control with
  `book_ARNGCheckbook.PrioritizationSpendPlanGrid` on all form factors.
  Mappings: `requirementFunding` → `book_requirementfunding`, `fundedAmount` →
  `book_fundedamount`, `validatedAmount` → `book_validatedamount`.
- [ ] **ItemizedDetailsGrid on the Funding Details tab** — add the new mapping
  `fundCenter` → `book_fundcenter` on all form factors (confirm the control
  shows **v0.3.0** first — Dataverse caches PCF metadata by version).
- [ ] **Web resource `book_Prioritizations`** — paste the updated
  [`../webresources/book_prioritization.js`](../webresources/book_prioritization.js)
  (FY-gated `tab_spendplan` visibility, FY ≥ 2027 + mirrors the FC lock on the
  form while active Itemized Details exist), then publish.

## I. Verify after registering

- [ ] **Realignment approval** now processes end-to-end (toggle BE Decision ->
  ledger pair + funding move + record deactivates). Expected trace now includes
  `Approved and beginning execution`, not `self re-entry — skipping`.
  *(This is the bug that started this — needs the DLL re-registered, step D.)*
- [ ] Swap approval creates the AFP/Allotment **Swap Distributions** and shares
  child items to both states.

🔧 State Swap approval fixes (Aug 2026):

- [ ] **BE approval processes end-to-end**: ledger pairs + Prio/RF funding
  moves + Swap Distributions created, swap **deactivates** (statuscode
  BE Approved). Trace shows `processing BE approval`, not
  `self re-entry — skipping`.
- [ ] Each approval (State A, State B, BE) stamps the matching
  **Approved By / Approved On**; a denial clears all six fields.
- [ ] **One-sided swap**: a swap where only one state adds items becomes
  ready to approve, passes validation, and on BE approval moves funds /
  writes ledgers / distributions in that single direction.
- [ ] **Turn-In regression check** (guard removed preemptively): a normal
  Turn-In approval still processes exactly once (ledgers + distributions,
  record deactivates), and a State-Approval denial still deactivates.
- [ ] A `book_prioritizationfunding` edit updates **both** the parent Prio and
  parent RF funded/validated amounts.

⭐ FY27 Spend Plan / Itemized-Detail FC (`794cac1` — full list in
[`../dist/IMPLEMENTATION-FY27SpendPlan.md`](../dist/IMPLEMENTATION-FY27SpendPlan.md) §5):

- [ ] Add an Itemized Detail with a hand-picked FC → Prio FC flips to the
  state-level FC and locks (form **and** API); setting the locked FC to the
  state FC itself still succeeds, anything else is blocked.
- [ ] Remove all Itemized Details → FC editable again (keeps the state FC).
- [ ] National Requirement FC change → cascade skips FC-locked Prios, still
  updates unlocked ones.
- [ ] FY27 final-approved Prio → Spend Plan tab appears and the grid saves
  Planned/Actual rows; FY26 Prio → tab hidden, legacy Spend Plan untouched.
- [ ] Planned rows over the PF funded amount are blocked; past-month Planned
  cells and future-month Actual cells are frozen.
