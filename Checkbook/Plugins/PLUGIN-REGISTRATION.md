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

## Adding more plugins to this doc

When other plugin classes are wired into PRT, append a new `###` section under
**Steps to register** with the same table shape, then add a corresponding
bullet group to the verification checklist. Keep the table columns identical
so a reader can scan the whole doc top-to-bottom.
