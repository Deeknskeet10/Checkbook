# Web Resource Consolidation — Maker-Portal Wiring Guide

This guide wires the consolidated scripts in this folder into the Dataverse
environment. Work in the maker portal (make.powerapps.com → ARNGCheckbook
solution) unless noted. The environment is authoritative — nothing under
`src/` should be edited by hand.

## Retirement order (per script, never all at once)

1. **Add new** — create the new web resource, paste the `.js` content, Save + Publish.
2. **Rewire** — update each form/command listed below to the new library +
   function name, remove the old handler in the same edit, Save + Publish.
3. **Verify** — smoke-test the form/button behaviors listed under "Verify".
4. **Delete old** — only after verification, delete the retired web resource(s).
   Dataverse blocks the delete if any reference was missed — that is your
   safety net, do not force it.

Conventions used below:

- **WR name** = the web resource *Name* (unique name). Set *Display name* the
  same. Type: **JavaScript (JS)**.
- All form handlers: check **"Pass execution context as first parameter"**
  unless a row says otherwise. The *parameters* column is the
  "Comma separated list of parameters" box — quotes are part of the value.
- Old forms are identified by label and form id so they can be found even if
  labels have drifted.

---

## 1. book_security  (file: `book_security.js`)

Shared library — **no handler registrations**. It exists so role checks stop
being copy-pasted.

- Create WR `book_security`, publish. That is all for now.
- Consumers must list `book_security` as an additional form/command library
  (form scripts can then call `Book.Security.userHasAnyRole(...)`).
- Future rewiring candidates that currently duplicate these helpers (do NOT
  delete these yet — they still carry their own copies):
  - `book_checkbookButtons` (Prioritization approve/reject appactions)
  - `book_hidePriRealignments` (Realignment main forms OnLoad)
  - `book_hidePriTurnIns` (library on Turn-In main form; handler-less)
  - `book_realignmentFormProgression` (Realignment main forms OnLoad)

Note: `Book.Security` fixes two latent bugs in those copies — it also counts
**directly assigned** roles (the old helpers looked at team roles only) and it
matches role names **exactly** instead of by substring.

## 2. book_nav  (file: `book_nav.js`)

Create WR `book_nav`, publish. Then edit each command (app designer → select
table → ... → Edit command bar, or via the appaction) and change the on-click
JavaScript **library to `book_nav`** and **function name** as below. The
parameter stays **PrimaryControl** (`[{"type":5}]`) in every case.

| App (appmodule) | Table | Command label | Old WR / function | New function |
|---|---|---|---|---|
| book_1toNStates | book_prioritization | Cost Estimator | book_cewCustomPage / `openCostEstimate` | `Book.Nav.openCostEstimate` |
| book_ARNGCheckbook | book_prioritization | Cost Estimator | book_cewCustomPage / `openCostEstimate` | `Book.Nav.openCostEstimate` |
| book_ARNGCheckbookUnfundedRequests | book_unfundedrequests | Spend Plan | book_cewSpendPlan / `openSpendPlan` | `Book.Nav.openSpendPlanForUFR` |
| book_1toNStates | book_prioritization | Spend Plan | book_spendPlanPrioritization / `openSpendPlan` | `Book.Nav.openSpendPlanForPrioritization` |
| book_ARNGCheckbook | book_prioritization | Spend Plan | book_spendPlanPrioritization / `openSpendPlan` | `Book.Nav.openSpendPlanForPrioritization` |
| book_1toNStates | book_requirements | Spend Plan | book_spendPlanRequirement / `openSpendPlan` | `Book.Nav.openSpendPlanForRequirement` |
| book_ARNGCheckbook | book_requirements | Spend Plan | book_spendPlanRequirement / `openSpendPlan` | `Book.Nav.openSpendPlanForRequirement` |
| book_ARNGCheckbook | book_requirementfunding | Spend Plan | book_spendPlanRequirement / `openSpendPlan` | `Book.Nav.openSpendPlanForRequirement` |
| book_ARNGCheckbookLedger | book_distributions | Generate Distributions | book_pageDistroModal / `showDistroModal` | `Book.Nav.openGenerateDistributions` |
| book_Strawman | book_fundingtrack | Generate LOAs | book_pageFTModal / `showFTModal` | `Book.Nav.openGenerateLOAs` |
| book_ARNGCheckbook | book_requirements | Validate & Fund | book_pageValidateFund / `openValidateFund` | `Book.Nav.openValidateAndFund` |
| book_ARNGCheckbook | book_requirementfunding | Validate & Fund | book_pageValidateFund / `openValidateFund` | `Book.Nav.openValidateAndFund` |
| book_ARNGCheckbookAdminCenter | book_unfundedrequests | Generate UFRs | book_showUFRModal / `showUFRModal` | `Book.Nav.openGenerateUFRs` |

Verify: each button opens the same page at the same size/title as before;
closing the dialog refreshes the launching form (except **Generate LOAs**,
which intentionally does not refresh — matching the old script).

Delete when done: `book_cewCustomPage`, `book_cewSpendPlan`,
`book_spendPlanPrioritization`, `book_spendPlanRequirement`,
`book_pageDistroModal`, `book_pageFTModal`, `book_pageValidateFund`,
`book_showUFRModal`.

## 3. book_quickcreate  (file: `book_quickcreate.js`)

Create WR `book_quickcreate`, publish. Rewire the three quick-create forms
(form designer → Events → On Load):

| Table / form | Remove handler (library) | Add handler | Pass exec ctx | Parameters |
|---|---|---|---|---|
| LIN Requests quick create `{f786ce0d-ce18-f111-8341-001dd8204135}` | `linRequestQC` (book_linRequestQC) | `Book.QuickCreate.populateParent` | yes | `"book_prioritization"` |
| Turn-In Items quick create `{15492c59-4cf2-f011-8407-001dd805a06b}` | `turnInQC` (book_turnInQC) | `Book.QuickCreate.populateParent` | yes | `"book_turnin"` |
| Obligation Authority quick create `{ab190b61-0fa6-f011-bbd3-001dd805a06b}` | `manageFieldVisibility` (book_updateObligationQuickCreate) | `Book.QuickCreate.populateParentByType` | yes | `"book_prioritization:book_prioritization,book_requirements:book_requirement"` |

Leave the Turn-In Items form's other handler (`TurnInItem.onLoad`,
book_turnInFilterForm) in place.

Verify: launching each quick create from its parent record pre-fills the
lookup; the Obligation Authority quick create hides the Requirement lookup
when launched from a Prioritization and vice versa, and shows both when
launched from anywhere else.

Delete when done: `book_linRequestQC`, `book_turnInQC`,
`book_updateObligationQuickCreate`, and `book_supplyQuickCreate` (already
unreferenced — no rewiring needed, just delete).

## 4. book_requirementfunding  (file: `book_requirementfunding.js`)

Create WR `book_requirementfunding`, publish. Edit the **Requirement Funding
main form** "Information" `{bd6e50da-e765-4cbb-bbd4-d419e58c55f2}`:

| Event | Remove handler (library) | Add handler | Pass exec ctx | Parameters |
|---|---|---|---|---|
| Form OnLoad | `lockAmountFields` (book_reqFundLockFields) **and** `Book.RequirementFunding.onFormLoad` (book_requirementFundingValidation) | `Book.RequirementFunding.onLoad` | yes | (none) |
| Form OnSave | `Book.RequirementFunding.onFormSave` (book_requirementFundingValidation) | **nothing** — the RequirementFundingTDPValidator plugin is the enforcement | — | — |
| `book_requirement` OnChange | `lockAmountFields` (book_reqFundLockFields) | `Book.RequirementFunding.onRequirementChange` | yes | (none) |
| `book_lineofaccounting` OnChange | `onFundingLineChange` (registered under the book_reqFundLockFields library, but the code lives in book_reqFundOnLOAChange) | `Book.RequirementFunding.onLOAChange` | yes | (none) |
| `book_newfiscalyear` OnChange | (none — new) | `Book.RequirementFunding.onFiscalYearChange` | yes | (none) |

Also remove the now-unused form libraries `book_reqFundLockFields`,
`book_requirementFundingValidation`, `book_reqFundOnLOAChange` and add
`book_requirementfunding`.

**FY27+ form changes (do these on the Requirement Funding main form):**
- Make **Fiscal Year** (`book_newfiscalyear`) **Business Required** on the
  form (field properties → Required, or a business rule if you want it scoped
  to new records only). It was recently un-hidden for FY27. The script locks
  it after creation (editable on create, read-only on update) — no form
  designer setting needed for that.
- Register the new `book_newfiscalyear` OnChange handler above.
- No LOA lookup config is needed in the form designer — the FY→LOA filter is
  applied in script (`addPreSearch`/`addCustomFilter`), because option-set-keyed
  lookup filtering has no native form-designer setting.

Behavior changes (intentional):
- Save is **never blocked client-side** and there is no more synchronous
  XHR. Over-cap TDP now shows an async WARNING banner; the plugin rejects the
  save server-side.
- No more field-level `setNotification` on TDP (a field notification blocks
  save — that was enforcement, not advice).
- **FY now drives LOA (FY27+ direction flip).** The `book_lineofaccounting`
  lookup is filtered to `book_fundingline` rows whose `book_fiscalyear`
  matches the selected FY. Changing FY drops a now-mismatched LOA so the user
  re-picks. The old LOA→FY auto-default (`defaultFiscalYearFromLOA`) is
  **retired** to avoid a circular dependency — `onLOAChange` no longer touches
  the FY field.
- Everything else is preserved: debounced advisory TDP check with
  INFO/WARNING banners, amount-lock UI from the Requirement type.

Verify: on a **new** RF record Fiscal Year is editable; reopen a **saved** RF
record — Fiscal Year is read-only. Amounts lock/unlock per Requirement type; pick a
Fiscal Year, then open the LOA lookup — only that FY's funding lines appear;
change FY to another year — a mismatched LOA clears and the lookup re-filters;
change LOA — the advisory banner re-runs (and FY is left untouched); enter an
over-cap TDP — WARNING banner appears but the save reaches the server, where
the plugin rejects it. FY cannot be left blank on save (Business Required).

Delete when done: `book_requirementFundingValidation`,
`book_reqFundLockFields`, `book_reqFundOnLOAChange`.

## 5. book_decisionevent  (file: `book_decisionevent.js`)

Create WR `book_decisionevent`, publish. Edit the **Decision Event main
form** "Information" `{6a295907-13fa-48ea-9c06-48ea5411a611}`:

| Event | Remove handler (library) | Add handler | Pass exec ctx | Parameters |
|---|---|---|---|---|
| Form OnLoad | `decisionEventOnLoad` (book_calculateRollUp) | `Book.DecisionEvent.onLoad` | yes | (none) |

Swap the form library `book_calculateRollUp` → `book_decisionevent`.

Verify: open a Decision Event with ledger children — the Decision Balance
rollup recalculates and the form refreshes with the new value (the old script
threw a ReferenceError before the refresh, so a working refresh is the fix).

Delete when done: `book_calculateRollUp`.

## 6. book_spendplanvalidate  (file: `book_spendplanvalidate.js`)

Create WR `book_spendplanvalidate`, publish. Edit the **Spend Plan main
form** "Information" `{58df6e79-9420-45c6-b876-5862f5cc4727}`:

| Event | Remove handler (library) | Add handler | Pass exec ctx | Parameters |
|---|---|---|---|---|
| Form OnLoad | `Book.SpendPlan.onFormLoad` (book_spendPlanValidate) | `Book.SpendPlanValidate.onLoad` | yes | (none) |
| Form OnSave | `Book.SpendPlan.onFormSave` (book_spendPlanValidate) | `Book.SpendPlanValidate.onSave` | yes | (none) |

Swap the form library `book_spendPlanValidate` → `book_spendplanvalidate`.

Verify: monthly totals still validate with banners/field highlights; **new**:
on a Spend Plan whose Type is "Prioritization", the Prioritization quick view
(`qvPri`) now appears (the old comparison bug meant it never did).

Delete when done: `book_spendPlanValidate`.

## 7. book_ufrformbehavior  (file: `book_ufrformbehavior.js`)

Create WR `book_ufrformbehavior`, publish. Edit **both Unfunded Request main
forms** — "UFR - State" `{290d4184-6941-f011-b4cc-001dd8059413}` and
"UFR - OPR" `{8e52c793-6941-f011-b4cc-001dd805a06b}`:

| Event | Remove handler (library) | Add handler | Pass exec ctx | Parameters |
|---|---|---|---|---|
| Form OnLoad | `SwitchUFRForm` (crbc0_swapFormsUFR) | `Book.UFR.onLoad` | yes | (none) |

Swap the form library `crbc0_swapFormsUFR` → `book_ufrformbehavior` on both
forms.

The form labels ("UFR - State", "UFR - OPR") and BPF unique names
(`book_arngcheckbookufr` = UFR Acceptance, `book_arngcheckbookufrvalidation`
= UFR Validation) are constants at the top of the file — if a form or BPF is
renamed, update the constants and re-upload; no GUID hunting needed.

Verify: opening a UFR **with** a Higher Level UFR lands on "UFR - State" with
the UFR Acceptance BPF; one **without** lands on "UFR - OPR" with the UFR
Validation BPF; no console errors (the old script used `Xrm.Page`, which is
removed in newer clients).

Delete when done: `crbc0_swapFormsUFR` (this also retires the last `crbc0_`
foreign-publisher web resource).

---

## 8. book_recalculateLoaTdp  (file: `book_recalculateLoaTdp.js`)

**New command, no retirement.** Calls the `book_RecalculateLOATDP` Custom API
(plugin `Checkbook.Plugins.Recalculations.LOATDPReconciler`) to bulk-reconcile
LOA TDP after a bulk Funding Track load (Edit-in-Excel / Import Wizard writes at
Depth 2, where `FundingTrackTDPRecalculator` skips the roll-up). See
[`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md) →
`LOATDPReconciler` for the Custom API definition and params.

- Prerequisite: register the assembly and create the `book_RecalculateLOATDP`
  Custom API. The step type must allow **Sync** — this loop reads `HasMore`
  from each response, and async runs return no body.
- Create WR `book_recalculateLoaTdp`, type **JavaScript (JS)**, publish.
- Recommended home: a **Funding Line (LOA) view command** in the admin app
  (e.g. label "Reconcile TDP"). Edit the command bar → Run JavaScript:

| Library | Function | Parameters (in order) |
|---|---|---|
| `book_recalculateLoaTdp` | `LoaTdpReconciler.run` | `PrimaryControl` (`[{"type":5}]`); optionally add an Integer literal for `FiscalYear`, then one for `BatchSize` |

With only `PrimaryControl` wired, it reconciles **all FYs** at the default page
size (200). Add an Integer `FiscalYear` (the `book_fiscalyear` option value) to
scope one year, and/or an Integer `BatchSize` to override the page size.

Verify: run the button, watch the progress indicator page through, confirm the
completion dialog reports `Processed` of `TotalInScope`, and spot-check that an
imported LOA's `book_newtdp` now equals Σ its active Funding Track Resource
Amounts (+ Ledger net). Re-running is idempotent — counts stay the same, values
don't drift.

> No-code alternative: a cloud flow *Perform an unbound action* →
> `book_RecalculateLOATDP` needs no web resource. Loop it with a Do-Until on
> `HasMore` for large scopes, or run the API **Async** for fire-and-forget.

---

## Cross-reference: already-dead web resources

Safe to delete without any rewiring (verify the delete isn't blocked by a
dependency first — if it is, remove the stale library reference the portal
points at, then retry):

- `book_tabVisibility` — unreferenced.
- `book_supplyQuickCreate` — unreferenced (covered in §3).
- Handler-less libraries superseded by `Book.Prioritization` /
  `Book.Requirements` (already shipped): `book_verifyUniquePri`,
  `book_populateUserBU`, `book_showHideFC`, `book_showHideDOMOPs`,
  `book_toggleReqTab`.
- `book_hidePriTurnIns` — listed as a form library on the Turn-In main form
  `{676d1438-a523-497d-8ae4-261b007eb4bc}` but has **no registered handler**
  there; remove the library from that form, publish, then delete.

Still live, untouched by this pass: `book_checkbookButtons`,
`book_hidePriRealignments`, `book_realignmentFormProgression` (candidates to
adopt `book_security` later), `book_turnInFilterForm`, `book_resetStateUFR`,
`book_generateLOAs`, `book_genManualDistributions`, `book_generateDistributions`,
`book_Prioritizations`, `book_Requirements`, `book_reqDetailFieldRequired`,
`book_allocation`, `book_ledger`, `book_fund`, `book_recertification`,
`cr2f7_documentBook`.

---

## 9. book_Prioritizations update — FY27 Spend Plan tab (Jul 2026, FC lock retired Aug 2026)

File: `book_prioritization.js` → paste into the existing WR
**`book_Prioritizations`** (already wired to the Prioritization main form:
OnLoad `Book.Prioritization.onLoad`, OnSave `.onSave`, OnChange handlers on
`book_requirementfunding` / `book_requirement`). No handler rewiring needed —
this is a content update + publish.

What the update adds:

- `applySpendPlanTabVisibility` (called from onLoad) — shows the new
  **Spend Plan** tab (`tab_spendplan`, hosts
  `book_ARNGCheckbook.PrioritizationSpendPlanGrid`) only when
  `book_newfiscalyear` >= 2027. FY26 and earlier keep the legacy Spend Plan
  command-bar page.
- *(Retired Aug 2026: a Jul 2026 revision also disabled `book_fundcenter`
  while the Prio had active Itemized Details, mirroring the
  `PrioritizationFundCenterLockGuard` plugin. Both the plugin and the mirror
  were removed — the submitting state sets the FC on its own Prios — so
  `applyFundCenterLock` is back to the centrally-managed (`book_national`)
  lock only. If the itemized-lock version of the script was ever published,
  paste the current file again.)*

Verify after publish:

- FY26 Prio → no Spend Plan tab; FY27 Prio → tab visible.
- Prio with Itemized Details → Fund Center stays editable (only the national
  lock disables it).

Full feature deployment (schema, plugins, PCF wiring):
[`../dist/IMPLEMENTATION-FY27SpendPlan.md`](../dist/IMPLEMENTATION-FY27SpendPlan.md).
