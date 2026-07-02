# Implementation: Turn-In Approval Process (BPF replacement)

Replaces the Turn-In Business Process Flow with a field-bound PCF
(`book_ARNGCheckbook.TurnInApprovalProcess`) that renders a chevron
progress bar, gates Approve/Deny buttons on the user's security roles,
and writes `book_stateapproved` / `book_beapproved` directly. The
`TurnInValidator` plugin is the authoritative security boundary — the
PCF only mirrors it in the UI.

Shipped in `ARNGCheckbookExtensions_1.5.0.zip` (see `dist/`) and in the
`Checkbook_Plugins.dll` build from commit `289f244`.

## What the PCF renders

| Stage           | Shown when                                                    |
|-----------------|----------------------------------------------------------------|
| State Approval  | Always                                                        |
| BE Approval     | Only when `book_requiresbeapproval = Yes`                     |
| Approved        | Always (final)                                                |

Buttons visible for the current stage only:

- **State Approval stage** — `Approve — State` (writes `book_stateapproved = true`)
- **BE Approval stage** — `Approve — Budget Execution` and `Deny (return to State)` (writes `book_beapproved = true` or `book_stateapproved = false`)
- **Approved stage** — status text only

Approve buttons render disabled when the current user isn't in an allowed role.

## Role gating (mirrored PCF ↔ plugin)

| Transition              | Allowed roles                                                            |
|-------------------------|--------------------------------------------------------------------------|
| `book_stateapproved`    | `Book - State Approver`, `Book - State Administrator`, `Book - Checkbook Administrator` |
| `book_beapproved`       | `Book - Budget Executor`, `Book - Checkbook Administrator`               |

Enforcement lives in `TurnInValidator.EnforceApprovalRoles` — the PCF
disables the button, but the plugin also rejects a direct API write from
a user without the role. Role names come straight from
`src/ARNGCheckbook/Roles/*.xml`.

## Schema prerequisite

`book_turnin` must have the `book_requiresbeapproval` column already
(added for the previous ship). Two Options, default **Yes**. See the
"Schema additions required" table in `Plugins/PLUGIN-REGISTRATION.md`.

## Rollout steps (do these on Monday)

1. **Build fresh assets** (only needed if you're not deploying the
   committed zip / DLL directly):
   ```bash
   cd Plugins && dotnet build -c Release
   cd ../solution/ARNGCheckbookExtensions && dotnet build -c Release
   # zip lands at bin/Release/ARNGCheckbookExtensions.zip
   ```
   The committed `dist/ARNGCheckbookExtensions.zip` is already the
   1.5.0 build — you can deploy it as-is.

2. **Import the extension solution** into the target environment:
   `ARNGCheckbookExtensions_1.5.0.zip`. This registers the new PCF
   `book_ARNGCheckbook.TurnInApprovalProcess` alongside the existing
   Checkbook PCFs.

3. **Register the updated plugin assembly**:
   - Open the Plugin Registration Tool.
   - **Update Assembly** on the existing `Checkbook_Plugins.dll`
     registration; point at `Plugins/bin/Release/net462/Checkbook_Plugins.dll`.
   - No new steps to register — this build only changes
     `TurnInValidator`'s behavior; its existing step registration is
     unchanged.

4. **Update the Turn-In main form** in the maker portal:
   1. Open `book_turnin` main form in the form designer.
   2. Remove the BPF header bar (Form → Business Process Flow → remove
      the Turn-In BPF from this form).
   3. Locate the **Turn-In Name** (`book_name`) field. Drop the PCF
      onto it: **Components** → **Get more components** →
      `book_ARNGCheckbook.TurnInApprovalProcess` → **Add**. In the
      field properties, hide the label so the PCF fills the row.
   4. Optionally move the field to the top of the header section so
      the process bar sits where the BPF bar used to.
   5. **Save** and **Publish** the form.

5. **Deactivate the old BPF**:
   1. In the maker portal, open **Processes** → find `Turn-In
      Approval Process`.
   2. **Deactivate**.
   3. Optionally delete the `book_turninapprovalprocess` table (no
      other plugin/webresource/flow references it — grep-verified at
      commit time).

6. **Verify** (walk through each role):
   - `Book - State PM` and `Book - FC Reviewer` see the process bar
     but the Approve button is disabled (with the helper text).
   - `Book - State Approver` can approve; on approve the chevron
     advances and the BE stage is skipped if
     `book_requiresbeapproval = No`.
   - `Book - Budget Executor` can approve the BE stage when it appears;
     `Deny (return to State)` puts the record back into the State
     stage (this also triggers `TurnInDeactivator` if State is denied
     on a fully-approved record — that's out of scope for this bar,
     but harmless).
   - `Book - Checkbook Administrator` can approve both sides at any
     time.

## Rollback

- Re-activate the BPF from **Processes**.
- Remove the PCF from `book_name` in the form designer and republish.
- (Plugin) The role gating in `TurnInValidator` is behavior-only — if
  you need to roll it back you can either re-register an older
  `Checkbook_Plugins.dll` or comment out the `EnforceApprovalRoles`
  call in `TurnInValidator.ExecutePlugin`. No schema changes to undo.

## Known caveats

- **Zero-items Turn-Ins still blocked** — `TurnInValidator` line ~92
  rejects Turn-Ins with no items. AFP-only Turn-Ins (the reason
  `book_requiresbeapproval` exists in the first place) will still fail
  at approval time until that guard is relaxed. That's the next task
  in the queue, not part of this rollout.
- **`contextInfo.entityId`** — the PCF reads the current record id
  from `context.mode.contextInfo`, which is undocumented but widely
  used in Model-driven PCFs. If a future Dataverse update breaks it,
  swap to binding to `book_turninid` as a hidden field.
- **Role fetch failure** — if the roles WebAPI call fails, buttons
  render disabled (fail-closed). Plugin still enforces authoritatively.
