# Funded Amount (TDP) Lock — Maker Portal Setup

Backend for this feature is in the Checkbook plugin project:

- `Plugins/Helpers/EnvironmentVariableHelper.cs` — added `GetBool(...)` overload
- `Plugins/Validation/PrioritizationFundedAmountLock.cs` — the guard plugin
- `Plugins/Admin/ToggleFundedAmountLockPlugin.cs` — the toggle Custom API
- `webresources/book_fundedAmountLock.js` — the command bar button script

This doc lists **every name you need** and the maker-portal steps that are
not doable from the repo — the environment variable, the Custom API metadata,
the two plugin step registrations, and the command bar button.

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
| Guard plugin type | `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock` |
| Locked field | `book_newfundedamounttdp` on `book_prioritization` |
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

> When Yes, blocks direct edits to Prioritization Funded Amount (TDP). Users
> must change funding through Turn-Ins, Realignments, State Swaps, or the
> Distribution generator. Toggle from the Admin Center via the Lock/Unlock
> Funding command bar button.

---

## 3. Deploy the plugin assembly

Register `Plugins/bin/Debug/net462/Checkbook_Plugins.dll` (or Release, per your
usual workflow) with the Plugin Registration Tool if this is a fresh assembly.
If the assembly is already registered, just update it — both new types will
appear once you re-select the assembly:

- `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock`
- `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin`

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

## 5. Plugin step — register the guard

In the Plugin Registration Tool, on the assembly, right-click the
`PrioritizationFundedAmountLock` type → **Register New Step**:

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
| Tooltip | `Lock or unlock direct edits to Funded Amount (TDP)` |
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

1. Toggle is OFF by default → open a Prioritization, change Funded Amount
   (TDP) directly, save. Should succeed.
2. In the Admin Center, press **Funding Lock**. Confirm dialog should read
   "currently UNLOCKED" → confirm → alert: "…now LOCKED…".
3. Repeat step 1 → save should fail with the guard's message
   ("Funded Amount (TDP) can only be changed through Turn-Ins…").
4. Run a Turn-In / Realignment / State Swap approval that changes Funded
   Amount. Should succeed (ancestor-walk detects the authorized parent).
5. Run `book_GenerateDistributions` (or trigger a distribution). Should
   succeed.
6. Press **Funding Lock** again — confirm dialog should now read "currently
   LOCKED" → confirm → back to step 1 behavior.
7. As a non-admin, try to press the button. Custom API rejects with
   "You must have the 'Book - Checkbook Administrator' role…".

---

## 8. Notes and gotchas

- **Team-derived admin role** — the toggle uses `UserRoleHelper.HasAnyRole`
  which already unions direct + team-inherited role assignments (per the
  `pcf-role-query-team-derived` memory). No extra setup.
- **Quick create form** — the field is still enabled on the Prioritization
  quick create form (audit noted this). When the lock is on, quick-create
  saves that set the field will hit the guard's error. Consider disabling
  the field on the quick form too if you want a cleaner UX. Belt-and-
  suspenders only — not required for correctness.
- **Bulk edit** — model-driven bulk edit sends per-record Updates without a
  `ParentContext`. Under the lock they will fail one-by-one with the guard
  message. Intended behavior.
- **Excel / Dataflow imports** — same as bulk edit: no parent context, will
  be blocked when the lock is on. If you need a one-shot import while the
  lock is on, flip it off, run the import, flip it back on.
- **`book_GenerateDistributions` message name** — the guard's ancestor walk
  checks for that exact string. If you ever rename the Custom API, update
  `PrioritizationFundedAmountLock.IsInsideAuthorizedOperation`.
- **No manual float-twin handling** — the float `book_fundedamounttdp` was
  deleted in the maker portal, so the guard filters only the decimal
  `book_newfundedamounttdp`.
