# Implementation: Realignment Approval Process (BPF replacement)

Replaces the "Realignments - Review/Approve" Business Process Flow with a
field-bound PCF (`book_ARNGCheckbook.RealignmentApprovalProcess`) that renders
a shape-aware chevron progress bar, gates Approve/Deny buttons on the user's
security roles (scoped to the debiting state's business unit), and writes the
`book_newstateapproved` / `book_bedecision` choice fields directly. The
`RealignmentValidator` plugin is the authoritative security boundary — the PCF
only mirrors it in the UI. This is the direct sibling of the Turn-In and State
Swap approval PCFs (`IMPLEMENTATION-TurnInApprovalProcess.md`, `SCHEMA-StateSwap.md`).

Shipped in `ARNGCheckbookExtensions_1.9.0.zip` (see `dist/`) and in the
`Checkbook_Plugins.dll` build from this commit.

## Why

The old flow drove approval through a BPF + two real-time business rules +
two secured choice fields. `RealignmentValidator` only checked that the *right
approval was present for the record's shape* — it never checked **who** was
approving, recorded no approved-by/on, and had no deny-with-reason. Anyone with
field access could flip the choice field and move money. This ports the
State-Swap control model onto Realignments.

## What the PCF renders (three shapes)

The PCF reads `book_samefundandsag` plus whether the debit/credit
Prioritizations are set, and renders the chevron set for the shape — the same
three paths the BPF encoded:

| Shape | Detection | Chevrons |
|---|---|---|
| Prior→Prior, **same** Fund/SAG | both prios set, `book_samefundandsag = Yes` | **State Approval → Approved** (State is terminal) |
| Prior→Prior, **cross** Fund/SAG | both prios set, `book_samefundandsag = No` | **State Approval → NPM Concurrence → BE Approval → Approved** |
| RF→RF | no prios | **NPM Concurrence → BE Approval → Approved** |

**NPM Concurrence is a *soft* stage.** There are no dedicated NPM contacts yet,
so it has no approval field of its own. A State approver **cannot** advance the
record past it — after State Approval the record parks at NPM Concurrence, and
**only a Budget Executor can move it forward** (BE Approval clears both NPM
Concurrence and BE Approval together). The `book_payerconcurrence` /
`book_payeeconcurrence` fields stay on the form (editable, non-gating) for when
NPM contacts are established.

Buttons visible for the active stage only:

- **State Approval stage** — `Approve — State` (writes `book_newstateapproved = Approved`) and `Deny`.
- **NPM Concurrence / BE Approval stage** — `Approve — Budget Execution` (writes `book_bedecision = Approved`) and `Deny`.
- **Approved stage** — status text only.

Deny writes the active stage's choice field = `Denied` plus `book_denialreason`.
On denial the `RealignmentProcessor` deactivates the record — denial is
terminal (create a new Realignment to retry). This differs from State Swaps,
whose denial resets the flags for revision.

## Role gating (mirrored PCF ↔ plugin)

| Stage action | Allowed roles | Extra scope |
|---|---|---|
| `book_newstateapproved` (approve or deny) | `Book - State Approver`, `Book - State Administrator`, `Book - Checkbook Administrator` | Non-admins must belong to the **debiting state's** BU (Prio → `book_state` → owning BU), via `StateScopeHelper.IsUserInStateBU` |
| `book_bedecision` (approve or deny) | `Book - Budget Executor`, `Book - Checkbook Administrator` | — |

Enforcement lives in `RealignmentValidator.EnforceApprovalRoles` — the PCF
disables the button, but the plugin also rejects a direct API write from a user
without the role/scope. The validator additionally **stamps** the audit fields
on each approval transition. Role names come straight from
`src/ARNGCheckbook/Roles/*.xml`.

## Schema additions required (maker portal — cannot be built from repo)

Add these columns to `book_realignments` before importing/registering:

| Logical name | Type | Notes |
|---|---|---|
| `book_newstateapprovedby` | Lookup → `systemuser` | Plugin-set on State approval transition |
| `book_newstateapprovedon` | Date/Time | Plugin-set on State approval transition |
| `book_bedecisionby` | Lookup → `systemuser` | Plugin-set on BE approval transition |
| `book_bedecisionon` | Date/Time | Plugin-set on BE approval transition |
| `book_denialreason` | Multiple Lines of Text (2000) | Written by the PCF on deny |

No new booleans — the existing `book_newstateapproved` / `book_bedecision`
choice fields are retained (their `Approved` / `Denied` values are unchanged).
Follow the no-apostrophes rule for any labels/descriptions.

> **Confirm the choice values.** The PCF and plugin assume
> `Approved = 0`, `Denied = 1` (per `RealignmentBEDecisionValues` in
> `Plugins/Constants/OptionSetValues.cs`, which flags them as env-unconfirmed).
> If the `book_approvals` option set uses 100000000-based values, update both
> `RealignmentBEDecisionValues` (plugin) and the `APPROVED_VALUE`/`DENIED_VALUE`
> constants in `RealignmentApprovalProcessApp.tsx`.

## Rollout steps

1. **Build fresh assets** (only if not deploying the committed zip/DLL):
   ```bash
   cd Plugins && dotnet build -c Release
   cd ../solution/ARNGCheckbookExtensions && dotnet build -c Release
   # zip lands at bin/Release/ARNGCheckbookExtensions.zip
   ```
   The committed `dist/ARNGCheckbookExtensions.zip` is already the 1.9.0 build.

2. **Add the 5 columns** to `book_realignments` (table above).

3. **Import the extension solution** (`ARNGCheckbookExtensions_1.9.0.zip`). This
   registers `book_ARNGCheckbook.RealignmentApprovalProcess` alongside the other
   Checkbook PCFs.

4. **Register the updated plugin assembly**:
   - Plugin Registration Tool → **Update Assembly** on the existing
     `Checkbook_Plugins.dll`, pointing at
     `Plugins/bin/Release/net462/Checkbook_Plugins.dll`.
   - **No new steps** — this build only changes `RealignmentValidator`'s
     behavior; its existing Update step (filter `book_newstateapproved,
     book_bedecision`) is unchanged. The debit-prio → state read is a live
     Retrieve, so no pre-image change is needed.

5. **Update the Realignment main form** in the maker portal:
   1. Open `book_realignments` main form in the form designer.
   2. Remove the BPF header bar (remove "Realignments - Review/Approve" from
      this form).
   3. Drop the PCF onto the **Realignment Name** (`book_name`) field:
      **Components → Get more components →
      `book_ARNGCheckbook.RealignmentApprovalProcess` → Add**. Hide the label so
      the PCF fills the row; move it to the top of the header.
   4. Add the new audit fields (`book_newstateapprovedby/on`,
      `book_bedecisionby/on`, `book_denialreason`) as **read-only** in a details
      section. Keep `book_payerconcurrence` / `book_payeeconcurrence` visible.
   5. **Save** and **Publish**.

6. **Retire the old processes**:
   1. **Processes** → deactivate the BPF **Realignments - Review/Approve**
      (optionally delete the `book_realignmentsreview` backing table — no other
      plugin/webresource/flow references it).
   2. Deactivate the two real-time business rules **Realignments -
      SetStateApproval** and **Realignments - LockSameSAGFundField**.
      `SetSameFundSagFlagPlugin` already sets `book_samefundandsag` server-side
      on every save, and the PCF drives approvals, so both rules are redundant.
      **Verify** `SetSameFundSagFlagPlugin` covers everything `SetStateApproval`
      did before deleting it.

7. **Verify** (walk through each shape/role):
   - Wrong-BU `Book - State Approver` sees the bar but `Approve — State` is
     disabled (helper text); correct-BU approver can approve.
   - **Cross-Fund/SAG Prior→Prior:** State approves → parks at NPM Concurrence;
     State **cannot** finalize; `Book - Budget Executor` approves BE → ledger
     pair + round-trip Distributions created, LOAs recalculated, record
     deactivated. `book_newstateapprovedby/on` and `book_bedecisionby/on` are
     stamped.
   - **Same-Fund/SAG Prior→Prior:** State Approve is terminal (no BE chevron).
   - **RF→RF:** no State chevron; BE approves.
   - **Deny** at any stage records `book_denialreason` and deactivates.
   - `Book - Checkbook Administrator` can act on both sides, any state.

## Rollback

- Re-activate the BPF and the two business rules from **Processes**.
- Remove the PCF from `book_name` in the form designer and republish.
- (Plugin) The role gating + stamping in `RealignmentValidator` is
  behavior-only — re-register an older `Checkbook_Plugins.dll`, or comment out
  the `EnforceApprovalRoles` call and the `StampApproval` calls. The 5 new
  columns can stay (harmless if unused).

## Known caveats

- **Choice values assumed 0/1** — see the confirm note above.
- **`contextInfo.entityId`** — the PCF reads the current record id from
  `context.mode.contextInfo` (undocumented but widely used). If a future
  Dataverse update breaks it, bind to `book_realignmentsid` as a hidden field.
- **Role/BU fetch failure** — if the roles/BU WebAPI calls fail, buttons render
  disabled (fail-closed). The plugin still enforces authoritatively.
- **State approval on an RF→RF shape** — anomalous (the PCF never offers it).
  If forced via a direct write, the validator requires the State role but skips
  BU scope because there is no debiting Prio to resolve a state from.
