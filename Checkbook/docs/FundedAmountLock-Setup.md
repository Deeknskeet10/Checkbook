# Funded Amount Lock — Maker Portal Setup

When the lock is on, NPMs and RIs cannot manually **reduce** a funded amount —
increases and unchanged saves always go through. Reductions must come from the
authorized tools (Turn-Ins, Realignments, State Swaps, the Distribution
generator) or the roll-up plugins that recompute funded totals. Five fields are
guarded, all under the single admin toggle `book_LockManualFundedEdits`:

| Field | Table | What it protects |
|---|---|---|
| `book_newfundedamount` | `book_requirementfunding` | **RF Funded Amount** — direct-funded RFs, plus the roll-up of child Prio / RD funding. |
| `book_fundedamount` | `book_prioritizationfunding` | **FY27 Prioritization funding** — the junction allocation edited in the PrioritizationFundingGrid. |
| `book_newfundedamounttdp` | `book_prioritization` | **Prio rolled-up Funded Amount (TDP)** — covers FY26 direct Prio-form edits and single-RF FY27 Prio-form edits. |
| `book_fundedamount` | `book_itemizeddetails` | **Itemized Detail funded** — the per-detail funded on an Itemized Prioritization. |
| `book_fundedamount` | `book_requirementdetailfunding` | **RD direct funding** — the RD↔RF junction allocation on a non-prioritized Requirement. |

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
- `Plugins/Validation/RequirementFundingFundedAmountLock.cs` — RF Funded Amount guard
- `Plugins/Validation/ItemizedDetailFundedAmountLock.cs` — Itemized Detail funded guard
- `Plugins/Validation/RequirementDetailFundingFundedAmountLock.cs` — RD funding junction guard
- `Plugins/Validation/PrioritizationFundingFundedAmountLock.cs` — FY27 junction guard
- `Plugins/Validation/PrioritizationFundedAmountLock.cs` — Prio rolled-up guard
- `Plugins/Admin/ToggleFundedAmountLockPlugin.cs` — the toggle Custom API
- `webresources/book_fundedAmountLock.js` — the command bar button script

This doc lists **every name you need** and the maker-portal steps that are not
doable from the repo — the environment variable, the Custom API metadata, the
guard plugin step registrations, and the command bar button.

> ### ⚠ RF TDP is not locked
> TDP on a Requirement Funding can be raised **or lowered** while the lock is
> on. A reduction is allowed as long as the Withholding covers it
> (Withholding = TDP − Funded Amount): `RequirementFundingTDPValidator` rejects
> any save where Funded Amount would exceed TDP. Funded Amount itself can only
> go up.

> ### ⚠ Migrating from the TDP-lock rollout (2026-10-14)
> The previous rollout guarded RF **TDP** (`book_newtdp`) via
> `RequirementFundingTDPLock`. That was too strict: the intent is that TDP may
> move up **or down** freely as long as Funded is untouched. That class has been
> **removed** — the RF guard is back on **Funded Amount**
> (`book_newfundedamount`) via `RequirementFundingFundedAmountLock`. TDP
> reductions are now bounded only by `RequirementFundingTDPValidator`
> (Funded ≤ TDP, i.e. Withholding = TDP − Funded cannot go negative).
> When you update the assembly:
> 1. **Un-register** the step on `RequirementFundingTDPLock`
>    (Update / `book_requirementfunding` / filter `book_newtdp`). Its plugin
>    type no longer exists in the DLL.
> 2. **Register** the `RequirementFundingFundedAmountLock` and
>    `RequirementDetailFundingFundedAmountLock` steps (§5).
>
> The Prioritization, junction, and Itemized Detail guards are unchanged.

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
| Guard plugin type (RF Funded) | `Checkbook.Plugins.Validation.RequirementFundingFundedAmountLock` |
| Locked field (RF Funded) | `book_newfundedamount` on `book_requirementfunding` (TDP is **not** locked) |
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

> When Yes, blocks direct manual reductions of Requirement Funding Funded Amount,
> the Requirement Detail Funding junction amount, the Itemized Detail funded amount,
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

- `Checkbook.Plugins.Validation.RequirementFundingFundedAmountLock`
- `Checkbook.Plugins.Validation.RequirementDetailFundingFundedAmountLock`
- `Checkbook.Plugins.Validation.PrioritizationFundingFundedAmountLock` (unchanged)
- `Checkbook.Plugins.Validation.PrioritizationFundedAmountLock` (unchanged)
- `Checkbook.Plugins.Validation.ItemizedDetailFundedAmountLock` (unchanged)
- `Checkbook.Plugins.Admin.ToggleFundedAmountLockPlugin` (unchanged)

(`FundedAmountLockBase` is abstract and never appears as a registrable type.
`RequirementFundingTDPLock` is **gone** — un-register its step per the
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

### `RequirementFundingFundedAmountLock`

Right-click the type → **Register New Step**:

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

### `RequirementDetailFundingFundedAmountLock`

Right-click the type → **Register New Step**:

| Field | Value |
|---|---|
| Message | `Update` |
| Primary Entity | `book_requirementdetailfunding` |
| Filtering Attributes | `book_fundedamount` |
| Event Pipeline Stage | **Pre-Operation** |
| Execution Mode | Synchronous |
| Execution Order (Rank) | `10` (run before `RequirementDetailFundingGuard`) |
| Deployment | Server |

Then on the new step → **Register New Image**:

| Field | Value |
|---|---|
| Image Type | Pre-Image |
| Name | `PreImage` |
| Entity Alias | `PreImage` |
| Attributes | `book_fundedamount` |

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
| Tooltip | `Lock or unlock direct reductions of Funded Amounts` |
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

1. Toggle is OFF by default → open a direct-funded Requirement Funding (no
   child Prios), lower Funded Amount, save. Should succeed.
2. In the Admin Center, press **Funding Lock**. Confirm dialog should read
   "currently UNLOCKED" → confirm → alert: "…now LOCKED…".
3. Repeat step 1 → save should fail with the guard's message
   ("Funded Amount cannot be reduced directly…"). **Raising** RF Funded
   Amount should succeed.
4. Still locked: on an RF with Withholding (TDP > Funded), **lower** TDP by
   no more than the Withholding and save. Should succeed. Lower it below
   Funded Amount → should fail with the `RequirementFundingTDPValidator`
   Funded-exceeds-TDP message. Raising TDP should always succeed.
5. Still locked: in the PrioritizationFundingGrid, lower a FY27 junction
   Funded Amount, save. Should fail ("Funded Amount cannot be reduced
   directly…"). Raising it should succeed.
6. Still locked: FY26 Prio (or single-RF FY27 Prio) — lower Funded Amount (TDP)
   on the Prio form, save. Should fail. Raising it should succeed.
6b. Still locked: on a non-prioritized Requirement, lower an RD funding row
    Funded Amount, save. Should fail ("Requirement Detail Funded Amount cannot
    be reduced directly…"). Raising it should succeed.
7. Run a Turn-In / Realignment / State Swap approval that lowers RF Funded or
   a junction amount. Should succeed (ancestor-walk detects the authorized
   parent).
8. Run `book_GenerateDistributions` (or trigger a distribution). Should
   succeed.
9. Still locked: pull a funded NPM-Review Prio back below NPM Review. Its
   junction rows deactivate (statecode change, not a `book_fundedamount`
   write), so the junction guard does not fire and the pull-back cleanup
   completes. The parent RF Funded Amount drops via the roll-up (Prio /
   junction ancestor → authorized).
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
- **RF TDP is free; RF Funded is locked** — TDP can move up or down under
  the lock. Lowering TDP only shrinks Withholding (TDP − Funded), and
  `RequirementFundingTDPValidator` already rejects Funded > TDP, so TDP can
  never drop below what is funded. An RF with child Prios can only give up
  Withholding through Realignments / Turn-Ins anyway.
- **RF Funded roll-up ancestors** — RF Funded is recomputed by
  `FundingRollupHelper.RecalculateRFFunded` from Prio, junction, and
  RD-funding writes, so the RF guard authorizes Create / Update / Delete on
  `book_prioritization`, `book_prioritizationfunding`, and
  `book_requirementdetailfunding` in the parent chain. Manual reductions at
  those sources are caught by their own guards (Prio, PF junction, RD
  funding junction).
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
- **History** — first rollout locked RF `book_newfundedamount`; 2026-09-27
  switched it to RF `book_newtdp` (too strict — blocked legitimate TDP
  trims out of Withholding); 2026-10-14 switched back to Funded Amount with
  TDP unlocked.
