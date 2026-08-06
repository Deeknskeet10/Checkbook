# Plugin Registration

How to register the `Checkbook_Plugins.dll` plugins against a Dataverse
environment using the **Plugin Registration Tool (PRT)**. PRT is the only
delivery mechanism — solution `.zip`s cannot carry step registrations for this
project (see `Checkbook/CLAUDE.md`).

This file is the source of truth for **what steps should exist** in any env
running these plugins. When you finish a registration session, walk the
verification checklist at the bottom and confirm every row is present.

The assembly currently ships **38 concrete plugin classes** (37 + the four
`LOATouchPropagator` subclasses minus the abstract base), grouped under
`Checkbook.Plugins.<folder>`. Deep-dive docs covering prerequisites, Custom
APIs, and smoke tests:
[`LOAs/REGISTRATION.md`](LOAs/REGISTRATION.md),
[`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md),
[`TurnIns/REGISTRATION.md`](TurnIns/REGISTRATION.md),
[`Naming/README.md`](Naming/README.md) (Prioritization naming + bulk rename),
and [`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md)
(Funded Amount lock: env var, Custom API, command button). Those docs assume
the canonical step tables below are authoritative.

---

## Prerequisites

- Plugin Registration Tool (ships with the [Power Platform CLI tools
  download](https://learn.microsoft.com/power-platform/developer/cli/reference/tools)
  or with the legacy `Microsoft.CrmSdk.XrmTooling.PluginRegistrationTool`
  NuGet package).
- A built copy of the assembly:
  ```bash
  cd Plugins && dotnet build -c Release
  # → bin/Release/net462/Checkbook_Plugins.dll
  ```
- A System Administrator (or Customizer) login for the target env.

---

## One-time: register the assembly

If `Checkbook_Plugins.dll` has never been registered in this env:

1. Launch PRT → **Create New Connection** → pick the env → **Login**.
2. **Register → Register New Assembly**.
3. Browse to `Plugins/bin/Release/net462/Checkbook_Plugins.dll`.
4. Step 2 — **Specify the location**: **Database** (default).
5. Step 2 — **Select the plugins** to register: leave all **38** checked.
6. Click **Register Selected Plugins**.

For subsequent code changes, use **Update Assembly** on the existing
`Checkbook_Plugins` row instead of re-registering — that preserves all step
registrations.

---

## Schema additions required (before deploying this build)

Four columns must be added to `book_turnin` in the maker portal before
registering the FundingEvent + Turn-In plugins below. The plugin code references
their schema names directly; the build will succeed without them, but at
runtime the Create / Update messages will fail.

| Column                  | Type                 | Default | Notes                                                                                  |
|-------------------------|----------------------|---------|----------------------------------------------------------------------------------------|
| `book_origin`           | Choice (option set)  | `State` | Values: **State** = `0`, **Sweep** = `1`. Distinguishes Kind A (state-submitted) from Kind B (sweep-created over-allocation tracker). |
| `book_afpamount`        | Decimal (2 decimals) | `0`     | AFP amount that will flow back to A18 on approval. Auto-populated by `TurnInAmountCalculator` for Kind A; written by `GenerateDistributions` for Kind B. |
| `book_allotmentamount`  | Decimal (2 decimals) | `0`     | Allotment amount that will flow back to A18 on approval. Same population sources as above. |
| `book_requiresbeapproval` | Two Options (Yes/No) | `Yes` | Derived flag driving the Turn-In BPF's BE-Approval branch. Kept in sync by `TurnInRequiresBEApprovalRecalc` on item Create/Update/Delete. Default **Yes** so a fresh (item-less) Turn-In starts on the BE path until items say otherwise. |

`book_newamount` keeps its existing schema; its semantic meaning narrows to
"TDP amount being returned (Kind A) or 0 (Kind B)" — no migration needed.

### State Swap schema

State Swap ships two new tables and a small additive change to `book_ledger`.
Full field-by-field spec is in [`../dist/SCHEMA-StateSwap.md`](../dist/SCHEMA-StateSwap.md).
Register the plugin steps below **after** these are created and published.

Required in the maker portal before enabling the State Swap steps:

| Item | Change |
|---|---|
| `book_stateswap` table (new) | Full attribute list in the schema doc §1. |
| `book_swapitem` table (new) | Full attribute list §2. Configure the 1:N from `book_stateswap` with **Share cascade = Cascade All** (§4) so item sharing follows the parent for items that exist when the swap is first shared. Items added *later* are shared per-row by `SwapItemAutoSharePlugin` (Cascade All is point-in-time and does not retroactively cover new children). |
| `book_ledger` (existing) | Add lookup `book_stateswap` → `book_stateswap` (peer of `book_turnin`, `book_realignment`). |
| `book_distributions` (existing) | Add lookup `book_stateswap` → `book_stateswap` (peer of `book_turnin`). Written by `SwapDistributionCreator` on BE approval; the swap-related Distribution views filter on it, and the `book_GenerateDistributions` reconcile treats swap-linked rows as immutable. |
| `book_ledgertype` option set (existing) | Relabel value `2` from **Add** to **Swap** (values stay Realignment=0, Turn-in=1, Swap=2, Cut=3). This corrects a pre-existing constants bug — `LedgerTypeValues` in this build now uses 0/1/2. Historical ledger rows previously written with `book_ledgertype = 100000001` / `100000002` should be backfilled to `0` / `1` if reporting on ledger type matters. |
| Owner teams per state | Names `{StateAbbr} - State Approver` and `{StateAbbr} - State Administrator` (e.g. `AL - State Approver`). One pair per state. `SwapAutoSharePlugin` looks them up by name and shares each swap with both teams. Missing teams are logged and skipped, not fatal. |
| Role privileges | Grant User-level Create/Read/Write/Delete/Append/AppendTo/Share on `book_stateswap` + `book_swapitem` to `Book - State Approver` and `Book - State Administrator`; Org-level Read to `Book - Budget Executor` and `Book - Read Only`; Org-level everything to `Book - Checkbook Administrator`. See schema doc §5.1. |

### FY27 Spend Plan / Itemized Detail FC schema

The Itemized-Detail Fund Center + FY27 spend plan work (source in
`src/ARNGCheckbook`, also mirrored below for maker-portal deployment) adds:

| Item | Change |
|---|---|
| `book_itemizeddetails` (existing) | Add optional lookup `book_fundcenter` → `book_fundcenter`. Blank = state-level FC. Read by the ItemizedDetailsGrid PCF and the FY27 spend plan grid; no plugin requires it. |
| `book_spendplan` (existing) | Add lookup `book_prioritizationfunding` → `book_prioritizationfunding` (FY27 row anchor; **leave `book_prioritization` empty on FY27 rows** — the `book_uniquestatespendplan` alternate key allows only one legacy row per Prio), lookup `book_fundcenter` → `book_fundcenter` (null on per-RF rollup rows), Choice `book_rowtype` (**Planned** = `0`, **Actual** = `1`), decimal twins `book_newoctober` … `book_newseptember` (12 columns, 2 decimals), calculated decimal `book_newspendplantotal` (sum of the 12 twins), and extend the `book_spendplantype` formula to treat PF-anchored rows as "Prioritization". |

Register the spend plan validator only after the `book_spendplan` changes
are published.

> **Retired (Aug 2026): the Itemized-Details FC lock.**
> `PrioritizationItemizedFundCenterDefault` and
> `PrioritizationFundCenterLockGuard` (which forced/locked the Prio FC to the
> state-level FC while active Itemized Details existed) were removed before
> ever being registered — states set the FC on their own Prioritizations;
> only centrally managed Requirements still push their FC onto Prios
> (`PrioritizationFundCenterBackfill` / `RequirementFundCenterCascade`).
> If either plugin was registered in an env from an older build, unregister
> its steps before updating the assembly.

---

## Environment variables required

| Variable                              | Type | Read by                                                  | Notes |
|---------------------------------------|------|----------------------------------------------------------|-------|
| `book_DistributionHoldingFundCenter`  | Text | `GenerateDistributionsPlugin` | See [`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md). The A18 record's GUID. |
| `book_TurnInCreditOPR`                | Text | `TurnInApprovalPlugin` (via `TurnInLOAResolver`)         | See [`TurnIns/REGISTRATION.md`](TurnIns/REGISTRATION.md). Required for FY27+ Turn-Ins. |
| `book_LockManualFundedEdits`          | Yes/No | `PrioritizationFundedAmountLock` + `RequirementFundingFundedAmountLock`; written by `ToggleFundedAmountLockPlugin` | See [`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md). Ships default `false`; toggled via the Admin Center button. Blocks manual **reductions** only — increases stay allowed. |

---

## Custom APIs required

| Custom API                          | Plugin Type                                                     | Notes |
|-------------------------------------|------------------------------------------------------------------|-------|
| `book_GenerateLOAs`                 | `Checkbook.Plugins.LOAs.LOAGenerator`                            | See [`LOAs/REGISTRATION.md`](LOAs/REGISTRATION.md). |
| `book_GenerateDistributions`        | `Checkbook.Plugins.Distributions.GenerateDistributionsPlugin`    | See [`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md). |
| `book_ToggleFundedAmountLock`       | `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin`           | Global, no inputs, output `IsLocked` (Boolean). Full spec in [`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md). |

The Custom API record's **Plugin Type** field auto-wires the handler; no
separate SDK Message Processing Step is required beyond setting that field on
the Custom API.

---

## Steps to register

Each H3 below is one plugin class. Register every row in its table as a
separate SDK Message Processing Step. **Common PRT field values** for every
step unless noted otherwise:

- **Run in User's Context**: `Calling User`
- **Execution Order**: `1` unless the row states a **Rank** — same-rank steps
  on the same message/entity execute in nondeterministic order, so every
  documented Rank is load-bearing
- **Deployment**: `Server Only`
- **Description**: copy the row's *Notes* column

When a row says "**Requires PreImage**", register a pre-image with
**Name** = **Entity Alias** = `PreImage` containing the listed attributes.
Mode is **Synchronous** unless explicitly noted Async.

---

## Validation

### `Checkbook.Plugins.Validation.DeactivationRoleGuard`

Blocks deactivation (`statecode` → Inactive) of any `book_*` record unless the
initiating user holds **Book - State Administrator**,
**Book - Checkbook Administrator**, or **System Administrator** (the platform
role — so the cascade-deactivation flows keep working under a service-account
connection). Automated deactivations pass through:
pipeline depth > 1 (our own plugins, e.g. `TurnInDeactivator`) and Updates
with a surviving parent context (Custom APIs). Platform wrappers
(`SetState`, `SetStateDynamicEntity`, `ExecuteMultiple`,
`ExecuteTransaction`) do **not** count as automated — grid bulk-deactivate
and legacy SetState clients are direct user actions and are still gated.

This is a **global step** — in the PRT leave **Primary Entity** blank
(`none`). Global steps cannot have filtering attributes or images; the plugin
exits immediately unless Target carries `statecode = 1` on a `book_*` table.

| # | Message | Primary entity | Stage          | Mode | Filtering attributes | Notes |
|---|---------|----------------|----------------|------|----------------------|-------|
| 1 | Update  | *(none — global)* | Pre-Validation | Sync | *(n/a on global steps)* | Rank **1**. No images. Fires for every Update org-wide; guards only `book_*` deactivations by non-admin users. |

### `Checkbook.Plugins.Validation.FundingEventValidator`

Enforces (A) no two same-type Funding Events with overlapping date ranges and
(B) Allotment percentage ≤ AFP percentage per `(Fund, PG/SAG)` per date.

| # | Message | Primary entity         | Stage          | Mode | Filtering attributes                                                                 | Notes |
|---|---------|------------------------|----------------|------|--------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_fundingevent`    | Pre-Operation  | Sync | *(none)*                                                                             | Validates own dates + type vs siblings. |
| 2 | Update  | `book_fundingevent`    | Pre-Operation  | Sync | `book_fundingtype, book_startdate, book_enddate, statecode`                          | Re-validates on any range/type change. **Requires PreImage** (`book_name, book_fundingtype, book_startdate, book_enddate, statecode`). |
| 3 | Create  | `book_fundingdetails`  | Pre-Operation  | Sync | *(none)*                                                                             | Validates Allotment ≤ AFP for the new row. |
| 4 | Update  | `book_fundingdetails`  | Pre-Operation  | Sync | `book_distributionpercentage, book_fund, book_pgsag, book_fundingevent, statecode`   | Re-validates on pct / fund / PG change. **Requires PreImage** (`book_fundingevent, book_fund, book_pgsag, book_distributionpercentage, statecode`). |

### `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock`

When the `book_LockManualFundedEdits` env var is `true`, blocks direct
**reductions** of `book_newfundedamounttdp` on `book_prioritization` —
increases and no-op writes are always allowed. A reduction passes only when
the update comes from an authorized parent operation (Turn-In / Realignment /
State Swap approval, `book_GenerateDistributions`, or a roll-up recompute
triggered from `book_prioritizationfunding` / `book_itemizeddetails` — all
detected by walking `context.ParentContext`). Shares its logic with
`RequirementFundingFundedAmountLock` via `FundedAmountLockBase`. Full setup
(env var, Custom API, command button):
[`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md).

| # | Message | Primary entity        | Stage          | Mode | Filtering attributes         | Notes |
|---|---------|-----------------------|----------------|------|------------------------------|-------|
| 1 | Update  | `book_prioritization` | Pre-Operation  | Sync | `book_newfundedamounttdp`    | Rank **10** (runs before the other Pre-Op Update validators). **Requires PreImage** (`book_newfundedamounttdp`) — falls back to a Retrieve if the image is missing. |

### `Checkbook.Plugins.Validation.PrioritizationFundingValidator`

Enforces RF TDP cap + LOA TDP allocation when a Prioritization's
`book_newfundedamounttdp` changes. Sibling sum of FINAL-APPROVED + ACTIVE
Prios under the parent RF must not exceed RF.TDP, and the resulting total
must not exceed the LOA's allocated TDP cap. Validated amounts are NOT
checked by this plugin (an earlier revision fetched them but never validated;
that dead code has been removed — do not re-add `book_validatedamount` to the
filter).

Skips entirely when an ancestor context is an Update on `book_turnin`,
`book_realignments`, or `book_stateswap` (recursive parent walk, same
pattern as `RequirementFundingTDPValidator`). Those orchestrators own their
own pre-op overdraw validation, and their funding deltas create intermediate
states that would otherwise fail the absolute checks here — e.g. a State
Swap reduces debit-side RF TDP only *after* the credit-side Prio update, and
a same-LOA swap item never grows the LOA total. No registration change: the
bypass is code-level, not a step filter.

| # | Message | Primary entity        | Stage          | Mode | Filtering attributes                                                                       | Notes |
|---|---------|-----------------------|----------------|------|----------------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_prioritization` | Pre-Operation  | Sync | *(none)*                                                                                   | Initial validation of a new Prio against its parent RF + LOA. |
| 2 | Update  | `book_prioritization` | Pre-Operation  | Sync | `book_newfundedamounttdp, book_requirementfunding, book_approvalstatus, statecode`         | Re-validates on funded/parent/approval change. **Requires PreImage** (`book_newfundedamounttdp, book_requirementfunding`). Envs registered from an older revision may still carry `book_validatedamount` in the filter — harmless, but remove it on the next registration pass. |

### `Checkbook.Plugins.Validation.PrioritizationFundingGuard`

Pre-op guard for the `book_prioritizationfunding` junction. Enforces both
parents present + same Requirement + same FY + unique `(Prio, RF)` pair + sum
of active junction FundedAmount on the RF ≤ RF.TDP. Autopopulates
`book_name` on Create when blank.

| # | Message | Primary entity                | Stage          | Mode | Filtering attributes                                                                       | Notes |
|---|---------|-------------------------------|----------------|------|--------------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_prioritizationfunding`  | Pre-Operation  | Sync | *(none)*                                                                                   | Validates new junction + autopops name. |
| 2 | Update  | `book_prioritizationfunding`  | Pre-Operation  | Sync | `book_prioritization, book_requirementfunding, book_fundedamount, book_validatedamount`    | Re-validates on amount or parent change. **Requires PreImage** (same four attrs). |

### `Checkbook.Plugins.Validation.RealignmentValidator`

Two-approval (State + BE Decision) gate on Realignment Update. Determines
when each approval is required based on the realignment shape (RF-level vs
Prio-to-Prio, Same Fund/SAG vs Cross-Fund/SAG). Throws on missing approvals.

| # | Message | Primary entity      | Stage          | Mode | Filtering attributes                  | Notes |
|---|---------|---------------------|----------------|------|---------------------------------------|-------|
| 1 | Update  | `book_realignments` | Pre-Operation  | Sync | `book_newstateapproved, book_bedecision` | Triggers only on approval transitions. **Requires PreImage** (`book_newstateapproved, book_bedecision`). |

### `Checkbook.Plugins.Validation.RequirementDetailFundingGuard`

Pre-op guard for the `book_requirementdetailfunding` junction enforcing the
Prio XOR RD-direct-funding invariant at the Requirement level. Also rejects
new Prioritizations on a Requirement that already has active RD-direct
funding.

| # | Message | Primary entity                    | Stage          | Mode | Filtering attributes                                                                              | Notes |
|---|---------|-----------------------------------|----------------|------|---------------------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_requirementdetailfunding`   | Pre-Operation  | Sync | *(none)*                                                                                          | Validates junction parents, XOR, uniqueness, RF.TDP cap; autopops name. |
| 2 | Update  | `book_requirementdetailfunding`   | Pre-Operation  | Sync | `book_requirementdetail, book_requirementfunding, book_fundedamount, book_validatedamount`        | Re-validates on amount or parent change. **Requires PreImage** (same four attrs). |
| 3 | Create  | `book_prioritization`             | Pre-Operation  | Sync | *(none)*                                                                                          | Rank **20** (after `PrioritizationFundCenterBackfill` at 10, before `PrioritizationNameSetter` at 30). Rejects new Prio if its Requirement already has active RD-direct funding. |

### `Checkbook.Plugins.Validation.RequirementFundingFundedAmountLock`

Requirement Funding twin of `PrioritizationFundedAmountLock` (both inherit
`FundedAmountLockBase`). When the `book_LockManualFundedEdits` env var is
`true`, blocks direct **reductions** of `book_newfundedamount` on
`book_requirementfunding` — increases and no-op writes are always allowed.
Authorized ancestors: the four funding tools, `book_GenerateDistributions`,
and roll-up recomputes triggered from `book_prioritization` /
`book_requirementdetailfunding` (so deleting a Prio or an RD funding row
still lowers the RF roll-up under the lock). Full setup:
[`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md).

| # | Message | Primary entity            | Stage          | Mode | Filtering attributes      | Notes |
|---|---------|---------------------------|----------------|------|---------------------------|-------|
| 1 | Update  | `book_requirementfunding` | Pre-Operation  | Sync | `book_newfundedamount`    | Rank **10** (runs before `RequirementFundingTDPValidator` so users get the lock message, not a cap error). **Requires PreImage** (`book_newfundedamount`) — falls back to a Retrieve if the image is missing. |

### `Checkbook.Plugins.Validation.RequirementFundingTDPValidator`

Enforces TDP ≥ 0, FundedAmount ≥ 0, FundedAmount ≤ TDP, and (when TDP changes
or FundedAmount changes on a leaf RF) the LOA TDP allocation cap. Skips the
LOA-allocation check when the update is mid-realignment (detected by walking
`context.ParentContext`).

| # | Message | Primary entity            | Stage          | Mode | Filtering attributes                                                              | Notes |
|---|---------|---------------------------|----------------|------|-----------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_requirementfunding` | Pre-Operation  | Sync | *(none)*                                                                          | Validates new RF against its LOA. |
| 2 | Update  | `book_requirementfunding` | Pre-Operation  | Sync | `book_tdp, book_fundedamount, book_lineofaccounting`                              | Re-validates on TDP / Funded / LOA change. **Requires PreImage** (`book_tdp, book_fundedamount, book_lineofaccounting`). |

### `Checkbook.Plugins.Validation.SpendPlanFY27Validator`

Guards FY27+ spend plan rows — the ones anchored on
`book_prioritizationfunding`; legacy rows (Prio / Requirement / UFR anchored)
pass through untouched. Enforces: (1) a PF-anchored row must not also set
`book_prioritization`; (2) one active row per (PF, Fund Center, Row Type);
(3) active **Planned** rows under a PF may not total more than the PF funded
amount — equality is deliberately NOT required so plans can be entered
incrementally, the grid badge surfaces completeness; (4) month locks — once a
federal FY month has passed its Planned cell is frozen, and Actual cells only
accept values for completed months (FY resolved PF → Prio →
`book_newfiscalyear`; skipped with a trace when FY is unknown).

| # | Message | Primary entity   | Stage          | Mode | Filtering attributes | Notes |
|---|---------|------------------|----------------|------|----------------------|-------|
| 1 | Create  | `book_spendplan` | Pre-Operation  | Sync | *(none)*             | Validates new FY27 rows; legacy creates return immediately. |
| 2 | Update  | `book_spendplan` | Pre-Operation  | Sync | `book_prioritizationfunding, book_fundcenter, book_rowtype, book_prioritization, book_newoctober, book_newnovember, book_newdecember, book_newjanuary, book_newfebruary, book_newmarch, book_newapril, book_newmay, book_newjune, book_newjuly, book_newaugust, book_newseptember` | **Requires PreImage** (same attributes plus `statecode`). |

---

## Realignments

### `Checkbook.Plugins.Realignments.SetSameFundSagFlagPlugin`

Sets `book_samefundandsag` on the realignment header from the selected debit
and credit LOAs, and enforces the funds-availability + chain-consistency
rules that the form's cascading filters describe. Runs on every save so
users can't bypass the form by populating fields bottom-up.

| # | Message | Primary entity      | Stage          | Mode | Filtering attributes | Notes |
|---|---------|---------------------|----------------|------|----------------------|-------|
| 1 | Create  | `book_realignments` | Pre-Operation  | Sync | *(none)*             | Validates chain + amount on initial save; sets SameFundAndSAG flag. |
| 2 | Update  | `book_realignments` | Pre-Operation  | Sync | *(none)*             | Re-validates every save (no filter so an LOA/amount edit can't escape). **Requires PreImage** (full image — the plugin reads many attrs via `GetEffective*`). |

### `Checkbook.Plugins.Realignments.RealignmentProcessor`

Post-op executor that fires on approval/denial. Creates the Ledger
debit/credit pair, applies the RF (and Prio, on Prior→Prior) funding
movements, recalculates touched LOAs, and deactivates the Realignment.

Trigger semantics (hardened Jul 2026 after 4 approvals committed without
processing): the plugin fires when the Update **payload carries a decision
value** (`book_bedecision` / `book_newstateapproved` = Approved or Denied)
**and the pre-image shows the record still active**. Deactivation-on-completion
is the "already processed" marker, so this is idempotent — a stuck approval
(value written while the step was disabled) can be re-driven by any save that
carries the value again, instead of being invisible to a pre-image transition
check. There is **no Depth guard and no nesting guard**: bulk approvals (Excel
Online publish, ExecuteMultiple grid edits) arrive nested and must still
process, and — critically — the real-time Business Rules on this table
(`Realignments - SetStateApproval`, `Realignments - LockSameSAGFundField`,
Mode=1) set fields server-side, which issues a nested `book_realignments`
Update the decision save runs *inside*. An ancestor-walk `IsNestedUpdateOf`
guard silently dropped every approval (trace showed "self re-entry — skipping"
with nothing processed). No self re-entry guard is needed: `FinalizeRealignment`
writes only `statecode`/`statuscode`, and this step is filtered on the decision
attributes, so Finalize cannot re-trigger the processor. The payload-only
decision check ensures only the actual decision write processes.

| # | Message | Primary entity      | Stage           | Mode | Filtering attributes                     | Notes |
|---|---------|---------------------|-----------------|------|------------------------------------------|-------|
| 1 | Update  | `book_realignments` | Post-Operation  | Sync | `book_newstateapproved, book_bedecision` | Fires when a decision value is in the payload and the record is active. **Requires PreImage** (full image — must include `statecode`; reads many attrs via `GetEffective*` and `TryGetPreImage`). |

---

## Items

### `Checkbook.Plugins.Items.ItemizedDetailsSynchronizer`

Sets a Prioritization's `book_fundingmode` from whether the parent Requirement
has `book_requirementdetails`, and cleans up Itemized Details that would
otherwise be orphaned (RD deleted) or stale (Prio re-pointed at a different
Requirement). Itemized Details are **user-selected** via the
`ItemizedDetailsGrid` control's Add Items dialog — this plugin never creates
them.

| # | Message | Primary entity         | Stage          | Mode  | Filtering attributes      | Notes |
|---|---------|------------------------|----------------|-------|---------------------------|-------|
| 1 | Delete  | `book_requirementdetails` | Pre-Operation  | Sync  | *(none)*                  | Wipes children before the parent row goes. **Sync** so failure rolls back the Delete. |
| 2 | Create  | `book_prioritization`     | Post-Operation | Async | *(none)*                  | Sets FundingMode = Itemized when the Requirement has Requirement Details; leaves Direct otherwise. No Itemized Details are created. |
| 3 | Update  | `book_prioritization`     | Post-Operation | Async | `book_requirement, book_requirementfunding` | On re-point to a different effective Requirement — direct `book_requirement` edit (FY27+) or RF swap (legacy) — deletes the now-stale Itemized Details and resets FundingMode (Itemized if the new Requirement has RDs, else Direct). **Requires PreImage** (`book_requirement, book_requirementfunding`). |

> **⚠ Step 3 filter widened (2026-08):** originally filtered on
> `book_requirementfunding` only, so editing the direct `book_requirement`
> lookup on the form (the FY27+ shape) never fired the step and
> `book_fundingmode` went stale. In PRT, add `book_requirement` to both the
> step's filtering attributes **and** its PreImage.

> **Migration note (auto-populate retired, 2026-07):** in PRT, after updating
> `Checkbook_Plugins.dll`:
> 1. **Unregister** the old `Create` step on `book_requirementdetails`
>    (Post-Operation, Async — the RD fan-out).
> 2. **Delete** the `book_ReconcileItemizedDetails` Custom API record and the
>    `Checkbook.Plugins.Items.ItemizedDetailsReconciler` plugin type (the class
>    was removed from the assembly, so the stale type must go before the
>    assembly update will register cleanly). Remove any "Sync Itemized
>    Details" ribbon command that called the API if one was wired up.
> 3. The `book_prioritization` Create/Update steps and the
>    `book_requirementdetails` Delete step keep their existing registrations —
>    only behavior changed.

### `Checkbook.Plugins.Items.PrioritizationItemizedRollup`

Rolls Itemized Detail amounts (Requested / Validated / Funded) up onto the
parent Prioritization. Only writes to Itemized-mode Prioritizations; Direct
mode Prios keep their manually entered funding.

| # | Message | Primary entity          | Stage          | Mode | Filtering attributes | Notes |
|---|---------|-------------------------|----------------|------|----------------------|-------|
| 1 | Create  | `book_itemizeddetails`  | Post-Operation | Sync | *(none)*             | Recalcs the new parent Prio. |
| 2 | Update  | `book_itemizeddetails`  | Post-Operation | Sync | `book_newrequestedamount, book_validatedamount, book_newfundedamounttdp, book_prioritization, statecode` | Recalcs current parent; if Prio reassigned, also old parent. **Requires PreImage** (`book_prioritization`). |
| 3 | Delete  | `book_itemizeddetails`  | Post-Operation | Sync | *(none)*             | Recalcs the (pre-image) parent. **Requires PreImage** (`book_prioritization`). |

### `Checkbook.Plugins.Items.PrioritizationFundCenterBackfill`

On Prioritization Create, if the parent Requirement is centrally managed
(`book_national = 1`), authoritatively sets `Prio.book_fundcenter` to the
Requirement's FC. Users do not pick FC on Prios for centrally managed work.
Resolves the Requirement from the direct `book_requirement` lookup (FY27+
shape) first, then falls back to `RF → Requirement` (legacy shape).

| # | Message | Primary entity        | Stage          | Mode | Filtering attributes | Notes |
|---|---------|-----------------------|----------------|------|----------------------|-------|
| 1 | Create  | `book_prioritization` | Pre-Operation  | Sync | *(none)*             | Rank **10** — MUST run before `PrioritizationNameSetter` (rank 30), which embeds the FC name in `book_name`. See the ordering box below. |

> **⚠ book_prioritization Pre-Op Create ordering.** Four plugins register
> Pre-Operation Sync on `book_prioritization` Create and the order matters:
>
> | Rank | Step | Why this order |
> |------|------|----------------|
> | 1 (default) | `PrioritizationFundingValidator` | Pure validation against parent RF + LOA; reads only Target amounts, so it can safely run first. |
> | 10 | `PrioritizationFundCenterBackfill` | Writes `book_fundcenter` into the Target for centrally managed Requirements. |
> | 20 | `RequirementDetailFundingGuard` (Prio Create step) | Rejects the Prio outright on XOR violation — no point naming a record that will be rejected, but must not run after the name stamp has already paid two retrieves. |
> | 30 | `PrioritizationNameSetter` | Reads `book_fundcenter` from the Target to build `book_name`. If it runs before the backfill (rank 10), centrally managed Prios get a name with a missing/wrong FC segment. |
>
> If ranks were never set in an environment (all default to 1), PRT executes
> same-rank steps in nondeterministic order — fix the ranks, don't rely on
> observed behavior.

### `Checkbook.Plugins.Items.RequirementFundCenterCascade`

When a Requirement's FC or `book_national` flag changes, cascades the new FC
to every active Prioritization linked under the Requirement — directly via
`book_requirement` (FY27+ shape) or via its RFs (legacy shape). Flips from
national → non-national leave existing Prio FCs in place.

| # | Message | Primary entity      | Stage           | Mode | Filtering attributes              | Notes |
|---|---------|---------------------|-----------------|------|-----------------------------------|-------|
| 1 | Update  | `book_requirements` | Post-Operation  | Sync | `book_fundcenter, book_national`  | Cascades to linked Prios. **Requires PreImage** (`book_fundcenter, book_national`). Cascades even to Prios with active Itemized Details — the Itemized-Details FC lock was retired Aug 2026 (see the retirement note in the FY27 schema section). |

---

## Naming

### `Checkbook.Plugins.Naming.PrioritizationNameSetter`

Stamps `book_name` on `book_prioritization` at PreOperation so the
`book_uniqueprioritizationname` alternate key (on `book_name`) catches
duplicates inside the user's transaction. Replaces the async
"Prioritization - Set Name" workflow. Naming convention, rationale, and the
bulk-rename runbook live in [`Naming/README.md`](Naming/README.md).

| # | Message | Primary entity        | Stage         | Mode | Filtering attributes | Notes |
|---|---------|-----------------------|---------------|------|----------------------|-------|
| 1 | Create  | `book_prioritization` | Pre-Operation | Sync | *(none)*             | Rank **30** — MUST run after `PrioritizationFundCenterBackfill` (rank 10); it reads `book_fundcenter` from the Target to build the name. See the ordering box under PrioritizationFundCenterBackfill. |
| 2 | Update  | `book_prioritization` | Pre-Operation | Sync | `book_state, book_requirementfunding, book_requirement, book_statepriority, book_fundcenter, book_newfiscalyear` | Re-stamps on any name-segment change. **Requires PreImage** (same attributes). |

---

## Recalculations

All recalc plugins below register **Post-Operation Sync** and guard
`context.Depth > 1` internally to prevent re-entry from their own nested
updates.

### `Checkbook.Plugins.Recalculations.PrioritizationFundingRollup`

Rolls `book_prioritizationfunding` junction amounts up onto **both** the parent
Prioritization's `book_newfundedamounttdp` + `book_validatedamount` **and** the
parent Requirement Funding's `book_fundedamount` + `book_validatedamount`. The
Prio aggregate + update lives in
`Helpers/PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded`; the
RF leg calls `Helpers/PrioritizationRollupHelper.RecalculateRFFunded` directly
(the Prio update this plugin issues runs at depth+1, where the depth-guarded
`PrioritizationRollupToRequirementFunding` early-returns, so it never fires to
refresh the RF). On re-parent it recalcs both the old and new RF.

| # | Message | Primary entity                | Stage           | Mode | Filtering attributes                                                                | Notes |
|---|---------|-------------------------------|-----------------|------|-------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_prioritizationfunding`  | Post-Operation  | Sync | *(none)*                                                                            | Recalc new parent Prio + new parent RF. |
| 2 | Update  | `book_prioritizationfunding`  | Post-Operation  | Sync | `book_fundedamount, book_validatedamount, book_prioritization, book_requirementfunding, statecode` | Recalc current parent Prio + RF; recalc old parent Prio/RF on re-parent. **Requires PreImage** (`book_fundedamount, book_validatedamount, book_prioritization, book_requirementfunding`). |
| 3 | Delete  | `book_prioritizationfunding`  | Post-Operation  | Sync | *(none)*                                                                            | Recalc pre-image parent Prio + RF. **Requires PreImage** (`book_prioritization, book_requirementfunding`). |

### `Checkbook.Plugins.Recalculations.PrioritizationRollupToRequirementFunding`

Rolls child Prioritization funded/validated totals up onto the parent
Requirement Funding. Depth-guarded; depth-1 actors (e.g.
`RealignmentProcessor`, `TurnInApprovalPlugin`) that need the result after
their own nested Prio updates must call `PrioritizationRollupHelper.RecalculateRFFunded`
directly.

| # | Message | Primary entity        | Stage           | Mode | Filtering attributes                                                                                          | Notes |
|---|---------|-----------------------|-----------------|------|---------------------------------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_prioritization` | Post-Operation  | Sync | *(none)*                                                                                                      | Recalc parent RF. |
| 2 | Update  | `book_prioritization` | Post-Operation  | Sync | `book_newfundedamounttdp, book_validatedamount, book_requirementfunding, statecode`                           | Recalc parent RF. **Requires PreImage** (`book_requirementfunding`). |
| 3 | Delete  | `book_prioritization` | Post-Operation  | Sync | *(none)*                                                                                                      | Recalc pre-image parent RF. **Requires PreImage** (`book_requirementfunding`). |

### `Checkbook.Plugins.Recalculations.RequirementDetailFundingRollup`

Rolls `book_requirementdetailfunding` junction amounts up onto both the
parent Requirement Detail and the parent Requirement Funding.

| # | Message | Primary entity                   | Stage           | Mode | Filtering attributes                                                                                            | Notes |
|---|---------|----------------------------------|-----------------|------|-----------------------------------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_requirementdetailfunding`  | Post-Operation  | Sync | *(none)*                                                                                                        | Recalc new parent RD + parent RF. |
| 2 | Update  | `book_requirementdetailfunding`  | Post-Operation  | Sync | `book_fundedamount, book_validatedamount, book_requirementdetail, book_requirementfunding, statecode`           | Recalc current + previous parents on re-parent. **Requires PreImage** (`book_fundedamount, book_validatedamount, book_requirementdetail, book_requirementfunding`). |
| 3 | Delete  | `book_requirementdetailfunding`  | Post-Operation  | Sync | *(none)*                                                                                                        | Recalc pre-image parents. **Requires PreImage** (`book_requirementdetail, book_requirementfunding`). |

### `Checkbook.Plugins.Recalculations.DecisionRollupRecalculator`

Forces the Funding Track's `book_decisiontotal` roll-up to recalc immediately
(via `CalculateRollupFieldRequest`) and refreshes the associated LOA's
TDP / Remaining.

| # | Message | Primary entity   | Stage           | Mode | Filtering attributes | Notes |
|---|---------|------------------|-----------------|------|----------------------|-------|
| 1 | Create  | `book_decision`  | Post-Operation  | Sync | *(none)*             | New decision affects its FT's roll-up. |
| 2 | Update  | `book_decision`  | Post-Operation  | Sync | `book_amount, book_fundingtrack, statecode` | Recalc both old + new FT on re-parent. **Requires PreImage** (`book_fundingtrack`). |
| 3 | Delete  | `book_decision`  | Post-Operation  | Sync | *(none)*             | Recalc pre-image FT. **Requires PreImage** (`book_fundingtrack`). |

### `Checkbook.Plugins.Recalculations.FundingTrackTDPRecalculator`

Recalculates the LOA's TDP whenever a Funding Track is created/updated/deleted
or its LOA/Resource Amount changes.

| # | Message | Primary entity        | Stage           | Mode | Filtering attributes                                            | Notes |
|---|---------|-----------------------|-----------------|------|-----------------------------------------------------------------|-------|
| 1 | Create  | `book_fundingtrack`   | Post-Operation  | Sync | *(none)*                                                                        | Recalc LOA. |
| 2 | Update  | `book_fundingtrack`   | Post-Operation  | Sync | `book_beginningbalancereadonly, book_lineofaccountingloa, book_newresourceamount, statecode` | Recalc current + old LOA on re-link. **Requires PreImage** (`book_lineofaccountingloa`). |
| 3 | Delete  | `book_fundingtrack`   | Post-Operation  | Sync | *(none)*                                                                        | Recalc pre-image LOA. **Requires PreImage** (`book_lineofaccountingloa`). |

> See [`LOAs/REGISTRATION.md`](LOAs/REGISTRATION.md) for the ordering
> contract with `FundingTrackLOASynchronizer` (the synchronizer runs pre-op,
> this recalc runs post-op — together they let the recalc see both the
> pre-image's old LOA and the synchronizer's new LOA).

> **Filtering-attribute gotcha.** `book_newresourceamount` (Resource Amount) is
> a **Power Fx formula column** (`= Sum(book_beginningbalancereadonly,
> book_newdecisiontotal)`) — it is computed on read, never appears in an Update
> `Target`, and so can **never** fire this step. It is listed for documentation
> only; the real writable triggers are `book_beginningbalancereadonly` and
> `statecode`. Decision-driven amount changes roll up via the separate
> `book_decision` step (see `DecisionRollupRecalculator`), not through this one.

> **Bulk load / import caveat.** Edit-in-Excel and the Import Wizard write each
> row *nested under a data-import job*, so their Funding Track updates run at
> **Depth 2** — where this recalc's `Depth > 1` guard (in `LOATouchPropagator`)
> skips them. A bulk Beginning-Balance load therefore does **not** roll up to
> LOA TDP. Run the **`book_RecalculateLOATDP`** Custom API afterward to
> reconcile (see below). Day-to-day form / app / flow edits run at Depth 1 and
> are unaffected.

### `Checkbook.Plugins.Recalculations.LOATDPReconciler`

Custom API `book_RecalculateLOATDP` — bulk-reconciles LOA TDP by recomputing
each active LOA from scratch (`Σ active-FT book_newresourceamount + Ledger net
− allocated`) via `TDPCalculationHelper.BatchRecalculateLOATDP`. Run it after
the annual bulk Funding Track load (or any bulk change that lands at Depth ≥ 2
and is skipped by `FundingTrackTDPRecalculator`). Invoked directly it runs at
Depth 1; the LOA writes it issues land at Depth 2 where
`FundingLineTDPRemainingUpdater` allows them. The recompute is idempotent, so
partial runs are safe to re-run.

- Unique name: `book_RecalculateLOATDP`
- Binding type: **Global** (unbound).
- Is function: **No**.
- Allowed custom processing step type: **Async + Sync** (run **Async** for
  large scopes to dodge the 2-minute sync-sandbox limit).
- Plugin type: **`Checkbook.Plugins.Recalculations.LOATDPReconciler`** (set after the assembly is registered).
- Request parameters:
  | Name | Type | Optional | Notes |
  |---|---|---|---|
  | `FiscalYear` | Integer | Yes | LOA `book_fiscalyear` option-set value. `0` or omitted = all FYs. |
  | `BatchSize`  | Integer | Yes | Max LOAs to reconcile this invocation. `0` or omitted = every LOA in scope in one shot. When `> 0`, page with `PageNumber` until `HasMore` is false. |
  | `PageNumber` | Integer | Yes | 1-based page for sliced runs; default `1`. Only meaningful with `BatchSize > 0`; keep `BatchSize` constant across the loop. |
- Response properties:
  | Name | Type | Notes |
  |---|---|---|
  | `TotalInScope` | Integer | Active LOAs matching the scope. |
  | `Processed`    | Integer | LOAs reconciled this invocation. |
  | `HasMore`      | Boolean | More LOAs remain beyond this page (BatchSize runs only). |

> No filtering step — this is a Custom API message handler, not an entity step.
> Per-LOA failures are caught, traced, and skipped inside
> `BatchRecalculateLOATDP`; re-run to pick up any that failed.

### `Checkbook.Plugins.Recalculations.LedgerCreateFundingLineUpdater`

On Ledger Create, recalculates the LOA's TDP / Remaining to reflect the new
debit or credit entry.

| # | Message | Primary entity | Stage           | Mode | Filtering attributes | Notes |
|---|---------|----------------|-----------------|------|----------------------|-------|
| 1 | Create  | `book_ledger`  | Post-Operation  | Sync | *(none)*             | Recalcs the LOA referenced on the new Ledger row. |

### `Checkbook.Plugins.Recalculations.FundingLineTDPRemainingUpdater`

Defense-in-depth guard that rejects any direct edit of `book_newtdp` on an
LOA. LOA TDP is strictly derived from `Σ FundingTrack.ResourceAmount + Ledger
net` and maintained by the LOA-touch propagators above; a manual edit would
silently drift until the next propagator run reset it. The form should also
lock `book_newtdp` read-only and field-level security should restrict the
column's write privilege — this plugin is the last line of defense against
WebAPI / Excel / admin edits.

| # | Message | Primary entity      | Stage           | Mode | Filtering attributes | Notes |
|---|---------|---------------------|-----------------|------|----------------------|-------|
| 1 | Update  | `book_fundingline`  | Post-Operation  | Sync | `book_newtdp`        | Throws `InvalidPluginExecutionException` if `book_newtdp` is in the target payload — rolls back the Update transaction. |

### `Checkbook.Plugins.Recalculations.RequirementFundingTDPRemainingUpdater`

When RF TDP / LOA changes (or the RF is created/deleted), recalculates the
LOA's TDP Remaining so the form view doesn't go stale.

| # | Message | Primary entity            | Stage           | Mode | Filtering attributes                       | Notes |
|---|---------|---------------------------|-----------------|------|--------------------------------------------|-------|
| 1 | Create  | `book_requirementfunding` | Post-Operation  | Sync | *(none)*                                   | Recalcs LOA. |
| 2 | Update  | `book_requirementfunding` | Post-Operation  | Sync | `book_tdp, book_lineofaccounting`          | Recalcs LOA on TDP / LOA change. |
| 3 | Delete  | `book_requirementfunding` | Post-Operation  | Sync | *(none)*                                   | Recalcs pre-image LOA. **Requires PreImage** (`book_lineofaccounting`). |

---

## TurnIns

### `Checkbook.Plugins.TurnIns.TurnInAmountCalculator`

Pre-op writer that keeps `book_afpamount` and `book_allotmentamount` in sync
with `book_newamount × current_pct` for **Kind A** Turn-Ins. Skips entirely
when `book_origin = Sweep` — the Generate Distributions sweep owns those
values for Kind B.

| # | Message | Primary entity | Stage         | Mode | Filtering attributes                                               | Notes |
|---|---------|----------------|---------------|------|--------------------------------------------------------------------|-------|
| 1 | Create  | `book_turnin`  | Pre-Operation | Sync | *(none)*                                                           | Initial AFP/Allotment computation. |
| 2 | Update  | `book_turnin`  | Pre-Operation | Sync | `book_newamount, book_fund, book_pg, book_fundcenter, book_origin` | Re-computes on input change. **Requires PreImage** (`book_newamount, book_fund, book_pg, book_fundcenter, book_origin`). |

### `Checkbook.Plugins.TurnIns.TurnInValidator`

Pre-op validation of an in-flight Turn-In approval. Idempotency (no
duplicate ledgers), header math, per-item math, aggregated availability per
source, and approval routing (RF-only items require BE Approval).

Also enforces **role gating** via `UserRoleHelper`: State approval requires
`Book - State Approver`, `Book - State Administrator`, or
`Book - Checkbook Administrator`; BE approval requires `Book - Budget Executor`
or `Book - Checkbook Administrator`. Role names come straight from the
`src/ARNGCheckbook/Roles/*.xml` source of truth — keep in sync if a role is
renamed. The PCF process-bar control mirrors these lists on the UI side.

| # | Message | Primary entity | Stage         | Mode | Filtering attributes                  | Notes |
|---|---------|----------------|---------------|------|---------------------------------------|-------|
| 1 | Update  | `book_turnin`  | Pre-Operation | Sync | `book_stateapproved, book_beapproved` | Fires when the payload carries an approval flag = true (value-based, not transition-based — so a re-save that re-drives a stuck approval is validated + role-gated like the original). **Requires PreImage** (`book_stateapproved, book_beapproved, book_newamount, book_origin, book_afpamount, book_allotmentamount`) — origin + AFP/Allotment amounts are needed to evaluate the sweep-origin AFP-only path. |

### `Checkbook.Plugins.TurnIns.TurnInApprovalPlugin`

Post-op orchestrator that executes the approved Turn-In: resolves credit
LOA, creates Ledger debit/credit pair, creates AFP/Allotment Distributions,
updates Prios and (for RF-only items) RFs, rolls up parent RFs, recalcs
touched LOAs, and deactivates the Turn-In.

Trigger semantics (hardened Jul 2026, same pattern as `RealignmentProcessor`):
fires when the payload carries an approval flag = true **and the pre-image
shows the record still active** (deactivation-on-completion is the "processed"
marker; ledger existence is the durable double-processing barrier). **No
nesting or Depth guard** (removed Aug 2026, preemptively — the ancestor-walk
guard silently dropped every approval on `book_realignments` and
`book_stateswap` once server-side field setters nested the decision save).
The guard protected nothing: the step is filtered on the approval flags, and
both deactivation Updates (step 7's and `TurnInDeactivator`'s) write only
statecode/statuscode, so neither can re-trigger it.

| # | Message | Primary entity | Stage           | Mode | Filtering attributes                  | Notes |
|---|---------|----------------|-----------------|------|---------------------------------------|-------|
| 1 | Update  | `book_turnin`  | Post-Operation  | Sync | `book_stateapproved, book_beapproved` | Fires when an approval flag is in the payload and the record is active; idempotency-guarded via ledger existence. **Requires PreImage** (full image — must include `statecode`; reads `book_stateapproved, book_beapproved, book_newamount, book_fund, book_pg, book_fundcenter, book_origin, book_afpamount, book_allotmentamount`). |

> See [`TurnIns/REGISTRATION.md`](TurnIns/REGISTRATION.md) for the
> `book_TurnInCreditOPR` env var that this plugin reads via
> `TurnInLOAResolver` for FY27+ records.

### `Checkbook.Plugins.TurnIns.TurnInDeactivator`

Post-op handler for the **denied** path: when `book_stateapproved` flips
true → false, deactivates the Turn-In (statecode = Inactive). No financial
side effects — `TurnInValidator`'s idempotency guarantees no ledgers exist
when this path runs. Denial detection stays transition-based (a bare false
can't distinguish "denied" from "never approved"). **No nesting or Depth
guard** (removed Aug 2026, preemptively — same rationale as
`TurnInApprovalPlugin` above): the step is filtered on `book_stateapproved`
and the deactivation Updates write only statecode/statuscode, so self
re-entry is impossible; the transition check + already-inactive check are
the idempotency barrier.

| # | Message | Primary entity | Stage           | Mode | Filtering attributes      | Notes |
|---|---------|----------------|-----------------|------|---------------------------|-------|
| 1 | Update  | `book_turnin`  | Post-Operation  | Sync | `book_stateapproved`      | Only acts on true → false transitions. **Requires PreImage** (`book_stateapproved, statecode`). |

### `Checkbook.Plugins.TurnIns.TurnInRequiresBEApprovalRecalc`

Keeps `book_turnin.book_requiresbeapproval` in sync as child Turn-In Items
change. Rule: BE Approval is required when the Turn-In has zero active items
(AFP-only path) or any active item lacks a Prioritization (RF-only item). The
flag is what the Turn-In BPF branches on to route the BE Approval stage;
`TurnInValidator` still enforces the same rule at approval time.

Cross-entity writer (writes `book_turnin`, triggered by `book_turninitems`), so
it does not recurse with the other Turn-In steps. The plugin no-ops the Update
when the flag already matches to avoid noise on the Turn-In sync stack.

| # | Message | Primary entity      | Stage           | Mode | Filtering attributes                          | Notes |
|---|---------|---------------------|-----------------|------|-----------------------------------------------|-------|
| 1 | Create  | `book_turninitems`  | Post-Operation  | Sync | *(none)*                                      | Recalc parent Turn-In. |
| 2 | Update  | `book_turninitems`  | Post-Operation  | Sync | `book_turnin, book_prioritization, statecode` | Recalc parent(s) — also the old parent on reparent. **Requires PreImage** (`book_turnin, book_prioritization, statecode`). |
| 3 | Delete  | `book_turninitems`  | Post-Operation  | Sync | *(none)*                                      | Recalc parent Turn-In. **Requires PreImage** (`book_turnin`). |

---

## State Swaps

The State Swap flow moves funding between two states via paired debit/credit
Prioritizations. Six plugin classes cover derived-fields, roll-up, validation,
auto-sharing, BE-approval orchestration, and denial reset. Design and data-model
detail is in [`../dist/SCHEMA-StateSwap.md`](../dist/SCHEMA-StateSwap.md).

### `Checkbook.Plugins.StateSwaps.SwapItemDerivedFieldsPlugin`

Pre-op writer on `book_swapitem`. Denormalizes `book_fund`, `book_pg`, and
`book_debitstate` from the debit Prio's LOA + State onto the item. Also
enforces the per-row invariants (both Prios share a Fund + PG; the two Prios
belong to distinct states matching the parent's StateA + StateB; amount > 0).

| # | Message | Primary entity   | Stage         | Mode | Filtering attributes                                                                                          | Notes |
|---|---------|------------------|---------------|------|---------------------------------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_swapitem`  | Pre-Operation | Sync | *(none)*                                                                                                      | Initial derived-field write + invariant enforcement. |
| 2 | Update  | `book_swapitem`  | Pre-Operation | Sync | `book_debitprioritization, book_creditprioritization, book_stateswap, book_newamount`                          | Re-derive on any input change. **Requires PreImage** (`book_debitprioritization, book_creditprioritization, book_stateswap, book_newamount`). |

### `Checkbook.Plugins.StateSwaps.SwapRollupPlugin`

Post-op cross-entity writer that keeps `book_stateswap.book_totalsentbya`,
`book_totalsentbyb`, and `book_isbalanced` in sync as child items change.
Handles reparent (recomputes both old and new parent on Update).

| # | Message | Primary entity  | Stage           | Mode | Filtering attributes                                             | Notes |
|---|---------|-----------------|-----------------|------|------------------------------------------------------------------|-------|
| 1 | Create  | `book_swapitem` | Post-Operation  | Sync | *(none)*                                                         | Recalc parent totals + isbalanced. |
| 2 | Update  | `book_swapitem` | Post-Operation  | Sync | `book_stateswap, book_newamount, book_debitstate, statecode`     | Recalc parent(s) on reparent / amount / activation change. **Requires PreImage** (`book_stateswap, book_newamount, book_debitstate, statecode`). |
| 3 | Delete  | `book_swapitem` | Post-Operation  | Sync | *(none)*                                                         | Recalc former parent. **Requires PreImage** (`book_stateswap`). |

### `Checkbook.Plugins.StateSwaps.SwapValidator`

Pre-op gate on `book_stateswap` approvals / denials. Approval detection is
value-based (fires when the payload carries an approval flag = true, not
only on false → true) so a re-save that re-drives a stuck approval is
validated and role-gated like the original; denial detection stays
transition-based. Enforces
idempotency (no re-processing if ledgers exist), role gating with
**per-state BU scoping** via `StateScopeHelper` (a State A Approver in the
wrong BU cannot approve the State A side), at-least-one-active-item
(recomputed live from active items — the stored totals are not trusted;
**one-sided swaps are allowed**, there is no both-sides-contribute check
since Aug 2026), overdraw per debit Prio, and the "BE requires both state
approvals" prereq. Denial transitions skip completeness / overdraw /
BE-prereq checks so an incomplete swap can still be denied.

After validation passes, the validator **stamps the audit fields** for each
approval flag transitioning false → true in the Update:
`book_state[a|b]approvedby/on`, `book_beapprovedby/on` = initiating user +
UtcNow (pre-op target mutation, so the stamp commits with the flag; no extra
registration needed — the existing step filter already covers the flags).
`SwapDenialPlugin` clears the stamps on denial.

Role checks map:
- State A / State B approval: `Book - State Approver` or `Book - State Administrator` **and** user BU matches that state's owning BU. `Book - Checkbook Administrator` bypasses the BU scope.
- BE approval: `Book - Budget Executor` or `Book - Checkbook Administrator`.
- Denial: any of the four approver roles.

| # | Message | Primary entity   | Stage         | Mode | Filtering attributes                                                                | Notes |
|---|---------|------------------|---------------|------|--------------------------------------------------------------------------------------|-------|
| 1 | Update  | `book_stateswap` | Pre-Operation | Sync | `book_stateaapproved, book_statebapproved, book_beapproved, book_denied`             | Fires when an approval flag is in the payload (value-based) or on a denial transition. **Requires PreImage** (`book_stateaapproved, book_statebapproved, book_beapproved, book_denied, book_statea, book_stateb`). |

### `Checkbook.Plugins.StateSwaps.SwapAutoSharePlugin`

Post-op sharing writer. On Create, shares the swap with StateA + StateB's
`{Abbr} - State Approver` and `{Abbr} - State Administrator` owner-teams
(4 teams). On Update, revokes access from an old state's teams and grants
to the new state's teams when `book_statea` or `book_stateb` changes, and
— on any user-initiated save — runs a **backfill sweep** that re-shares
every child item with the current states (repairs items that predate
per-item sharing or were added after the parent's point-in-time cascade;
nested / orchestrated updates skip the sweep). Missing teams are logged and
skipped so environment misconfiguration does not block record creation.

Because the sweep must fire on a plain re-save, the Update step is
registered with **no filtering attributes** (fires on any update); the
internal same-value guard keeps the state revoke/grant a no-op when states
did not change.

| # | Message | Primary entity   | Stage           | Mode | Filtering attributes                | Notes |
|---|---------|------------------|-----------------|------|-------------------------------------|-------|
| 1 | Create  | `book_stateswap` | Post-Operation  | Sync | *(none)*                            | Initial share to StateA + StateB teams. |
| 2 | Update  | `book_stateswap` | Post-Operation  | Sync | *(none)*                            | Rebalance shares on a state change + backfill-sweep child items on any user save. **Requires PreImage** (`book_statea, book_stateb`). |

### `Checkbook.Plugins.StateSwaps.SwapItemAutoSharePlugin`

Post-op sharing writer on the child rows. On Create, reads the parent swap's
`book_statea` + `book_stateb` and shares the new item with all four
`{Abbr} - State Approver` / `{Abbr} - State Administrator` owner-teams.
Closes the cascade gap: the parent 1:N's Share = Cascade All only shares child
rows that exist when the parent is shared, so items a state adds *after* the
swap was first shared (e.g. the crediting state's leg) would otherwise stay
invisible to the counterparty under User-scope Read. Missing teams are logged
and skipped. Runs as the calling user, so the swap drafter's role needs
User-level **Share** on `book_swapitem`.

| # | Message | Primary entity  | Stage           | Mode | Filtering attributes | Notes |
|---|---------|-----------------|-----------------|------|----------------------|-------|
| 1 | Create  | `book_swapitem` | Post-Operation  | Sync | *(none)*             | Share the new item with StateA + StateB teams. |

### `Checkbook.Plugins.StateSwaps.SwapApprovalPlugin`

Post-op orchestrator for a BE-approved State Swap. Fires when the payload
carries `book_beapproved` = true **and the pre-image shows the swap still
active** (hardened Jul 2026, same pattern as `RealignmentProcessor`:
deactivation-on-completion is the "processed" marker, ledger existence is
the durable double-processing barrier). **No nesting or Depth guard**
(Aug 2026, same fix as `RealignmentProcessor`): server-side field setters
on `book_stateswap` can nest the BE-approval save under another
`book_stateswap` Update, and the former `IsNestedUpdateOf` guard silently
dropped every approval (trace showed only "self re-entry — skipping"; no
ledgers/distributions, swap never deactivated). The guard protected
nothing: the step is filtered on `book_beapproved`, and neither the
self-deactivate (statecode/statuscode only) nor `SwapRollupPlugin`'s
parent writes (totals + isbalanced) can re-trigger it. Resolves each item's debit/credit
LOA + parent RF via `SwapLOAResolver`, writes ledger pairs (skipping
same-LOA net-zero items), recalcs touched LOA TDPs, applies net Prio
`FundedAmount` and parent RF `TDP` deltas via `SwapPrioritizationUpdater`,
recalcs LOA TDPs again as a catch-all, creates AFP/Allotment Distributions
via `SwapDistributionCreator`, and deactivates the swap (statecode
Inactive, statuscode 2 = BE Approved).

**Swap Distributions** (added Jul 2026): a swap is modeled as both states
performing a turn-in to A18, with A18 then distributing the agreed amounts
back out. Items are grouped by (giving state FC, receiving state FC, Fund,
PG) — state-level FCs resolved by walking each Prio's FC up to the child of
the holding FC — and each group emits, per funding type with an active
Funding Event, TWO debit/credit pairs: giving state → A18 ("State Swap
Turn-In") and A18 → receiving state ("State Swap Distribution"), amount =
Σ TDP × FundingDetails percentage. All rows carry the `book_stateswap`
lookup (the swap-related Distribution views key off it) and are treated as
immutable by the `book_GenerateDistributions` reconcile. Prerequisites: the
`book_stateswap` lookup on `book_distributions` (maker portal) and the
`book_DistributionHoldingFundCenter` env var.

When a credit pushes a Prio's `FundedAmount` above its `RequestedAmount`,
`SwapPrioritizationUpdater` raises `RequestedAmount` to match **in the same
Update** — the entity-scoped "Requested vs Funded" business rule on
Prioritization has no ancestor-context bypass and would otherwise block the
swap (same pattern as `RealignmentProcessor`).

The debit side has the mirror-image trap on RF: the "Req Funding - Funded
vs TDP" real-time business rule (entity-scoped, no bypass possible) rejects
any RF write where `FundedAmount` > `TDP`, and the RF's rollup
`FundedAmount` stays stale-high until `SwapPrioritizationUpdater` recomputes
it (the rollup plugins skip at depth > 1). So the updater writes each debit
RF's reduced `TDP` **and** its rolled-down `FundedAmount`/`ValidatedAmount`
in the same Update (via `PrioritizationRollupHelper.BuildRFFundedUpdate`),
mirroring `RealignmentProcessor.ApplyDebitToRF`. A TDP-only debit write
would be rejected by the business rule.

Piggybacks on the `IsTriggeredByStateSwap` bypass added to
`RequirementFundingTDPValidator` — RF intermediate states during Prio /
RF delta application would otherwise trip that plugin's TDP-vs-Funded
check (the bypass covers the plugin only, hence the same-Update fold above
for the business rule).

| # | Message | Primary entity   | Stage           | Mode | Filtering attributes | Notes |
|---|---------|------------------|-----------------|------|----------------------|-------|
| 1 | Update  | `book_stateswap` | Post-Operation  | Sync | `book_beapproved`    | Fires when `book_beapproved` = true is in the payload and the swap is active; idempotency-guarded. **Requires PreImage** (full image — must include `statecode`; reads `book_beapproved, book_stateaapproved, book_statebapproved, book_statea, book_stateb, book_newfiscalyear`). |

### `Checkbook.Plugins.StateSwaps.SwapDenialPlugin`

Pre-op denial-lifecycle writer. Three cases on the same Update, all for
user-initiated updates only:

- **A. Denial transition** (`book_denied` false → true): clears all three approval flags + their by/on lookups; preserves `book_denialreason` as history.
- **B. Next save after denial** (`preImage.book_denied = true` + no denial change this update): clears `book_denied` so the swap leaves the denied state.
- **C. Resubmission approval** (state A or state B false → true + `preImage.book_denialreason` had a value): clears `book_denialreason`.

"User-initiated" is detected wrapper-aware (same pattern as
`DeactivationRoleGuard`): bulk wrappers (ExecuteMultiple / Excel Online /
SetState) walk through and count as user-initiated, while any other ancestor
context (e.g. `SwapRollupPlugin`'s nested parent Update, the orchestrator's
self-deactivate) is automated and skipped — so a rollup can't clear
`book_denied` on the drafter's behalf, but a bulk denial still works.

| # | Message | Primary entity   | Stage         | Mode | Filtering attributes                                                     | Notes |
|---|---------|------------------|---------------|------|--------------------------------------------------------------------------|-------|
| 1 | Update  | `book_stateswap` | Pre-Operation | Sync | `book_denied, book_stateaapproved, book_statebapproved`                  | Rank **10** — runs before `SwapValidator` (rank 20). **Requires PreImage** (`book_denied, book_denialreason, book_stateaapproved, book_statebapproved, book_beapproved`). |

---

## LOAs

> Full prerequisites (alternate key, Custom API definition, smoke tests) live
> in [`LOAs/REGISTRATION.md`](LOAs/REGISTRATION.md). The step rows below are
> the canonical registration tables; treat the subfolder doc as the
> "everything else" reference.

### `Checkbook.Plugins.LOAs.LOAGenerator`

Custom API handler `book_GenerateLOAs`. Creates missing LOAs for orphan
Funding Tracks, links FTs to their canonical LOAs, then drives
`TDPCalculationHelper.BatchRecalculateLOATDP` for every touched LOA. Wired
automatically via the Custom API's **Plugin Type** field — no separate Step
registration required beyond that.

### `Checkbook.Plugins.LOAs.LOANameSetter`

Pre-op writer that builds the canonical LOA name from its grain attributes
on Create, and re-builds it on Update when a grain field changes. Used to
enforce the `book_LOAUniqueName` alternate key.

FY27+ names use the GFEBS-aligned format
`{OPR}-{Fund}-{PG or SAG}-{FundedProgram}-{Category}` (Funded Program read
from the Fund's `book_newfundedprogram` lookup, Category from the LOA's
`book_category` choice); FY26 names keep `{OPR}-{Fund}-{BOC}-{DT}-{PG or SAG}-{MDEP}`.

| # | Message | Primary entity      | Stage          | Mode | Filtering attributes | Notes |
|---|---------|---------------------|----------------|------|----------------------|-------|
| 1 | Create  | `book_fundingline`  | Pre-Operation  | Sync | *(none)*             | Sets `book_name` + FY on every new LOA. |
| 2 | Update  | `book_fundingline`  | Pre-Operation  | Sync | `book_disbursingofficial, book_fund, book_newboc, book_newdollartype, book_pg, book_sag, book_mdep, book_category` | Re-names on any grain change so direct LOA edits can't drift from the canonical format (the `book_name` alternate key rejects a rename into a duplicate). **Requires PreImage** (`book_disbursingofficial, book_fund, book_newboc, book_newdollartype, book_pg, book_sag, book_mdep, book_category, book_name, book_fiscalyear`). |

### `Checkbook.Plugins.LOAs.FundingTrackLOASynchronizer`

Pre-op synchronizer that re-links a Funding Track to a different (or new)
LOA when any grain attribute changes. Runs at the same depth as the post-op
`FundingTrackTDPRecalculator` so the recalc sees both old + new LOA.

| # | Message | Primary entity        | Stage          | Mode | Filtering attributes                                                                                             | Notes |
|---|---------|-----------------------|----------------|------|--------------------------------------------------------------------------------------------------------------------|-------|
| 1 | Update  | `book_fundingtrack`   | Pre-Operation  | Sync | `book_disbursingofficial, book_fund, book_boc, book_dollartype, book_pg, book_sag, book_mdep, book_category`   | Re-links to canonical LOA on grain change. **Requires PreImage** (`book_disbursingofficial, book_fund, book_boc, book_dollartype, book_pg, book_sag, book_mdep, book_category, book_ape, book_lineofaccountingloa, owningbusinessunit`). |

---

## Funds

### `Checkbook.Plugins.Funds.FundKeySetter`

Pre-op writer that composes `book_fundkey` — the display string that makes
duplicated Fund names distinguishable in lookups. Replaces the retired
`Fund-CreateKey` XAML workflow (deactivate it before registering this step;
the two would race on the same field).

Format: FY26 and earlier `{Name}-{BOC}-{DollarType}` (identical to the XAML
output); FY27+ `{Name}-{FundedProgram}`.

| # | Message | Primary entity | Stage          | Mode | Filtering attributes                                                       | Notes |
|---|---------|----------------|----------------|------|-----------------------------------------------------------------------------|-------|
| 1 | Create  | `book_fund`    | Pre-Operation  | Sync | *(none)*                                                                    | Sets `book_fundkey` on every new Fund. |
| 2 | Update  | `book_fund`    | Pre-Operation  | Sync | `book_name, book_boc, book_dollartypefundedprogram, book_newfundedprogram` | Recomposes on key-field change. **Requires PreImage** (`book_name, book_boc, book_dollartypefundedprogram, book_newfundedprogram`). |

---

## Distributions

> Full prerequisites (env var, Custom API definition, plugin algorithm, smoke
> tests) live in [`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md).

### `Checkbook.Plugins.Distributions.GenerateDistributionsPlugin`

Custom API handler `book_GenerateDistributions`. Amend-in-place reconcile
(reworked Jul 2026 — the deactivate-all-and-recreate Phase 1 is retired):
Phases 2 + 3 reconcile Prio + Requirement buckets against their target
`funded × pct`, updating each destination's PENDING credit (no entry
document number) in place, creating it when missing, and deactivating it
when no longer needed; Phase 4 cleans up pending rows whose bucket vanished
and re-syncs the consolidated holding-FC debits. GFEBS-entered, manual, and
Turn-In / State Swap–linked rows are never modified. Overage Sweep Turn-Ins
decay per type; when both AFP and Allotment amounts reach 0 the spent
tracker is **deleted** (Aug 2026 — deactivated zero-amount rows accumulated
as clutter). No role grants Delete on `book_turnin`; the delete relies on
plugins running under the sysadmin super user. Wired via the Custom API's
**Plugin Type** field — no separate Step registration required beyond that.

**Runs Sync** (Allowed custom processing step type: Sync only). The plugin
self-budgets to ~105s of the 120s sandbox ceiling and returns a `NextToken`
when it runs out; the caller (the `book_generateDistributions` web resource
pump) re-invokes with the token until it comes back empty. Do NOT register
it Async — that suppresses the outputs the pump depends on. See
[`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md) for the
migration note if an env still has an older Async registration.

---

## Admin

### `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin`

Custom API handler `book_ToggleFundedAmountLock`. Flips the
`book_LockManualFundedEdits` env-var value record (read by both
`PrioritizationFundedAmountLock` and `RequirementFundingFundedAmountLock`)
and returns the new state as `IsLocked`. Role-gated in code to
`Book - Checkbook Administrator`
(direct or team-derived). Wired via the Custom API's **Plugin Type** field —
no separate Step registration. Backs the Admin Center "Lock/Unlock Funding"
command button; full setup in
[`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md).

---

## Per-entity pipeline maps

The step tables above are grouped by plugin; this section is the inverse view
for the busiest entities — every step that fires for a given message, in
execution order (stage, then rank, then message order). Use it before adding
a step or changing a rank: the ordering constraints live here.
**Keep this section in sync when you add/move a step.**

> **Global step not shown below:** `DeactivationRoleGuard` is registered on
> Update with no primary entity, so it runs at Pre-Validation before every
> per-entity Update pipeline in these maps (no-op unless the Update sets
> `statecode` to Inactive on a `book_*` table).

### `book_prioritization`

**Create** (in order):

| Order | Stage | Mode | Step | Ordering constraint |
|---|---|---|---|---|
| 1 | Pre-Op (rank 1) | Sync | `PrioritizationFundingValidator` | None — reads only Target amounts. |
| 2 | Pre-Op (rank 10) | Sync | `PrioritizationFundCenterBackfill` | Must precede NameSetter (writes `book_fundcenter` into Target). |
| 3 | Pre-Op (rank 20) | Sync | `RequirementDetailFundingGuard` | XOR guard; before NameSetter so rejected Prios skip the naming retrieves. |
| 4 | Pre-Op (rank 30) | Sync | `PrioritizationNameSetter` | Reads `book_fundcenter` from Target — MUST run after the backfill. |
| 5 | Post-Op | Sync | `PrioritizationRollupToRequirementFunding` | Rolls new Prio into parent RF totals. |
| 6 | Post-Op | **Async** | `ItemizedDetailsSynchronizer` | Sets FundingMode from the Requirement's RDs (no seeding — Itemized Details are user-selected); async, so it lands after the transaction. |

**Update** (in order):

| Order | Stage | Mode | Step | Filter / constraint |
|---|---|---|---|---|
| 1 | Pre-Op (rank 10) | Sync | `PrioritizationFundedAmountLock` | `book_newfundedamounttdp` — reduction lock runs before other validators so users get the lock message, not a cap error. Increases pass through. |
| 2 | Pre-Op | Sync | `PrioritizationFundingValidator` | `book_newfundedamounttdp, book_requirementfunding, book_approvalstatus, statecode` |
| 3 | Pre-Op | Sync | `PrioritizationNameSetter` | `book_state, book_requirementfunding, book_requirement, book_statepriority, book_fundcenter, book_newfiscalyear` |
| 4 | Post-Op | Sync | `PrioritizationRollupToRequirementFunding` | `book_newfundedamounttdp, book_validatedamount, book_requirementfunding, statecode` |
| 5 | Post-Op | **Async** | `ItemizedDetailsSynchronizer` | `book_requirement, book_requirementfunding` (re-point to a different Requirement deletes stale details + resets FundingMode) |

**Delete**: Post-Op Sync `PrioritizationRollupToRequirementFunding` (recalcs the pre-image parent RF).

Also touches this entity from other entities: `RequirementFundCenterCascade`
(FC cascade from `book_requirements`), `PrioritizationItemizedRollup` /
`PrioritizationFundingRollup` (rollups from child tables), Turn-In / Swap /
Realignment updaters (funding moves), `book_GenerateDistributions` (reads).

### `book_turnin` — Update

| Order | Stage | Mode | Step | Filter |
|---|---|---|---|---|
| 1 | Pre-Op | Sync | `TurnInAmountCalculator` | `book_newamount, book_fund, book_pg, book_fundcenter, …` |
| 2 | Pre-Op | Sync | `TurnInValidator` | `book_stateapproved, book_beapproved` — role gate + idempotency + availability. |
| 3 | Post-Op | Sync | `TurnInApprovalPlugin` | `book_stateapproved, book_beapproved` — writes ledgers/distributions. |
| 4 | Post-Op | Sync | `TurnInDeactivator` | `book_stateapproved` — acts only on true → false. |

### `book_stateswap` — Update

| Order | Stage | Mode | Step | Filter |
|---|---|---|---|---|
| 1 | Pre-Op (rank 10) | Sync | `SwapDenialPlugin` | `book_denied, book_stateaapproved, book_statebapproved` — MUST precede SwapValidator. |
| 2 | Pre-Op (rank 20) | Sync | `SwapValidator` | `book_stateaapproved, book_statebapproved, book_beapproved, book_denied` |
| 3 | Post-Op | Sync | `SwapApprovalPlugin` | `book_beapproved` — writes ledgers. |
| 4 | Post-Op | Sync | `SwapAutoSharePlugin` | *(no filter)* — re-shares with state teams on state change; backfill-sweeps child items on any user save. |

---

## Verification checklist

After registration, in PRT click into the `(Assembly) Checkbook_Plugins`
node and confirm every row below is present and enabled. The fastest way is
to sort the right pane by **Message** then by **Primary Entity**.

### Validation
- [ ] `Checkbook.Plugins.Validation.FundingEventValidator`
  - [ ] Create + Update of `book_fundingevent` — Pre-Op Sync, Update has PreImage
  - [ ] Create + Update of `book_fundingdetails` — Pre-Op Sync, Update has PreImage
- [ ] `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock`
  - [ ] Update of `book_prioritization` — Pre-Op Sync, **Rank 10**, PreImage, filter `book_newfundedamounttdp`
- [ ] `Checkbook.Plugins.Validation.PrioritizationFundingValidator`
  - [ ] Create + Update of `book_prioritization` — Pre-Op Sync, Update has PreImage
- [ ] `Checkbook.Plugins.Validation.PrioritizationFundingGuard`
  - [ ] Create + Update of `book_prioritizationfunding` — Pre-Op Sync, Update has PreImage
- [ ] `Checkbook.Plugins.Validation.RealignmentValidator`
  - [ ] Update of `book_realignments` — Pre-Op Sync, PreImage
- [ ] `Checkbook.Plugins.Validation.RequirementDetailFundingGuard`
  - [ ] Create + Update of `book_requirementdetailfunding` — Pre-Op Sync, Update has PreImage
  - [ ] Create of `book_prioritization` — Pre-Op Sync, **Rank 20** (after `PrioritizationFundCenterBackfill` at 10, before `PrioritizationNameSetter` at 30)
- [ ] `Checkbook.Plugins.Validation.RequirementFundingFundedAmountLock`
  - [ ] Update of `book_requirementfunding` — Pre-Op Sync, **Rank 10**, PreImage, filter `book_newfundedamount`
- [ ] `Checkbook.Plugins.Validation.RequirementFundingTDPValidator`
  - [ ] Create + Update of `book_requirementfunding` — Pre-Op Sync, Update has PreImage

### Realignments
- [ ] `Checkbook.Plugins.Realignments.SetSameFundSagFlagPlugin`
  - [ ] Create + Update of `book_realignments` — Pre-Op Sync, Update has PreImage
- [ ] `Checkbook.Plugins.Realignments.RealignmentProcessor`
  - [ ] Update of `book_realignments` — Post-Op Sync, PreImage, filter `book_newstateapproved, book_bedecision`

### Items
- [ ] `Checkbook.Plugins.Items.ItemizedDetailsSynchronizer`
  - [ ] Delete of `book_requirementdetails` — Pre-Op, Sync
  - [ ] Create of `book_prioritization` — Post-Op, Async
  - [ ] Update of `book_prioritization` — Post-Op, Async, filter `book_requirement, book_requirementfunding`, PreImage `book_requirement, book_requirementfunding` (filter widened 2026-08 — see the step-3 note in the Items section)
  - [ ] **No** Create step on `book_requirementdetails` and **no** `book_ReconcileItemizedDetails` Custom API remain (retired 2026-07 — see the migration note in the Items section)
- [ ] `Checkbook.Plugins.Items.PrioritizationItemizedRollup`
  - [ ] Create / Update / Delete of `book_itemizeddetails` — Post-Op Sync; Update + Delete have PreImage
- [ ] `Checkbook.Plugins.Items.PrioritizationFundCenterBackfill`
  - [ ] Create of `book_prioritization` — Pre-Op Sync, **Rank 10** (before `RequirementDetailFundingGuard` at 20 and `PrioritizationNameSetter` at 30)
- [ ] `Checkbook.Plugins.Naming.PrioritizationNameSetter`
  - [ ] Create of `book_prioritization` — Pre-Op Sync, **Rank 30** (after backfill + guard)
  - [ ] Update of `book_prioritization` — Pre-Op Sync, PreImage, filter `book_state, book_requirementfunding, book_requirement, book_statepriority, book_fundcenter, book_newfiscalyear`
- [ ] `Checkbook.Plugins.Items.RequirementFundCenterCascade`
  - [ ] Update of `book_requirements` — Post-Op Sync, filter `book_fundcenter, book_national`, PreImage

### Recalculations
- [ ] `Checkbook.Plugins.Recalculations.PrioritizationFundingRollup`
  - [ ] Create / Update / Delete of `book_prioritizationfunding` — Post-Op Sync; Update + Delete PreImage include `book_requirementfunding` (rolls up to both parent Prio and parent RF)
- [ ] `Checkbook.Plugins.Recalculations.PrioritizationRollupToRequirementFunding`
  - [ ] Create / Update / Delete of `book_prioritization` — Post-Op Sync; Update + Delete have PreImage
- [ ] `Checkbook.Plugins.Recalculations.RequirementDetailFundingRollup`
  - [ ] Create / Update / Delete of `book_requirementdetailfunding` — Post-Op Sync; Update + Delete have PreImage
- [ ] `Checkbook.Plugins.Recalculations.DecisionRollupRecalculator`
  - [ ] Create / Update / Delete of `book_decision` — Post-Op Sync; Update + Delete have PreImage
- [ ] `Checkbook.Plugins.Recalculations.FundingTrackTDPRecalculator`
  - [ ] Create / Update / Delete of `book_fundingtrack` — Post-Op Sync; Update + Delete have PreImage
- [ ] `Checkbook.Plugins.Recalculations.LedgerCreateFundingLineUpdater`
  - [ ] Create of `book_ledger` — Post-Op Sync
- [ ] `Checkbook.Plugins.Recalculations.FundingLineTDPRemainingUpdater`
  - [ ] Update of `book_fundingline` — Post-Op Sync, filter `book_newtdp`
- [ ] `Checkbook.Plugins.Recalculations.RequirementFundingTDPRemainingUpdater`
  - [ ] Create / Update / Delete of `book_requirementfunding` — Post-Op Sync; Delete has PreImage

### TurnIns
- [ ] `Checkbook.Plugins.TurnIns.TurnInAmountCalculator`
  - [ ] Create + Update of `book_turnin` — Pre-Op Sync, Update has PreImage
- [ ] `Checkbook.Plugins.TurnIns.TurnInValidator`
  - [ ] Update of `book_turnin` — Pre-Op Sync, PreImage, filter `book_stateapproved, book_beapproved`
- [ ] `Checkbook.Plugins.TurnIns.TurnInApprovalPlugin`
  - [ ] Update of `book_turnin` — Post-Op Sync, PreImage, filter `book_stateapproved, book_beapproved`
- [ ] `Checkbook.Plugins.TurnIns.TurnInDeactivator`
  - [ ] Update of `book_turnin` — Post-Op Sync, PreImage, filter `book_stateapproved`
- [ ] `Checkbook.Plugins.TurnIns.TurnInRequiresBEApprovalRecalc`
  - [ ] Create of `book_turninitems` — Post-Op Sync
  - [ ] Update of `book_turninitems` — Post-Op Sync, PreImage, filter `book_turnin, book_prioritization, statecode`
  - [ ] Delete of `book_turninitems` — Post-Op Sync, PreImage

### State Swaps
- [ ] `Checkbook.Plugins.StateSwaps.SwapItemDerivedFieldsPlugin`
  - [ ] Create of `book_swapitem` — Pre-Op Sync
  - [ ] Update of `book_swapitem` — Pre-Op Sync, PreImage, filter `book_debitprioritization, book_creditprioritization, book_stateswap, book_newamount`
- [ ] `Checkbook.Plugins.StateSwaps.SwapRollupPlugin`
  - [ ] Create of `book_swapitem` — Post-Op Sync
  - [ ] Update of `book_swapitem` — Post-Op Sync, PreImage, filter `book_stateswap, book_newamount, book_debitstate, statecode`
  - [ ] Delete of `book_swapitem` — Post-Op Sync, PreImage
- [ ] `Checkbook.Plugins.StateSwaps.SwapValidator`
  - [ ] Update of `book_stateswap` — Pre-Op Sync, PreImage, filter `book_stateaapproved, book_statebapproved, book_beapproved, book_denied`
- [ ] `Checkbook.Plugins.StateSwaps.SwapAutoSharePlugin`
  - [ ] Create of `book_stateswap` — Post-Op Sync
  - [ ] Update of `book_stateswap` — Post-Op Sync, PreImage (`book_statea, book_stateb`), **no filtering attributes** (fires on any save for the backfill sweep)
- [ ] `Checkbook.Plugins.StateSwaps.SwapItemAutoSharePlugin`
  - [ ] Create of `book_swapitem` — Post-Op Sync
- [ ] `Checkbook.Plugins.StateSwaps.SwapApprovalPlugin`
  - [ ] Update of `book_stateswap` — Post-Op Sync, full PreImage, filter `book_beapproved`
- [ ] `Checkbook.Plugins.StateSwaps.SwapDenialPlugin`
  - [ ] Update of `book_stateswap` — Pre-Op Sync, **Rank 10** (before `SwapValidator` at rank 20), PreImage, filter `book_denied, book_stateaapproved, book_statebapproved`

### LOAs
- [ ] Custom API `book_GenerateLOAs` exists with Plugin Type = `Checkbook.Plugins.LOAs.LOAGenerator`
- [ ] `Checkbook.Plugins.LOAs.LOANameSetter`
  - [ ] Create of `book_fundingline` — Pre-Op Sync
  - [ ] Update of `book_fundingline` — Pre-Op Sync, PreImage, filter on grain attrs (incl. `book_category`)
- [ ] `Checkbook.Plugins.LOAs.FundingTrackLOASynchronizer`
  - [ ] Update of `book_fundingtrack` — Pre-Op Sync, PreImage, filter on grain attrs (incl. `book_category`)

### Funds
- [ ] `Checkbook.Plugins.Funds.FundKeySetter`
  - [ ] Create of `book_fund` — Pre-Op Sync
  - [ ] Update of `book_fund` — Pre-Op Sync, PreImage, filter `book_name, book_boc, book_dollartypefundedprogram, book_newfundedprogram`
- [ ] Classic workflow **`Fund-CreateKey`** is deactivated (FundKeySetter owns `book_fundkey` now)

### Distributions
- [ ] Custom API `book_GenerateDistributions` exists with Plugin Type = `Checkbook.Plugins.Distributions.GenerateDistributionsPlugin`
- [ ] The Custom API / its step run **Sync** (the caller pumps `NextToken`; Async suppresses outputs — see [`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md))

### Admin
- [ ] Custom API `book_ToggleFundedAmountLock` exists with Plugin Type = `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin`, output `IsLocked` (Boolean)

### Schema + env vars
- [ ] `book_turnin` has the four new columns (`book_origin`, `book_afpamount`, `book_allotmentamount`, `book_requiresbeapproval`)
- [ ] FY27 fund model (all nullable — FY26 rows never carry them):
  - [ ] Table `book_fundedprogram` exists (primary name `book_name`)
  - [ ] `book_fund` has lookup `book_newfundedprogram` → `book_fundedprogram` (the plain `book_fundedprogram` logical name is taken by a legacy picklist on `book_fund`)
  - [ ] Global choice `book_category` exists with **explicit values** RISK=0, TSP=1, RPA=2, CON=3 (must match `Constants/CategoryValues.cs`)
  - [ ] `book_fundingtrack` has choice column `book_category`
  - [ ] `book_fundingline` has choice column `book_category`
- [ ] Env var `book_DistributionHoldingFundCenter` is defined and set to the A18 record's GUID
- [ ] Env var `book_TurnInCreditOPR` is defined and set to the BE OPR's record GUID (required for FY27+ Turn-Ins)
- [ ] Env var `book_LockManualFundedEdits` (Yes/No) is defined, default `false`
- [ ] `book_stateswap` and `book_swapitem` tables exist per [`../dist/SCHEMA-StateSwap.md`](../dist/SCHEMA-StateSwap.md)
- [ ] `book_stateswap` → `book_swapitem` 1:N has **Share cascade = Cascade All**
- [ ] `book_ledger` has new lookup `book_stateswap`
- [ ] `book_ledgertype` option-set value `2` relabeled from **Add** to **Swap**
- [ ] Owner teams `{Abbr} - State Approver` and `{Abbr} - State Administrator` exist for each state that will participate in swaps

---

## Smoke tests

Each subfolder doc carries a domain-specific smoke test sequence:

- **Itemized Details sync** — see "Smoke test" further down in the
  ItemizedDetailsSynchronizer section above (deleting Requirement Details,
  user-adding Itemized Details from the grid, and swapping RF).
- **Funding Event + Turn-In financial flow** — see the existing
  "Smoke tests (financial flow)" section below.
- **LOA generation** — see [`LOAs/REGISTRATION.md`](LOAs/REGISTRATION.md) §
  "Smoke test sequence".
- **Generate Distributions** — see
  [`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md) §
  "Smoke test sequence".

### ItemizedDetailsSynchronizer smoke test

1. Create a Prioritization under a Requirement that **has** Requirement
   Details. Within ~30 seconds (async step) `book_fundingmode` should flip to
   Itemized; **no** Itemized Details are created, and Requested Amount stays
   locked and empty on the form.
2. On that Prioritization, use the ItemizedDetailsGrid's **Add Items** dialog
   to select two Requirement Details — two `book_itemizeddetails` rows appear.
   Enter Requested amounts; the Prio's Requested Amount becomes their sum
   (rollup).
3. Remove one row with the grid's per-row remove — the rollup drops
   accordingly.
4. Delete one Requirement Detail (`book_requirementdetails`) that has linked
   Itemized Details — the linked rows should be gone and the rollup recalced.
5. Create a Prioritization under a Requirement **without** Requirement
   Details — FundingMode stays Direct and Requested Amount is editable.
6. On a Prioritization currently itemized against Requirement **A**, change
   `book_requirementfunding` to an RF that points to Requirement **B**. Within
   ~30 seconds the Itemized Details linked to A's RDs should be gone; the
   FundingMode should be Itemized if B has RDs (user re-selects from the
   grid) or Direct if it has none.
7. Repeat step 6 but change the direct `book_requirement` lookup on the form
   instead (FY27+ shape) — from a Requirement with RDs to one **without**.
   Same expectation: stale Itemized Details deleted, FundingMode flips to
   Direct.

If step 4 leaves an orphan, the **Delete / Pre-Operation / Sync** step is
missing or mis-registered. If step 6 or 7 leaves stale Itemized Details or a
stale FundingMode, the **Update of book_prioritization** step is missing, or
its filter/PreImage lacks one of `book_requirement` /
`book_requirementfunding`.

### Funding Event + Turn-In financial flow smoke tests

1. **Non-overlap (A)** — create a second active AFP Funding Event whose
   `[StartDate, EndDate]` intersects an existing AFP event's range; save
   should fail with "overlaps another active AFP event."
2. **Allotment ≤ AFP (B)** — set an Allotment Funding Detail to a pct > the
   AFP pct for the same (Fund, PG/SAG) in the same date range; save should
   fail naming the offending segment.
3. **Kind A AFP/Allotment calculation** — create a new state-submitted
   Turn-In (`Origin = State`) with TDP = $100, Fund/PG that has AFP pct = 50
   and Allotment pct = 30 today; `book_afpamount` should auto-fill to $50,
   `book_allotmentamount` to $30.
4. **Kind A approval** — approve the Turn-In from (3); two Distribution
   pairs should appear (one AFP, one Allotment), each at the pre-computed
   amount with `book_fundingevent` populated so `book_fundingtype` resolves.
5. **Sweep overage detection** — invoke `book_GenerateDistributions` against
   a bucket whose existing AFP credits exceed target by $40; an
   `Origin = Sweep` Turn-In should appear with `book_afpamount = 40` and
   `book_allotmentamount = 0`.
6. **Sweep decay** — raise the AFP Funding Detail pct so target catches up
   to existing; re-run `book_GenerateDistributions`; the Sweep Turn-In's
   `book_afpamount` should drop. When it (and Allotment amount) reach 0,
   the Turn-In is **deleted** (spent trackers used to deactivate and pile
   up as zero-amount clutter).

---

## Adding more plugins to this doc

When a new plugin class is wired into PRT, append a new `###` section in the
right domain folder above with the same table shape, then add a corresponding
bullet group to the verification checklist. Keep the table columns identical
so a reader can scan the whole doc top-to-bottom.

Also:

1. Update the **plugin class count** in the intro (and the assembly-registration
   step 5 count).
2. If the step lands on an entity in **Per-entity pipeline maps**, insert it
   there in execution order — and set an explicit Rank if order matters.
3. If it reads an env var or backs a Custom API, add rows to those tables.
