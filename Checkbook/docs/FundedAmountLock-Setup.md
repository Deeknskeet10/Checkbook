# Funded Amount Lock — Maker Portal Setup

When the lock is on, users cannot manually **reduce** a funded amount —
increases and unchanged saves always go through. Reductions must come from
the authorized tools (Turn-Ins, Realignments, State Swaps, the Distribution
generator) or the roll-up plugins that recompute funded totals. Two fields
are guarded:

- `book_prioritization.book_newfundedamounttdp` — Funded Amount (TDP)
- `book_requirementfunding.book_newfundedamount` — Funded Amount

Backend for this feature is in the Checkbook plugin project:

- `Plugins/Helpers/EnvironmentVariableHelper.cs` — added `GetBool(...)` overload
- `Plugins/Validation/FundedAmountLockBase.cs` — shared reduction-lock logic
- `Plugins/Validation/PrioritizationFundedAmountLock.cs` — Prioritization guard
- `Plugins/Validation/RequirementFundingFundedAmountLock.cs` — Requirement Funding guard
- `Plugins/Admin/ToggleFundedAmountLockPlugin.cs` — the toggle Custom API
- `webresources/book_fundedAmountLock.js` — the command bar button script

This doc lists **every name you need** and the maker-portal steps that are
not doable from the repo — the environment variable, the Custom API metadata,
the guard plugin step registrations, and the command bar button.

---

## 1. Names (source of truth)

| Concept | Value |
|---|---|
| Environment variable schema name | `book_LockManualFundedEdits` |
| Environment variable display name | `ARNG Checkbook - Lock Manual Funded Amount Edits` |
| Environment variable type | **Yes/No** (Boolean, type code `100000002`) |
| Environment variable default value | `false` (ship OFF; admin flips it on) |
| Custom API unique name | `book_ToggleFundedAmountLock` |
| Custom API name | `book_ToggleFundedAmountLock` |
| Custom API display name | `Toggle Funded Amount Lock` |
| Custom API binding | **Global** (unbound) |
| Custom API IsFunction | **No** (this is an action — has side effects) |
| Custom API IsPrivate | **No** |
| Custom API EnabledForWorkflow | **Yes** (so you can call from Power Fx / flows) |
| Custom API AllowedCustomProcessingStepType | **None** (server enforces role internally) |
| Custom API plugin type | `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin` |
| Custom API output param | `IsLocked` (Boolean) |
| Guard plugin type (Prioritization) | `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock` |
| Locked field (Prioritization) | `book_newfundedamounttdp` on `book_prioritization` |
| Guard plugin type (Requirement Funding) | `Checkbook.Plugins.Validation.RequirementFundingFundedAmountLock` |
| Locked field (Requirement Funding) | `book_newfundedamount` on `book_requirementfunding` |
| Lock behavior | Reductions blocked; increases and no-op saves allowed |
| Authorized role for toggle | `Book - Checkbook Administrator` |
| Command web resource | `book_fundedAmountLock` (source: `webresources/book_fundedAmountLock.js`) |
| Command function | `FundedAmountLock.run` |

---

## 2. Environment variable — create in the Maker Portal

Solutions → **ARNGCheckbookExtensions** (or whichever solution you deliver
with) → New → More → **Environment variable**.

- **Display name:** `ARNG Checkbook - Lock Manual Funded Amount Edits`
- **Name:** `book_LockManualFundedEdits`
- **Data type:** Yes/No
- **Default value:** `No`
- **Current value:** leave blank on first import; the Custom API will create
  the value record on first press.

Description (paste verbatim — no apostrophes per the `no-apostrophes-in-solution-xml` memory):

> When Yes, blocks direct reductions of Prioritization Funded Amount (TDP)
> and Requirement Funding Funded Amount. Increases are always allowed;
> reductions must come through Turn-Ins, Realignments, State Swaps, or the
> Distribution generator. Toggle from the Admin Center via the Lock/Unlock
> Funding command bar button.

If the variable already exists from the first rollout, just update its
description — the schema name and type are unchanged.

---

## 3. Deploy the plugin assembly

Register `Plugins/bin/Debug/net462/Checkbook_Plugins.dll` (or Release, per your
usual workflow) with the Plugin Registration Tool if this is a fresh assembly.
If the assembly is already registered, just update it — the new types will
appear once you re-select the assembly:

- `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock`
- `Checkbook.Plugins.Validation.RequirementFundingFundedAmountLock`
- `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin`

(`FundedAmountLockBase` is abstract and never appears as a registrable type.)
The Prioritization guard keeps its original type name, so an environment with
the first rollout only needs the assembly **updated** — its existing step and
pre-image stay valid; the reduction-only behavior ships with the DLL.

---

## 4. Custom API — create `book_ToggleFundedAmountLock`

Two ways to do this; pick whichever you already use for `book_GenerateDistributions`:

**Option A — Maker Portal (Solutions → New → More → Custom API):**

| Field | Value |
|---|---|
| Unique name | `book_ToggleFundedAmountLock` |
| Name | `book_ToggleFundedAmountLock` |
| Display name | `Toggle Funded Amount Lock` |
| Binding type | Global |
| Bound entity logical name | *(leave empty)* |
| Is function | No |
| Enabled for workflow | Yes |
| Allowed custom processing step type | None |
| Is private | No |
| Execute privilege name | *(leave empty — role check is inside the plugin)* |
| Plugin type | `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin` |

Then add **one response property** on the Custom API:

| Field | Value |
|---|---|
| Unique name | `IsLocked` |
| Name | `IsLocked` |
| Display name | `Is Locked` |
| Type | Boolean |
| Logical entity name | *(empty)* |

No request parameters.

**Option B — Plugin Registration Tool → Register New Custom API.** Same
values as above.

---

## 5. Plugin steps — register the guards

In the Plugin Registration Tool, on the assembly, right-click the
`PrioritizationFundedAmountLock` type → **Register New Step** (skip if the
step already exists from the first rollout):

| Field | Value |
|---|---|
| Message | `Update` |
| Primary Entity | `book_prioritization` |
| Filtering Attributes | `book_newfundedamounttdp` |
| Event Pipeline Stage | **Pre-Operation** |
| Execution Mode | Synchronous |
| Execution Order (Rank) | `10` (run before other PreOp plugins) |
| Deployment | Server |

Then on the new step → **Register New Image**:

| Field | Value |
|---|---|
| Image Type | Pre-Image |
| Name | `PreImage` |
| Entity Alias | `PreImage` |
| Attributes | `book_newfundedamounttdp` |

Repeat for the `RequirementFundingFundedAmountLock` type → **Register New
Step**:

| Field | Value |
|---|---|
| Message | `Update` |
| Primary Entity | `book_requirementfunding` |
| Filtering Attributes | `book_newfundedamount` |
| Event Pipeline Stage | **Pre-Operation** |
| Execution Mode | Synchronous |
| Execution Order (Rank) | `10` (run before `RequirementFundingTDPValidator`) |
| Deployment | Server |

Then on the new step → **Register New Image**:

| Field | Value |
|---|---|
| Image Type | Pre-Image |
| Name | `PreImage` |
| Entity Alias | `PreImage` |
| Attributes | `book_newfundedamount` |

---

## 6. Command bar button — Admin Center MDA

> Modern command bar buttons have a **static** Label and Icon (no Power Fx
> binding), and commanding Power Fx cannot call unbound Custom APIs. So this
> is one static button whose **Run JavaScript** action reads the current
> state, confirms, calls the Custom API, and reports the new state — same
> pattern as the Generate Distributions button
> (`webresources/book_generateDistributions.js`).

### 6a. Register the web resource

Solutions → **ARNGCheckbookExtensions** → New → More → **Web resource**:

| Field | Value |
|---|---|
| Display name | `book_fundedAmountLock` |
| Name | `book_fundedAmountLock` |
| Type | JavaScript (JS) |
| Content | paste `webresources/book_fundedAmountLock.js` |

Save + **Publish**.

### 6b. Add the command

Open the Admin Center app (`book_ARNGCheckbookAdminCenter`) → **Edit command
bar** on the **Prioritization** table → **Main grid** → **New command**:

| Field | Value |
|---|---|
| Label | `Funding Lock` |
| Icon | `LockSolid` (static — pick from the icon library) |
| Tooltip | `Lock or unlock direct reductions of Funded Amount` |
| Action | **Run JavaScript** |
| Library | `book_fundedAmountLock` |
| Function name | `FundedAmountLock.run` |
| Parameter 1 | **PrimaryControl** |
| Visibility | Show — Admin Center app access is the gate; the Custom API also rejects non-admins server-side |

**Save** and **Publish** the command bar.

The button behavior: press → confirm dialog states the *current* lock state
("currently UNLOCKED — lock them?") → on confirm, calls
`book_ToggleFundedAmountLock` → alert dialog reports the new state from the
API's `IsLocked` response and refreshes the grid.

---

## 7. Smoke test

1. Toggle is OFF by default → open a Prioritization, lower Funded Amount
   (TDP) directly, save. Should succeed.
2. In the Admin Center, press **Funding Lock**. Confirm dialog should read
   "currently UNLOCKED" → confirm → alert: "…now LOCKED…".
3. Repeat step 1 → save should fail with the guard's message
   ("Funded Amount (TDP) cannot be reduced directly…").
4. Still locked: **raise** Funded Amount (TDP) and save. Should succeed —
   only reductions are blocked. Saving the form without touching the field
   should also succeed.
5. Still locked: open a Requirement Funding record, lower Funded Amount,
   save. Should fail with the same style of message. Raising it should
   succeed.
6. Run a Turn-In / Realignment / State Swap approval that lowers Funded
   Amount. Should succeed (ancestor-walk detects the authorized parent).
7. Run `book_GenerateDistributions` (or trigger a distribution). Should
   succeed.
8. Still locked: delete a Prioritization Funding row or an Itemized Details
   row under a Prioritization, and delete an RD funding row under an RF.
   The roll-ups should lower the parent funded amounts without being blocked
   (roll-up source entities are authorized ancestors).
9. Press **Funding Lock** again — confirm dialog should now read "currently
   LOCKED" → confirm → back to step 1 behavior.
10. As a non-admin, try to press the button. Custom API rejects with
    "You must have the 'Book - Checkbook Administrator' role…".

---

## 8. Notes and gotchas

- **Team-derived admin role** — the toggle uses `UserRoleHelper.HasAnyRole`
  which already unions direct + team-inherited role assignments (per the
  `pcf-role-query-team-derived` memory). No extra setup.
- **Reductions only** — the guards never block increases or unchanged saves,
  so form save-all payloads and quick-create saves that merely include the
  field pass through. Only a value strictly lower than the stored value is
  checked. Clearing the field counts as reducing it to 0.
- **Create is not guarded** — a brand-new record has no stored value to
  reduce, so Create passes. The guards register on Update only.
- **Roll-ups stay live under the lock** — deleting or editing a
  Prioritization Funding row, an Itemized Details row, an RD funding row, or
  a Prioritization itself will still lower the parent roll-up totals. The
  guards authorize those writes by their ancestor entity
  (`book_prioritizationfunding` / `book_itemizeddetails` for the Prio guard;
  `book_prioritization` / `book_requirementdetailfunding` for the RF guard).
  If a new roll-up writer is ever added, add its trigger entity to the
  matching guard's `IsAuthorizedAncestor` override.
- **Bulk edit** — model-driven bulk edit sends per-record Updates without a
  `ParentContext`. Under the lock, rows whose new value is lower will fail
  one-by-one with the guard message. Intended behavior.
- **Excel / Dataflow imports** — same as bulk edit: no parent context, so
  reductions will be blocked when the lock is on. If you need a one-shot
  corrective import while the lock is on, flip it off, run the import, flip
  it back on.
- **`book_GenerateDistributions` message name** — the ancestor walk checks
  for that exact string. If you ever rename the Custom API, update
  `FundedAmountLockBase.IsAuthorizedAncestor`.
- **No manual float-twin handling** — the float `book_fundedamounttdp` was
  deleted in the maker portal, so the Prio guard filters only the decimal
  `book_newfundedamounttdp`; the RF guard likewise filters only
  `book_newfundedamount`.
