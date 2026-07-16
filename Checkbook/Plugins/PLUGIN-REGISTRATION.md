# Plugin Registration

How to register the `Checkbook_Plugins.dll` plugins against a Dataverse
environment using the **Plugin Registration Tool (PRT)**. PRT is the only
delivery mechanism — solution `.zip`s cannot carry step registrations for this
project (see `Checkbook/CLAUDE.md`).

This file is the source of truth for **what steps should exist** in any env
running these plugins. When you finish a registration session, walk the
verification checklist at the bottom and confirm every row is present.

The assembly currently ships **40 concrete plugin classes** (39 + the four
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
5. Step 2 — **Select the plugins** to register: leave all **40** checked.
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
| `book_swapitem` table (new) | Full attribute list §2. Configure the 1:N from `book_stateswap` with **Share cascade = Cascade All** (§4) so item sharing follows the parent. |
| `book_ledger` (existing) | Add lookup `book_stateswap` → `book_stateswap` (peer of `book_turnin`, `book_realignment`). |
| `book_ledgertype` option set (existing) | Relabel value `2` from **Add** to **Swap** (values stay Realignment=0, Turn-in=1, Swap=2, Cut=3). This corrects a pre-existing constants bug — `LedgerTypeValues` in this build now uses 0/1/2. Historical ledger rows previously written with `book_ledgertype = 100000001` / `100000002` should be backfilled to `0` / `1` if reporting on ledger type matters. |
| Owner teams per state | Names `{StateAbbr} - State Approver` and `{StateAbbr} - State Administrator` (e.g. `AL - State Approver`). One pair per state. `SwapAutoSharePlugin` looks them up by name and shares each swap with both teams. Missing teams are logged and skipped, not fatal. |
| Role privileges | Grant User-level Create/Read/Write/Delete/Append/AppendTo/Share on `book_stateswap` + `book_swapitem` to `Book - State Approver` and `Book - State Administrator`; Org-level Read to `Book - Budget Executor` and `Book - Read Only`; Org-level everything to `Book - Checkbook Administrator`. See schema doc §5.1. |

---

## Environment variables required

| Variable                              | Type | Read by                                                  | Notes |
|---------------------------------------|------|----------------------------------------------------------|-------|
| `book_DistributionHoldingFundCenter`  | Text | `GenerateDistributionsPlugin`                            | See [`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md). The A18 record's GUID. |
| `book_TurnInCreditOPR`                | Text | `TurnInApprovalPlugin` (via `TurnInLOAResolver`)         | See [`TurnIns/REGISTRATION.md`](TurnIns/REGISTRATION.md). Required for FY27+ Turn-Ins. |
| `book_LockManualFundedEdits`          | Yes/No | `PrioritizationFundedAmountLock`; written by `ToggleFundedAmountLockPlugin` | See [`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md). Ships default `false`; toggled via the Admin Center button. |

---

## Custom APIs required

| Custom API                          | Plugin Type                                                     | Notes |
|-------------------------------------|------------------------------------------------------------------|-------|
| `book_ReconcileItemizedDetails`     | `Checkbook.Plugins.Items.ItemizedDetailsReconciler`              | See **Items — `ItemizedDetailsReconciler`** below. |
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

When the `book_LockManualFundedEdits` env var is `true`, blocks direct edits
to `book_newfundedamounttdp` on `book_prioritization` unless the update comes
from an authorized parent operation (Turn-In / Realignment / State Swap
approval or `book_GenerateDistributions` — detected by walking
`context.ParentContext`). Full setup (env var, Custom API, command button):
[`../docs/FundedAmountLock-Setup.md`](../docs/FundedAmountLock-Setup.md).

| # | Message | Primary entity        | Stage          | Mode | Filtering attributes         | Notes |
|---|---------|-----------------------|----------------|------|------------------------------|-------|
| 1 | Update  | `book_prioritization` | Pre-Operation  | Sync | `book_newfundedamounttdp`    | Rank **10** (runs before the other Pre-Op Update validators). **Requires PreImage** (`book_newfundedamounttdp`). |

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

### `Checkbook.Plugins.Validation.RequirementFundingTDPValidator`

Enforces TDP ≥ 0, FundedAmount ≥ 0, FundedAmount ≤ TDP, and (when TDP changes
or FundedAmount changes on a leaf RF) the LOA TDP allocation cap. Skips the
LOA-allocation check when the update is mid-realignment (detected by walking
`context.ParentContext`).

| # | Message | Primary entity            | Stage          | Mode | Filtering attributes                                                              | Notes |
|---|---------|---------------------------|----------------|------|-----------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_requirementfunding` | Pre-Operation  | Sync | *(none)*                                                                          | Validates new RF against its LOA. |
| 2 | Update  | `book_requirementfunding` | Pre-Operation  | Sync | `book_tdp, book_fundedamount, book_lineofaccounting`                              | Re-validates on TDP / Funded / LOA change. **Requires PreImage** (`book_tdp, book_fundedamount, book_lineofaccounting`). |

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

Post-op executor that fires on the approval transition. Creates the Ledger
debit/credit pair, applies the RF (and Prio, on Prior→Prior) funding
movements, recalculates touched LOAs, and deactivates the Realignment.
Depth-guarded so the deactivation Update at the end doesn't re-enter.

| # | Message | Primary entity      | Stage           | Mode | Filtering attributes                     | Notes |
|---|---------|---------------------|-----------------|------|------------------------------------------|-------|
| 1 | Update  | `book_realignments` | Post-Operation  | Sync | `book_newstateapproved, book_bedecision` | Triggers on approval/denial transitions. **Requires PreImage** (full image — reads many attrs via `GetEffective*` and `TryGetPreImage`). |

---

## Items

### `Checkbook.Plugins.Items.ItemizedDetailsSynchronizer`

Keeps `book_itemizeddetails` rows in lockstep with the `book_requirementdetails`
defined on a Requirement. Without these steps, removing a Requirement Detail
leaves orphaned Itemized Details on every child Prioritization.

| # | Message | Primary entity         | Stage          | Mode  | Filtering attributes      | Notes |
|---|---------|------------------------|----------------|-------|---------------------------|-------|
| 1 | Delete  | `book_requirementdetails` | Pre-Operation  | Sync  | *(none)*                  | Wipes children before the parent row goes. **Sync** so failure rolls back the Delete. |
| 2 | Create  | `book_requirementdetails` | Post-Operation | Async | *(none)*                  | Fans the new detail out to every existing Prioritization of the parent Requirement. |
| 3 | Create  | `book_prioritization`     | Post-Operation | Async | *(none)*                  | Seeds Itemized Details on a new Prioritization from the Requirement's existing details. |
| 4 | Update  | `book_prioritization`     | Post-Operation | Async | `book_requirementfunding` | Re-points Itemized Details when the user swaps the RF. **Requires PreImage** (`book_requirementfunding`). |

### `Checkbook.Plugins.Items.ItemizedDetailsReconciler`

Custom API handler that backfills Itemized Details on a Prioritization that
fell out of sync (e.g., a user toggled Direct ↔ Itemized mid-year). Idempotent
— only adds missing rows, never deletes or modifies existing ones, and never
flips `book_fundingmode`.

| # | Message                          | Primary entity | Stage          | Mode | Filtering attributes | Notes |
|---|----------------------------------|----------------|----------------|------|----------------------|-------|
| 1 | `book_ReconcileItemizedDetails`  | *(none)*       | Post-Operation | Sync | *(none)*             | Bound to the Custom API — Stage/Mode are fixed by the Custom API record. |

**Custom API record** (create under **Power Apps → … → Custom APIs**):

| Field                             | Value                                                  |
|-----------------------------------|--------------------------------------------------------|
| Unique Name                       | `book_ReconcileItemizedDetails`                        |
| Name                              | `book_ReconcileItemizedDetails`                        |
| Display Name                      | Reconcile Itemized Details                             |
| Description                       | Backfills missing Itemized Details on a Prioritization. |
| Binding Type                      | Global                                                 |
| Is Function                       | No                                                     |
| Enabled For Workflow              | No                                                     |
| Allowed Custom Processing Step Type | None                                                 |
| Execute Privilege Name            | *(leave blank — caller's privileges apply)*            |
| Plugin Type                       | `Checkbook.Plugins.Items.ItemizedDetailsReconciler`    |

**Custom API request parameters:**

| Name              | Display Name      | Type   | Logical Entity Name | Is Optional |
|-------------------|-------------------|--------|---------------------|-------------|
| `PrioritizationId`| Prioritization Id | Guid   | *(blank)*           | No          |

**Custom API response properties:**

| Name         | Display Name | Type    |
|--------------|--------------|---------|
| `AddedCount` | Added Count  | Integer |
| `Message`    | Message      | String  |

**Ribbon button JS** — drop into a JS web resource (e.g.
`book_/scripts/prioritization_ribbon.js`) and wire a "Sync Itemized Details"
command on the Prioritization form to call
`Prioritization.Ribbon.syncItemizedDetails(primaryControl)`:

```js
var Prioritization = Prioritization || {};
Prioritization.Ribbon = Prioritization.Ribbon || {};

Prioritization.Ribbon.syncItemizedDetails = function (formContext) {
    var id = formContext.data.entity.getId().replace(/[{}]/g, "");
    var request = {
        PrioritizationId: id,
        getMetadata: function () {
            return {
                boundParameter: null,
                operationType: 0,
                operationName: "book_ReconcileItemizedDetails",
                parameterTypes: {
                    PrioritizationId: { typeName: "Edm.Guid", structuralProperty: 1 }
                }
            };
        }
    };

    Xrm.Utility.showProgressIndicator("Reconciling Itemized Details…");
    Xrm.WebApi.online.execute(request)
        .then(function (response) { return response.json(); })
        .then(function (result) {
            Xrm.Utility.closeProgressIndicator();
            Xrm.Navigation.openAlertDialog({ text: result.Message });
            var grid = formContext.getControl("ItemizedDetailsGrid")
                || formContext.getControl("itemizeddetailsSubgrid");
            if (grid && grid.refresh) grid.refresh();
        })
        .catch(function (err) {
            Xrm.Utility.closeProgressIndicator();
            Xrm.Navigation.openErrorDialog({ message: err.message || String(err) });
        });
};
```

The button can always be visible — the plugin returns a friendly message for
the "not Itemized" case rather than throwing.

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
| 1 | Update  | `book_requirements` | Post-Operation  | Sync | `book_fundcenter, book_national`  | Cascades to linked Prios. **Requires PreImage** (`book_fundcenter, book_national`). |

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

Rolls `book_prioritizationfunding` junction amounts up onto the parent
Prioritization's `book_newfundedamounttdp` + `book_validatedamount`. The
aggregate fetch + Prio update lives in
`Helpers/PrioritizationFundingRollupHelper.RecalculatePrioritizationFunded`.

| # | Message | Primary entity                | Stage           | Mode | Filtering attributes                                                                | Notes |
|---|---------|-------------------------------|-----------------|------|-------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_prioritizationfunding`  | Post-Operation  | Sync | *(none)*                                                                            | Recalc new parent Prio. |
| 2 | Update  | `book_prioritizationfunding`  | Post-Operation  | Sync | `book_fundedamount, book_validatedamount, book_prioritization, statecode`           | Recalc current parent; recalc old parent on re-parent. **Requires PreImage** (`book_fundedamount, book_validatedamount, book_prioritization`). |
| 3 | Delete  | `book_prioritizationfunding`  | Post-Operation  | Sync | *(none)*                                                                            | Recalc pre-image parent. **Requires PreImage** (`book_prioritization`). |

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
| 1 | Create  | `book_fundingtrack`   | Post-Operation  | Sync | *(none)*                                                        | Recalc LOA. |
| 2 | Update  | `book_fundingtrack`   | Post-Operation  | Sync | `book_resourceamount, book_lineofaccounting, statecode`         | Recalc current + old LOA on re-link. **Requires PreImage** (`book_lineofaccounting`). |
| 3 | Delete  | `book_fundingtrack`   | Post-Operation  | Sync | *(none)*                                                        | Recalc pre-image LOA. **Requires PreImage** (`book_lineofaccounting`). |

> See [`LOAs/REGISTRATION.md`](LOAs/REGISTRATION.md) for the ordering
> contract with `FundingTrackLOASynchronizer` (the synchronizer runs pre-op,
> this recalc runs post-op — together they let the recalc see both the
> pre-image's old LOA and the synchronizer's new LOA).

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
| 1 | Update  | `book_turnin`  | Pre-Operation | Sync | `book_stateapproved, book_beapproved` | Only fires on approval transitions. **Requires PreImage** (`book_stateapproved, book_beapproved, book_newamount, book_origin, book_afpamount, book_allotmentamount`) — origin + AFP/Allotment amounts are needed to evaluate the sweep-origin AFP-only path. |

### `Checkbook.Plugins.TurnIns.TurnInApprovalPlugin`

Post-op orchestrator that executes the approved Turn-In: resolves credit
LOA, creates Ledger debit/credit pair, creates AFP/Allotment Distributions,
updates Prios and (for RF-only items) RFs, rolls up parent RFs, recalcs
touched LOAs, and deactivates the Turn-In. Depth-guarded.

| # | Message | Primary entity | Stage           | Mode | Filtering attributes                  | Notes |
|---|---------|----------------|-----------------|------|---------------------------------------|-------|
| 1 | Update  | `book_turnin`  | Post-Operation  | Sync | `book_stateapproved, book_beapproved` | Fires on approval transition with idempotency guard. **Requires PreImage** (full image — reads `book_stateapproved, book_beapproved, book_newamount, book_fund, book_pg, book_fundcenter, book_origin, book_afpamount, book_allotmentamount`). |

> See [`TurnIns/REGISTRATION.md`](TurnIns/REGISTRATION.md) for the
> `book_TurnInCreditOPR` env var that this plugin reads via
> `TurnInLOAResolver` for FY27+ records.

### `Checkbook.Plugins.TurnIns.TurnInDeactivator`

Post-op handler for the **denied** path: when `book_stateapproved` flips
true → false, deactivates the Turn-In (statecode = Inactive). No financial
side effects — `TurnInValidator`'s idempotency guarantees no ledgers exist
when this path runs. Depth-guarded so its own deactivation Update doesn't
re-enter.

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

Pre-op gate on `book_stateswap` approval / denial transitions. Enforces
idempotency (no re-processing if ledgers exist), role gating with
**per-state BU scoping** via `StateScopeHelper` (a State A Approver in the
wrong BU cannot approve the State A side), balance (recomputed live from
active items — the stored `book_isbalanced` is not trusted), overdraw per
debit Prio, and the "BE requires both state approvals" prereq. Denial
transitions skip balance / overdraw / BE-prereq checks so an incomplete
swap can still be denied.

Role checks map:
- State A / State B approval: `Book - State Approver` or `Book - State Administrator` **and** user BU matches that state's owning BU. `Book - Checkbook Administrator` bypasses the BU scope.
- BE approval: `Book - Budget Executor` or `Book - Checkbook Administrator`.
- Denial: any of the four approver roles.

| # | Message | Primary entity   | Stage         | Mode | Filtering attributes                                                                | Notes |
|---|---------|------------------|---------------|------|--------------------------------------------------------------------------------------|-------|
| 1 | Update  | `book_stateswap` | Pre-Operation | Sync | `book_stateaapproved, book_statebapproved, book_beapproved, book_denied`             | Only fires on approval / denial transitions. **Requires PreImage** (`book_stateaapproved, book_statebapproved, book_beapproved, book_denied, book_statea, book_stateb`). |

### `Checkbook.Plugins.StateSwaps.SwapAutoSharePlugin`

Post-op sharing writer. On Create, shares the swap with StateA + StateB's
`{Abbr} - State Approver` and `{Abbr} - State Administrator` owner-teams
(4 teams). On Update, revokes access from an old state's teams and grants
to the new state's teams when `book_statea` or `book_stateb` changes.
Missing teams are logged and skipped so environment misconfiguration does
not block record creation. Item sharing follows automatically via the
parent 1:N's Share = Cascade All.

| # | Message | Primary entity   | Stage           | Mode | Filtering attributes                | Notes |
|---|---------|------------------|-----------------|------|-------------------------------------|-------|
| 1 | Create  | `book_stateswap` | Post-Operation  | Sync | *(none)*                            | Initial share to StateA + StateB teams. |
| 2 | Update  | `book_stateswap` | Post-Operation  | Sync | `book_statea, book_stateb`          | Rebalance shares when a state changes. **Requires PreImage** (`book_statea, book_stateb`). |

### `Checkbook.Plugins.StateSwaps.SwapApprovalPlugin`

Post-op orchestrator for a BE-approved State Swap. Fires only on
`book_beapproved` false → true. Resolves each item's debit/credit LOA +
parent RF via `SwapLOAResolver`, writes ledger pairs (skipping same-LOA
net-zero items), recalcs touched LOA TDPs, applies net Prio `FundedAmount`
and parent RF `TDP` deltas via `SwapPrioritizationUpdater`, recalcs LOA
TDPs again as a catch-all, and deactivates the swap (statecode Inactive,
statuscode 2 = BE Approved). Depth-guarded.

Piggybacks on the `IsTriggeredByStateSwap` bypass added to
`RequirementFundingTDPValidator` — RF intermediate states during Prio /
RF delta application would otherwise trip the TDP-vs-Funded check.

| # | Message | Primary entity   | Stage           | Mode | Filtering attributes | Notes |
|---|---------|------------------|-----------------|------|----------------------|-------|
| 1 | Update  | `book_stateswap` | Post-Operation  | Sync | `book_beapproved`    | Fires on BE approval transition; idempotency-guarded. **Requires PreImage** (full image: `book_beapproved, book_stateaapproved, book_statebapproved, book_statea, book_stateb, book_newfiscalyear`). |

### `Checkbook.Plugins.StateSwaps.SwapDenialPlugin`

Pre-op denial-lifecycle writer. Three cases on the same Update, all at
Depth 1 only:

- **A. Denial transition** (`book_denied` false → true): clears all three approval flags + their by/on lookups; preserves `book_denialreason` as history.
- **B. Next save after denial** (`preImage.book_denied = true` + no denial change this update): clears `book_denied` so the swap leaves the denied state.
- **C. Resubmission approval** (state A or state B false → true + `preImage.book_denialreason` had a value): clears `book_denialreason`.

Depth guard prevents `SwapRollupPlugin`'s nested parent Update from clearing
denied on the drafter's behalf.

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

Custom API handler `book_GenerateDistributions`. Phase 1 deactivates stale
Distributions; Phases 2 + 3 reconcile Prio + Requirement buckets against
their target `funded × pct` and create debit/credit pairs (or overage
Sweep Turn-Ins). Wired via the Custom API's **Plugin Type** field — no
separate Step registration required beyond that.

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
`book_LockManualFundedEdits` env-var value record and returns the new state
as `IsLocked`. Role-gated in code to `Book - Checkbook Administrator`
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

### `book_prioritization`

**Create** (in order):

| Order | Stage | Mode | Step | Ordering constraint |
|---|---|---|---|---|
| 1 | Pre-Op (rank 1) | Sync | `PrioritizationFundingValidator` | None — reads only Target amounts. |
| 2 | Pre-Op (rank 10) | Sync | `PrioritizationFundCenterBackfill` | Must precede NameSetter (writes `book_fundcenter` into Target). |
| 3 | Pre-Op (rank 20) | Sync | `RequirementDetailFundingGuard` | XOR guard; before NameSetter so rejected Prios skip the naming retrieves. |
| 4 | Pre-Op (rank 30) | Sync | `PrioritizationNameSetter` | Reads `book_fundcenter` from Target — MUST run after the backfill. |
| 5 | Post-Op | Sync | `PrioritizationRollupToRequirementFunding` | Rolls new Prio into parent RF totals. |
| 6 | Post-Op | **Async** | `ItemizedDetailsSynchronizer` | Seeds Itemized Details; async, so it lands after the transaction. |

**Update** (in order):

| Order | Stage | Mode | Step | Filter / constraint |
|---|---|---|---|---|
| 1 | Pre-Op (rank 10) | Sync | `PrioritizationFundedAmountLock` | `book_newfundedamounttdp` — lock guard runs before other validators so users get the lock message, not a cap error. |
| 2 | Pre-Op | Sync | `PrioritizationFundingValidator` | `book_newfundedamounttdp, book_requirementfunding, book_approvalstatus, statecode` |
| 3 | Pre-Op | Sync | `PrioritizationNameSetter` | `book_state, book_requirementfunding, book_requirement, book_statepriority, book_fundcenter, book_newfiscalyear` |
| 4 | Post-Op | Sync | `PrioritizationRollupToRequirementFunding` | `book_newfundedamounttdp, book_validatedamount, book_requirementfunding, statecode` |
| 5 | Post-Op | **Async** | `ItemizedDetailsSynchronizer` | `book_requirementfunding` (RF swap re-points details) |

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
| 4 | Post-Op | Sync | `SwapAutoSharePlugin` | `book_statea, book_stateb` — re-shares with state teams. |

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
  - [ ] Create of `book_requirementdetails` — Post-Op, Async
  - [ ] Create of `book_prioritization` — Post-Op, Async
  - [ ] Update of `book_prioritization` — Post-Op, Async, filter `book_requirementfunding`, PreImage `book_requirementfunding`
- [ ] `Checkbook.Plugins.Items.ItemizedDetailsReconciler`
  - [ ] Custom API `book_ReconcileItemizedDetails` exists with input `PrioritizationId` and outputs `AddedCount` + `Message`
  - [ ] Plugin Type on the Custom API = `Checkbook.Plugins.Items.ItemizedDetailsReconciler`
  - [ ] Ribbon button on the Prioritization form invokes the Custom API and shows `Message` in an alert dialog
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
  - [ ] Create / Update / Delete of `book_prioritizationfunding` — Post-Op Sync; Update + Delete have PreImage
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
  - [ ] Update of `book_stateswap` — Post-Op Sync, PreImage, filter `book_statea, book_stateb`
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
  ItemizedDetailsSynchronizer section above (steps 1–6 deleting/adding
  Requirement Details and swapping RF).
- **Funding Event + Turn-In financial flow** — see the existing
  "Smoke tests (financial flow)" section below.
- **LOA generation** — see [`LOAs/REGISTRATION.md`](LOAs/REGISTRATION.md) §
  "Smoke test sequence".
- **Generate Distributions** — see
  [`Distributions/REGISTRATION.md`](Distributions/REGISTRATION.md) §
  "Smoke test sequence".

### ItemizedDetailsSynchronizer smoke test

1. Pick a Requirement with at least one active child Prioritization that has
   Itemized Details.
2. Note the number of Itemized Detail rows on that Prioritization
   (`book_itemizeddetails` filtered by the Prioritization).
3. Delete one Requirement Detail (`book_requirementdetails`) from the
   Requirement.
4. Re-query Itemized Details — the count should drop by exactly one, and the
   row that pointed at the deleted Requirement Detail should be gone.
5. Add a new Requirement Detail to the same Requirement; within ~30 seconds
   (async step), a matching Itemized Detail should appear on each child
   Prioritization.
6. On a Prioritization currently itemized against Requirement **A**, change
   `book_requirementfunding` to an RF that points to Requirement **B**. Within
   ~30 seconds the Itemized Details linked to A's RDs should be gone and a new
   set seeded from B's RDs. If B has zero RDs, the Prioritization should drop
   to `FundingMode = Direct`.

If step 4 leaves an orphan, the **Delete / Pre-Operation / Sync** step is
missing or mis-registered. If step 6 leaves stale Itemized Details, the
**Update of book_prioritization** step (or its PreImage) is missing.

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
   the Turn-In deactivates.

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
