# Plugin Registration

How to register the `Checkbook_Plugins.dll` plugins against a Dataverse
environment using the **Plugin Registration Tool (PRT)**. PRT is the only
delivery mechanism — solution `.zip`s cannot carry step registrations for this
project (see `CLAUDE.md`).

This file is the source of truth for **what steps should exist** in any env
running these plugins. When you finish a registration session, walk the
verification checklist at the bottom and confirm every row is present.

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
5. Step 2 — **Select the plugins** to register: leave all 17 checked.
6. Click **Register Selected Plugins**.

For subsequent code changes, use **Update Assembly** on the existing
`Checkbook_Plugins` row instead of re-registering — that preserves all step
registrations.

---

## Steps to register

Each H3 below is one plugin class. Register every row in its table as a
separate SDK Message Processing Step.

### `Checkbook.Plugins.Items.ItemizedDetailsSynchronizer`

Keeps `book_itemizeddetails` rows in lockstep with the `book_requirementdetails`
defined on a Requirement. Without these steps, removing a Requirement Detail
leaves orphaned Itemized Details on every child Prioritization.

| # | Message | Primary entity         | Stage          | Mode         | Filtering attributes | Notes                                                     |
|---|---------|------------------------|----------------|--------------|----------------------|-----------------------------------------------------------|
| 1 | Delete  | `book_requirementdetails` | **Pre-Operation**  | **Synchronous**  | *(none)*             | Wipes children before the parent row goes. **Sync** so failure rolls back the Delete. |
| 2 | Create  | `book_requirementdetails` | Post-Operation | Asynchronous | *(none)*             | Fans the new detail out to every existing Prioritization of the parent Requirement. |
| 3 | Create  | `book_prioritization`     | Post-Operation | Asynchronous | *(none)*             | Seeds Itemized Details on a new Prioritization from the Requirement's existing details. |
| 4 | Update  | `book_prioritization`     | Post-Operation | Asynchronous | `book_requirementfunding` | Re-points Itemized Details when the user swaps the RF to a different Requirement. **Requires PreImage** (see below). |

**PRT field values for each step (common to all four):**

- **Run in User's Context**: `Calling User`
- **Execution Order**: `1`
- **Deployment**: `Server Only`
- **Description**: copy the row's *Notes* column above

**PreImage on step 4 (`Update of book_prioritization`):**

- **Name**: `PreImage`
- **Entity Alias**: `PreImage`
- **Stage**: `Pre-image` (PRT default for Update steps)
- **Parameters**: `book_requirementfunding`

Steps 1–3 do not need any pre/post images.

### `Checkbook.Plugins.Items.ItemizedDetailsReconciler`

Custom API handler that backfills Itemized Details on a Prioritization that
fell out of sync (e.g., a user toggled Direct ↔ Itemized mid‑year). The action
is idempotent — it only adds missing rows, never deletes or modifies existing
ones, and never flips `book_fundingmode`.

| # | Message                          | Primary entity | Stage          | Mode         | Filtering attributes | Notes                                |
|---|----------------------------------|----------------|----------------|--------------|----------------------|--------------------------------------|
| 1 | `book_ReconcileItemizedDetails`  | *(none)*       | Post-Operation | Synchronous  | *(none)*             | Bound to the Custom API message — Stage/Mode are fixed by the Custom API record. |

**Custom API record** (create under **Power Apps → … → Custom APIs** in the env;
this metadata can also ride in a solution):

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

**Ribbon button JS** — drop in a JS web resource (e.g., `book_/scripts/prioritization_ribbon.js`)
and wire a "Sync Itemized Details" command on the Prioritization form to call
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
                operationType: 0, // Action
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
            // Refresh whatever subgrid hosts the Itemized Details on the form.
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

The button itself can always be visible — the plugin handles the "not Itemized"
case by returning a friendly message rather than throwing.

---

## Verification checklist

After registration, in PRT click into the `(Assembly) Checkbook_Plugins`
node and confirm every row below is present and enabled. The fastest way is to
sort the right pane by **Message** then by **Primary Entity**.

- [ ] **Plug-in:** `Checkbook.Plugins.Items.ItemizedDetailsSynchronizer`
  - [ ] Step: `Delete of book_requirementdetails` — Pre-Operation, Sync
  - [ ] Step: `Create of book_requirementdetails` — Post-Operation, Async
  - [ ] Step: `Create of book_prioritization` — Post-Operation, Async
  - [ ] Step: `Update of book_prioritization` — Post-Operation, Async, filter `book_requirementfunding`, **PreImage** `PreImage` with `book_requirementfunding`
- [ ] **Plug-in:** `Checkbook.Plugins.Items.ItemizedDetailsReconciler`
  - [ ] Custom API `book_ReconcileItemizedDetails` exists with input `PrioritizationId` and outputs `AddedCount` + `Message`
  - [ ] Plugin Type on the Custom API = `Checkbook.Plugins.Items.ItemizedDetailsReconciler`
  - [ ] Ribbon button on the Prioritization form invokes the Custom API and shows `Message` in an alert dialog

**Smoke test** (run in the env after registration):

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

---

## Schema additions required (must exist in env before deploying this build)

Before registering the FundingEvent and Turn-In plugins below, three columns must
be added to `book_turnin` in the maker portal. The plugin code references their
schema names directly; the build will succeed without them, but at runtime the
Create / Update messages will fail.

| Column                  | Type                 | Default | Notes                                                                                  |
|-------------------------|----------------------|---------|----------------------------------------------------------------------------------------|
| `book_origin`           | Choice (option set)  | `State` | Values: **State** = `0`, **Sweep** = `1`. Distinguishes Kind A (state-submitted) from Kind B (sweep-created over-allocation tracker). |
| `book_afpamount`        | Decimal (2 decimals) | `0`     | AFP amount that will flow back to A18 on approval. Auto-populated by `TurnInAmountCalculator` for Kind A; written by `GenerateDistributions` for Kind B. |
| `book_allotmentamount`  | Decimal (2 decimals) | `0`     | Allotment amount that will flow back to A18 on approval. Same population sources as above. |

`book_newamount` keeps its existing schema; its semantic meaning narrows to
"TDP amount being returned (Kind A) or 0 (Kind B)" — no migration needed.

---

## Steps to register (Funding Event + Turn-In financial flow)

### `Checkbook.Plugins.Validation.FundingEventValidator`

Enforces the two invariants that `FundingPercentageHelper` and the Generate
Distributions sweep rely on: (A) no two same-type Funding Events with
overlapping date ranges; (B) for every (Fund, PG/SAG) and every date,
Allotment percentage ≤ AFP percentage.

| # | Message | Primary entity         | Stage          | Mode        | Filtering attributes                                                                 | Notes                                  |
|---|---------|------------------------|----------------|-------------|--------------------------------------------------------------------------------------|----------------------------------------|
| 1 | Create  | `book_fundingevent`    | Pre-Operation  | Synchronous | *(none)*                                                                             | Validates own dates + type vs siblings. |
| 2 | Update  | `book_fundingevent`    | Pre-Operation  | Synchronous | `book_fundingtype, book_startdate, book_enddate, statecode`                          | Re-validates on any range/type change. **Requires PreImage.** |
| 3 | Create  | `book_fundingdetails`  | Pre-Operation  | Synchronous | *(none)*                                                                             | Validates Allotment ≤ AFP for the new row. |
| 4 | Update  | `book_fundingdetails`  | Pre-Operation  | Synchronous | `book_distributionpercentage, book_fund, book_pgsag, book_fundingevent, statecode`   | Re-validates on pct / fund / PG change. **Requires PreImage.** |

**Common PRT field values** for all four steps:
- **Run in User's Context**: `Calling User`
- **Execution Order**: `1`
- **Deployment**: `Server Only`

**PreImage** on steps 2 and 4:
- **Name** / **Entity Alias**: `PreImage`
- **Parameters (step 2)**: `book_name, book_fundingtype, book_startdate, book_enddate, statecode`
- **Parameters (step 4)**: `book_fundingevent, book_fund, book_pgsag, book_distributionpercentage, statecode`

### `Checkbook.Plugins.TurnIns.TurnInAmountCalculator`

Pre-op writer that keeps `book_afpamount` and `book_allotmentamount` in sync
with `book_newamount × current_pct` for **Kind A** Turn-Ins. Skips entirely when
`book_origin = Sweep` — the Generate Distributions sweep owns those values for
Kind B records.

| # | Message | Primary entity | Stage         | Mode        | Filtering attributes                                                                  | Notes |
|---|---------|----------------|---------------|-------------|----------------------------------------------------------------------------------------|-------|
| 1 | Create  | `book_turnin`  | Pre-Operation | Synchronous | *(none)*                                                                              | Initial AFP/Allotment computation. |
| 2 | Update  | `book_turnin`  | Pre-Operation | Synchronous | `book_newamount, book_fund, book_pg, book_fundcenter, book_origin`                    | Re-computes on any input change. **Requires PreImage.** |

**PreImage** on step 2:
- **Name** / **Entity Alias**: `PreImage`
- **Parameters**: `book_newamount, book_fund, book_pg, book_fundcenter, book_origin`

### `Checkbook.Plugins.Distributions.GenerateDistributionsPlugin`

Custom API handler `book_GenerateDistributions` — already registered. After
deploying this build, no step changes are required; behavior changes only:
- Existing-credit sums are now filtered by FundingType (no more AFP↔Allotment entanglement).
- Sweep Turn-Ins are now `Origin = Sweep` with per-type amounts on `book_afpamount` / `book_allotmentamount`.
- Open Sweep Turn-Ins decay as baseline catches up; deactivate when both type amounts hit 0.

---

## Verification checklist (financial flow)

- [ ] `book_turnin` has the three new columns (`book_origin`, `book_afpamount`, `book_allotmentamount`).
- [ ] **Plug-in:** `Checkbook.Plugins.Validation.FundingEventValidator`
  - [ ] Create + Update of `book_fundingevent` — Pre-Op Sync, Update has PreImage
  - [ ] Create + Update of `book_fundingdetails` — Pre-Op Sync, Update has PreImage
- [ ] **Plug-in:** `Checkbook.Plugins.TurnIns.TurnInAmountCalculator`
  - [ ] Create + Update of `book_turnin` — Pre-Op Sync, Update has PreImage

**Smoke tests** (run in the env after registration):

1. **Non-overlap (A)** — create a second active AFP Funding Event whose `[StartDate, EndDate]` intersects an existing AFP event's range; save should fail with "overlaps another active AFP event."
2. **Allotment ≤ AFP (B)** — set an Allotment Funding Detail to a pct > the AFP pct for the same (Fund, PG/SAG) in the same date range; save should fail naming the offending segment.
3. **Kind A AFP/Allotment calculation** — create a new state-submitted Turn-In (`Origin = State`) with TDP = $100, Fund/PG that has AFP pct = 50 and Allotment pct = 30 today; `book_afpamount` should auto-fill to $50, `book_allotmentamount` to $30.
4. **Kind A approval** — approve the Turn-In from (3); two Distribution pairs should appear (one AFP, one Allotment), each at the pre-computed amount with `book_fundingevent` populated so `book_fundingtype` resolves.
5. **Sweep overage detection** — invoke `book_GenerateDistributions` against a bucket whose existing AFP credits exceed target by $40; an `Origin = Sweep` Turn-In should appear with `book_afpamount = 40` and `book_allotmentamount = 0`.
6. **Sweep decay** — raise the AFP Funding Detail pct so target catches up to existing; re-run `book_GenerateDistributions`; the Sweep Turn-In's `book_afpamount` should drop. When it (and Allotment amount) reach 0, the Turn-In deactivates.

---

## Adding more plugins to this doc

When other plugin classes are wired into PRT, append a new `###` section under
**Steps to register** with the same table shape, then add a corresponding
bullet group to the verification checklist. Keep the table columns identical
so a reader can scan the whole doc top-to-bottom.
