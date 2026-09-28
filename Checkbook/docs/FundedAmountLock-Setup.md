# Funded Amount / TDP Lock — Maker Portal Setup

When the lock is on, NPMs and RIs cannot manually **reduce** a protected amount —
increases and unchanged saves always go through. Reductions must come from the
authorized tools (Turn-Ins, Realignments, State Swaps, the Distribution
generator) or the roll-up plugins that recompute funded totals. Three fields are
guarded, all under the single admin toggle `book_LockManualFundedEdits`:

| Field | Table | What it protects |
|---|---|---|
| `book_newtdp` | `book_requirementfunding` | **RF TDP** — the top-line allocation on a Requirement Funding. |
| `book_fundedamount` | `book_prioritizationfunding` | **FY27 Prioritization funding** — the junction allocation edited in the PrioritizationFundingGrid. |
| `book_newfundedamounttdp` | `book_prioritization` | **Prio rolled-up Funded Amount (TDP)** — covers FY26 direct Prio-form edits and single-RF FY27 Prio-form edits. |

> **Why two Prioritization guards?** For FY27+, a Prio's funding physically
> lives on the `book_prioritizationfunding` junction and rolls **up** to
> `book_prioritization.book_newfundedamounttdp`. The Prio-level guard authorizes
> the junction as a roll-up ancestor, so it cannot see a reduction made directly
> on the junction (the normal FY27 grid path) — that has to be blocked at the
> source by the junction guard. The Prio-level guard still catches FY26 direct
> edits and single-RF FY27 Prio-form edits, so both are kept.

Backend for this feature is in the Checkbook plugin project:

- `Plugins/Helpers/EnvironmentVariableHelper.cs` — `GetBool(...)` overload
- `Plugins/Validation/FundedAmountLockBase.cs` — shared reduction-lock logic
- `Plugins/Validation/RequirementFundingTDPLock.cs` — RF TDP guard
- `Plugins/Validation/PrioritizationFundingFundedAmountLock.cs` — FY27 junction guard
- `Plugins/Validation/PrioritizationFundedAmountLock.cs` — Prio rolled-up guard
- `Plugins/Admin/ToggleFundedAmountLockPlugin.cs` — the toggle Custom API
- `webresources/book_fundedAmountLock.js` — the command bar button script

This doc lists **every name you need** and the maker-portal steps that are not
doable from the repo — the environment variable, the Custom API metadata, the
guard plugin step registrations, and the command bar button.

> ### ⚠ Migrating from the first rollout
> The original rollout guarded RF **Funded Amount** (`book_newfundedamount`) via
> a class named `RequirementFundingFundedAmountLock`. That class has been
> **removed** — the RF guard now targets **TDP** (`book_newtdp`) via
> `RequirementFundingTDPLock`. When you update the assembly:
> 1. **Un-register** the old step on `RequirementFundingFundedAmountLock`
>    (Update / `book_requirementfunding` / filter `book_newfundedamount`). Its
>    plugin type no longer exists in the DLL.
> 2. **Register** the new `RequirementFundingTDPLock` step (§5) and the new
>    `PrioritizationFundingFundedAmountLock` step (§5).
>
> The `PrioritizationFundedAmountLock` step is unchanged — leave it as-is.

---

## 1. Names (source of truth)

| Concept | Value |
|---|---|
| Environment variable schema name | `book_LockManualFundedEdits` |
| Environment variable display name | `ARNG Checkbook - Lock Manual Funded Amount Edits` |
| Environment variable type | **Yes/No** (Boolean, type code `100000002`) |
| Environment variable default value | `false` (ship OFF; admin flips it on) |
| Custom API unique name | `book_ToggleFundedAmountLock` |
| Custom API display name | `Toggle Funded Amount Lock` |
| Custom API binding | **Global** (unbound) |
| Custom API IsFunction | **No** (this is an action — has side effects) |
| Custom API IsPrivate | **No** |
| Custom API EnabledForWorkflow | **Yes** (so you can call from Power Fx / flows) |
| Custom API AllowedCustomProcessingStepType | **None** (server enforces role internally) |
| Custom API plugin type | `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin` |
| Custom API output param | `IsLocked` (Boolean) |
| Guard plugin type (RF TDP) | `Checkbook.Plugins.Validation.RequirementFundingTDPLock` |
| Locked field (RF TDP) | `book_newtdp` on `book_requirementfunding` |
| Guard plugin type (FY27 junction) | `Checkbook.Plugins.Validation.PrioritizationFundingFundedAmountLock` |
| Locked field (FY27 junction) | `book_fundedamount` on `book_prioritizationfunding` |
| Guard plugin type (Prio rolled-up) | `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock` |
| Locked field (Prio rolled-up) | `book_newfundedamounttdp` on `book_prioritization` |
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

> When Yes, blocks direct manual reductions of Requirement Funding TDP,
> the FY27 Prioritization Funding junction amount, and the Prioritization
> rolled-up Funded Amount (TDP). Increases are always allowed; reductions must
> come through Turn-Ins, Realignments, State Swaps, or the Distribution
> generator. Toggle from the Admin Center via the Lock/Unlock Funding command
> bar button.

If the variable already exists from the first rollout, just update its
description — the schema name and type are unchanged.

---

## 3. Deploy the plugin assembly

Register `Plugins/bin/Debug/net462/Checkbook_Plugins.dll` (or Release, per your
usual workflow) with the Plugin Registration Tool if this is a fresh assembly.
If the assembly is already registered, just update it — the new types will
appear once you re-select the assembly:

- `Checkbook.Plugins.Validation.RequirementFundingTDPLock`
- `Checkbook.Plugins.Validation.PrioritizationFundingFundedAmountLock`
- `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock` (unchanged)
- `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin` (unchanged)

(`FundedAmountLockBase` is abstract and never appears as a registrable type.
`RequirementFundingFundedAmountLock` is **gone** — un-register its step per the
migration box above.)

---

## 4. Custom API — create `book_ToggleFundedAmountLock`

Unchanged from the first rollout. Two ways to do this; pick whichever you
already use for `book_GenerateDistributions`:

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

### `RequirementFundingTDPLock`

Right-click the type → **Register New Step**:

| Field | Value |
|---|---|
| Message | `Update` |
| Primary Entity | `book_requirementfunding` |
| Filtering Attributes | `book_newtdp` |
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
| Attributes | `book_newtdp` |

### `PrioritizationFundingFundedAmountLock`

Right-click the type → **Register New Step**:

| Field | Value |
|---|---|
| Message | `Update` |
| Primary Entity | `book_prioritizationfunding` |
| Filtering Attributes | `book_fundedamount` |
| Event Pipeline Stage | **Pre-Operation** |
| Execution Mode | Synchronous |
| Execution Order (Rank) | `10` (run before `PrioritizationFundingGuard`) |
| Deployment | Server |

Then on the new step → **Register New Image**:

| Field | Value |
|---|---|
| Image Type | Pre-Image |
| Name | `PreImage` |
| Entity Alias | `PreImage` |
| Attributes | `book_fundedamount` |

### `PrioritizationFundedAmountLock` (unchanged — skip if already registered)

| Field | Value |
|---|---|
| Message | `Update` |
| Primary Entity | `book_prioritization` |
| Filtering Attributes | `book_newfundedamounttdp` |
| Event Pipeline Stage | **Pre-Operation** |
| Execution Mode | Synchronous |
| Execution Order (Rank) | `10` |
| Deployment | Server |
| Pre-Image | `PreImage` — `book_newfundedamounttdp` |

---

## 6. Command bar button — Admin Center MDA

Unchanged from the first rollout.

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
| Tooltip | `Lock or unlock direct reductions of Funded Amount / TDP` |
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

1. Toggle is OFF by default → open a Requirement Funding, lower TDP directly,
   save. Should succeed.
2. In the Admin Center, press **Funding Lock**. Confirm dialog should read
   "currently UNLOCKED" → confirm → alert: "…now LOCKED…".
3. Repeat step 1 → save should fail with the guard's message
   ("TDP cannot be reduced directly…").
4. Still locked: **raise** RF TDP and save. Should succeed — only reductions
   are blocked. Saving the form without touching TDP should also succeed.
5. Still locked: in the PrioritizationFundingGrid, lower a FY27 junction
   Funded Amount, save. Should fail ("Funded Amount cannot be reduced
   directly…"). Raising it should succeed.
6. Still locked: FY26 Prio (or single-RF FY27 Prio) — lower Funded Amount (TDP)
   on the Prio form, save. Should fail. Raising it should succeed.
7. Run a Turn-In / Realignment / State Swap approval that lowers RF TDP or a
   junction amount. Should succeed (ancestor-walk detects the authorized
   parent).
8. Run `book_GenerateDistributions` (or trigger a distribution). Should
   succeed.
9. Still locked: pull a funded NPM-Review Prio back below NPM Review. Its
   junction rows deactivate (statecode change, not a `book_fundedamount`
   write), so the junction guard does not fire and the pull-back cleanup
   completes.
10. Press **Funding Lock** again — confirm dialog should now read "currently
    LOCKED" → confirm → back to step 1 behavior.
11. As a non-admin, try to press the button. Custom API rejects with
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
- **RF TDP is top-down** — TDP is allocated to an RF from its LOA and is never
  rolled up from child Prioritizations, so the RF TDP guard needs no roll-up
  source ancestors: only the four funding tools (which move TDP between
  RFs/LOAs and run with their orchestrator Update in the parent chain) are
  authorized, all via the base class.
- **Junction amount is a leaf** — nothing rolls up into
  `book_prioritizationfunding.book_fundedamount`, so its guard likewise needs
  no extra ancestors. Realignment / Turn-In / State Swap / Distribution writes
  to the junction all run under an authorized orchestrator ancestor.
- **Two Prio guards, one write each** — a junction edit fires only the junction
  guard (the Prio rolled-up recompute runs under the junction Update ancestor →
  authorized). A FY26 / single-RF Prio-form edit fires only the Prio rolled-up
  guard. They never both bite one save.
- **Bulk edit / Excel / Dataflow imports** — no `ParentContext`, so reductions
  are blocked one-by-one when the lock is on. For a one-shot corrective import,
  flip the lock off, run it, flip it back on.
- **`book_GenerateDistributions` message name** — the ancestor walk checks for
  that exact string. If you ever rename the Custom API, update
  `FundedAmountLockBase.IsAuthorizedAncestor`.
- **RF Funded Amount is no longer guarded** — the first rollout locked
  `book_newfundedamount`; that guard was retired in favor of the TDP guard.
  RF Funded Amount is a roll-up of child Prio funding, so it is protected
  indirectly by the two Prioritization guards.
