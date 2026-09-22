# Spend Plan Lock — Maker Portal Setup

When the lock is **on**, users cannot create, change, or delete spend plan
rows. Only direct user writes are blocked — form saves, the Spend Plan PCF,
bulk edit, Excel imports, raw Web API calls. System-generated writes keep
running: the roll-up plugins that recompute `book_fundedamount`, the future
automated Actual process, and Turn-In / Realignment / State Swap cascades all
run under a parent context and pass through. When the lock is **off**, editing
is unrestricted (subject to the normal FY27 validators).

This mirrors the Funded Amount Lock feature — same toggle-button + env-var +
guard-plugin shape. See [`FundedAmountLock-Setup.md`](./FundedAmountLock-Setup.md).

Backend for this feature is in the Checkbook plugin project:

- `Plugins/Constants/EnvironmentVariableKeys.cs` — `LockSpendPlanEdits` key
- `Plugins/Validation/SpendPlanEditLockGuard.cs` — the edit-lock guard
- `Plugins/Admin/ToggleSpendPlanLockPlugin.cs` — the toggle Custom API
- `webresources/book_spendPlanLock.js` — the command bar button script
- `pcf/PrioritizationSpendPlanGrid` — reads the toggle and shows a banner /
  disables entry when locked (advisory; the guard is the real gate)

---

## 1. Names (source of truth)

| Concept | Value |
|---|---|
| Environment variable schema name | `book_LockSpendPlanEdits` |
| Environment variable display name | `ARNG Checkbook - Lock Spend Plan Edits` |
| Environment variable type | **Yes/No** (Boolean) |
| Environment variable default value | `false` (ship OFF; admin flips it on) |
| Custom API unique name | `book_ToggleSpendPlanLock` |
| Custom API display name | `Toggle Spend Plan Lock` |
| Custom API binding | **Global** (unbound) |
| Custom API IsFunction | **No** (action — has side effects) |
| Custom API IsPrivate | **No** |
| Custom API EnabledForWorkflow | **Yes** |
| Custom API AllowedCustomProcessingStepType | **None** (server enforces role internally) |
| Custom API plugin type | `Checkbook.Plugins.Admin.ToggleSpendPlanLockPlugin` |
| Custom API output param | `IsLocked` (Boolean) |
| Guard plugin type | `Checkbook.Plugins.Validation.SpendPlanEditLockGuard` |
| Guarded entity | `book_spendplan` (Create / Update / Delete) |
| Lock behavior | All direct user edits blocked; system writes pass |
| Authorized role for toggle | `Book - Checkbook Administrator` |
| Command web resource | `book_spendPlanLock` (source: `webresources/book_spendPlanLock.js`) |
| Command function | `SpendPlanLock.run` |

---

## 2. Environment variable — create in the Maker Portal

Solutions → **ARNGCheckbookExtensions** → New → More → **Environment variable**.

- **Display name:** `ARNG Checkbook - Lock Spend Plan Edits`
- **Name:** `book_LockSpendPlanEdits`
- **Data type:** Yes/No
- **Default value:** `No`
- **Current value:** leave blank on first import; the Custom API creates the
  value record on first press.

Description (paste verbatim — no apostrophes per the `no-apostrophes-in-solution-xml` rule):

> When Yes, blocks direct user create, update, and delete of spend plan rows.
> System-generated writes (roll-ups, the automated Actual process, Turn-In /
> Realignment / State Swap cascades) keep running. Toggle from the Admin Center
> via the Spend Plan Lock command bar button.

---

## 3. Deploy the plugin assembly

Register / update `Checkbook_Plugins.dll` with the Plugin Registration Tool.
New types in this build:

- `Checkbook.Plugins.Validation.SpendPlanEditLockGuard`
- `Checkbook.Plugins.Admin.ToggleSpendPlanLockPlugin`

---

## 4. Custom API — create `book_ToggleSpendPlanLock`

Solutions → New → More → **Custom API** (or PRT → Register New Custom API):

| Field | Value |
|---|---|
| Unique name | `book_ToggleSpendPlanLock` |
| Name | `book_ToggleSpendPlanLock` |
| Display name | `Toggle Spend Plan Lock` |
| Binding type | Global |
| Is function | No |
| Enabled for workflow | Yes |
| Allowed custom processing step type | None |
| Is private | No |
| Execute privilege name | *(leave empty — role check is inside the plugin)* |
| Plugin type | `Checkbook.Plugins.Admin.ToggleSpendPlanLockPlugin` |

Add **one response property**:

| Field | Value |
|---|---|
| Unique name | `IsLocked` |
| Name | `IsLocked` |
| Display name | `Is Locked` |
| Type | Boolean |

No request parameters.

---

## 5. Plugin step — register the guard

On the assembly, right-click `SpendPlanEditLockGuard` → **Register New Step**.
Register the **same step three times**, once per message:

| Field | Value |
|---|---|
| Message | `Create`, then `Update`, then `Delete` (one step each) |
| Primary Entity | `book_spendplan` |
| Filtering Attributes | *(none — leave all)* |
| Event Pipeline Stage | **Pre-Operation** |
| Execution Mode | Synchronous |
| Execution Order (Rank) | `5` (run before `SpendPlanFY27Validator`, rank 10-ish) |
| Deployment | Server |

No pre-image required — the guard reads `ParentContext` and the Target only.

> The guard exits immediately when `ParentContext` is present, so registering
> it does not interfere with roll-up / cascade writes even while locked.

---

## 6. Command bar button — Admin Center MDA

Same shape as the Funding Lock button (static label; state surfaced in the
confirm/alert dialogs because command labels cannot be dynamic).

### 6a. Register the web resource

Solutions → **ARNGCheckbookExtensions** → New → More → **Web resource**:

| Field | Value |
|---|---|
| Display name | `book_spendPlanLock` |
| Name | `book_spendPlanLock` |
| Type | JavaScript (JS) |
| Content | paste `webresources/book_spendPlanLock.js` |

Save + **Publish**.

### 6b. Add the command

Admin Center app → **Edit command bar** on the **Spend Plan** table → **Main
grid** → **New command**:

| Field | Value |
|---|---|
| Label | `Spend Plan Lock` |
| Icon | `LockSolid` (static) |
| Tooltip | `Lock or unlock all spend plan editing` |
| Action | **Run JavaScript** |
| Library | `book_spendPlanLock` |
| Function name | `SpendPlanLock.run` |
| Parameter 1 | **PrimaryControl** |
| Visibility | Show — Admin Center app access is the gate; the Custom API also rejects non-admins server-side |

**Save** and **Publish** the command bar.

---

## 7. Smoke test

1. Toggle OFF by default → a State user opens a final-approved FY27
   Prioritization and edits Planned months, saves. Should succeed.
2. In the Admin Center, press **Spend Plan Lock**. Confirm dialog reads
   "currently UNLOCKED" → confirm → alert "…now LOCKED…".
3. Repeat step 1 → save should fail with the guard message ("Spend plans are
   currently locked…"). The PCF also shows a lock banner and disables the
   Save button on next load.
4. Still locked: run a roll-up (e.g. change a PF funded amount / delete a PF
   row) so `SpendPlanStateRollup` rewrites `book_fundedamount`. Should succeed
   — system writes are exempt.
5. Press **Spend Plan Lock** again → "currently LOCKED" → confirm → back to
   step 1 behavior.
6. As a non-admin, press the button → Custom API rejects with the role error.

---

## 8. Notes and gotchas

- **Team-derived admin role** — the toggle uses `UserRoleHelper.HasAnyRole`,
  which unions direct + team-inherited role assignments. No extra setup.
- **System writes are exempt** — the guard allows any write with a non-null
  `ParentContext`. If a future automated Actual writer runs as a **top-level**
  Web API call (no parent context), it would be blocked while locked; run it as
  a plugin/flow, or add its message/entity to an authorized-ancestor check in
  `SpendPlanEditLockGuard` (mirror `FundedAmountLockBase.IsAuthorizedAncestor`).
- **Pure `book_fundedamount` updates pass** — a top-level Update that touches
  only the roll-up field (not the 12 month twins or the anchors) is allowed, so
  an async roll-up workflow is never caught by the lock.
- **Delete is always blocked while locked** — top-level deletes have no Target
  fields to inspect, so the lock stops them outright.
- **PCF is advisory** — the grid reads the env var to grey out entry and show a
  banner, but the plugin guard is the real enforcement (a user cannot bypass it
  by calling the Web API directly).
