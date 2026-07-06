# Schema — State Swap (FY26)

Cross-state fund exchange between two states, mirrored on the Turn-In /
Realignment approval flow. Two new tables, a small additive change to
`book_ledger`, one new option-set value, and role-team sharing.

FY27 LOA divergence is **not** in scope for this document — the plugin
layer will isolate that behind a `SwapLOAResolver` helper later.

---

## 1. `book_stateswap` (new entity)

Parent record representing an agreed exchange between two states.

**Ownership model:** User-owned (not team-owned), so the initiating
State user owns the record. Owning BU flows from the user, giving StateA
users implicit access under the standard User-scope security. StateB
access is granted via sharing (see §5).

**Publisher:** `book` (main solution).

### Attributes

| Logical name | Type | Required | Description |
|---|---|---|---|
| `book_stateswapid` | Uniqueidentifier | System | Primary key |
| `book_name` | Single Line of Text (100) | System | Primary field. Auto-populated by workflow / plugin as `SWAP-{StateA.abbr}-{StateB.abbr}-{seq}`. Do not require on form. |
| `book_statea` | Lookup → `book_state` | Business Recommended | Initiating state |
| `book_stateb` | Lookup → `book_state` | Business Recommended | Counterparty state |
| `book_newfiscalyear` | Picklist → `goal_fiscalyear` global option set | Business Recommended | Same picklist used everywhere else (see [[fiscalyear-is-picklist]] convention) |
| `book_totalsentbya` | Decimal (2) | System (plugin-maintained) | Σ item amounts where the debit Prio belongs to StateA |
| `book_totalsentbyb` | Decimal (2) | System (plugin-maintained) | Σ item amounts where the debit Prio belongs to StateB |
| `book_isbalanced` | Two Options (Yes/No), default No | System (plugin-maintained) | `totalsentbya == totalsentbyb && totalsentbya > 0` |
| `book_stateaapproved` | Two Options (Yes/No), default No | Optional | StateA sign-off. Written by PCF / plugin only. |
| `book_stateaapprovedby` | Lookup → `systemuser` | Optional | Plugin-set on transition |
| `book_stateaapprovedon` | Date/Time | Optional | Plugin-set on transition |
| `book_statebapproved` | Two Options (Yes/No), default No | Optional | StateB sign-off |
| `book_statebapprovedby` | Lookup → `systemuser` | Optional | Plugin-set on transition |
| `book_statebapprovedon` | Date/Time | Optional | Plugin-set on transition |
| `book_beapproved` | Two Options (Yes/No), default No | Optional | Budget Execution final approval — always required |
| `book_beapprovedby` | Lookup → `systemuser` | Optional | Plugin-set on transition |
| `book_beapprovedon` | Date/Time | Optional | Plugin-set on transition |
| `book_denied` | Two Options (Yes/No), default No | Optional | Any approver can deny; resets state approvals so the drafter can revise |
| `book_denialreason` | Multiple Lines of Text (2000) | Optional | Free text when `book_denied = true` |
| `book_notes` | Multiple Lines of Text (2000) | Optional | Free-text negotiation notes |
| `statuscode` | Status Reason | System | Draft / State A Approved / State B Approved / BE Pending / BE Approved / Denied. See §7. |

### Form layout suggestions

- **Header:** `book_name`, PCF approval-process bar (new PCF, mirrors
  `TurnInApprovalProcess`), `book_isbalanced` (read-only), totals
  read-only (sent-by-A, sent-by-B).
- **Body — Overview:** StateA, StateB, FiscalYear, Notes.
- **Body — Items:** editable subgrid of `book_swapitem` (see §2). If we
  want inline editing with same-Fund/PG guard, a small PCF grid could
  replace the subgrid later — not required for v1.
- **Body — Approvals:** read-only approver + timestamp fields;
  denial fields visible when denied.

---

## 2. `book_swapitem` (new entity)

Child of `book_stateswap`. One row = one paired exchange leg. Per-row
constraint: debit Prio's Fund/PG must match credit Prio's Fund/PG.

**Ownership model:** Inherit ownership from parent via cascade (§4).
Sharing cascades from parent per Share = Cascade All.

**Publisher:** `book`.

### Attributes

| Logical name | Type | Required | Description |
|---|---|---|---|
| `book_swapitemid` | Uniqueidentifier | System | Primary key |
| `book_name` | Single Line of Text (100) | System | Auto-populated `SWAPITEM-{parent.name}-{seq}` |
| `book_stateswap` | Lookup → `book_stateswap` | Required | Parent |
| `book_debitprioritization` | Lookup → `book_prioritization` | Business Required | Giving side. Belongs to one of the two states named on the parent. |
| `book_creditprioritization` | Lookup → `book_prioritization` | Business Required | Receiving side. Belongs to the *other* state on the parent. |
| `book_newamount` | Decimal (2) | Business Required | Positive amount to move for this row. Named `book_newamount` to match `LedgerAttributes.Amount`. |
| `book_fund` | Lookup → `book_fund` | System (plugin-derived) | Denormalized from debit Prio |
| `book_pg` | Lookup → `book_pg` | System (plugin-derived) | Denormalized from debit Prio |
| `book_debitstate` | Lookup → `book_state` | System (plugin-derived) | Owning state of debit Prio; used to bucket parent totals |
| `statuscode` | Status Reason | System | Standard Active / Inactive |

### Form layout suggestions

- Two-column: **Debit side** (StateA implicit, debit Prio, amount) and
  **Credit side** (StateB implicit, credit Prio). Fund/PG shown read-only
  after debit Prio is selected.
- Prio lookup filters:
  - `book_debitprioritization`: restrict to Prios owned by StateA whose
    Fund/PG matches (nothing yet if picking debit first). Enforced by
    plugin regardless.
  - `book_creditprioritization`: restrict to Prios owned by StateB whose
    Fund/PG matches the debit Prio's Fund/PG.

---

## 3. Additive changes to `book_ledger`

Existing entity — do NOT remove or rename fields.

### New attributes

| Logical name | Type | Required | Description |
|---|---|---|---|
| `book_stateswap` | Lookup → `book_stateswap` | Optional | Source-record FK when `book_ledgertype = StateSwap`. Peer of `book_turnin` and `book_realignment`. |

### `book_ledgertype` option-set relabel

Current values:

| Value | Label | Status |
|---|---|---|
| `0` | Realignment | keep |
| `1` | Turn-in | keep |
| `2` | Add | **relabel → `Swap`** |
| `3` | Cut | keep (unused) |

Value `2` stays; only the label changes from `Add` to `Swap`. No new
option value needed. Constants file will get `LedgerTypeValues.Swap = 2`.

---

## 4. Relationships

### `book_stateswap` 1:N `book_swapitem`

- Relationship name: `book_stateswap_book_swapitem`
- Lookup on child: `book_stateswap`
- **Cascade config:**
  - Assign: **Cascade All**
  - Share: **Cascade All** ← required so item sharing follows parent
  - Unshare: **Cascade All**
  - Reparent: **Cascade None** (items don't reparent)
  - Delete: **Cascade All**
  - Merge: **N/A** (Merge not enabled on custom entities)

### `book_ledger` N:1 `book_stateswap`

- Relationship name: `book_stateswap_book_ledger`
- Lookup on ledger: `book_stateswap`
- Cascade: **Restrict Delete** (mirror `book_turnin` → `book_ledger`)

### `book_prioritization` 1:N `book_swapitem` (two lookups)

- `book_prioritization_book_swapitem_debit` — via `book_debitprioritization`
- `book_prioritization_book_swapitem_credit` — via `book_creditprioritization`
- Both: Referential, Restrict Delete

### `book_state` 1:N `book_stateswap` (two lookups)

- `book_state_book_stateswap_a` — via `book_statea`
- `book_state_book_stateswap_b` — via `book_stateb`
- Both: Referential, Restrict Delete

### Derived-field lookups on `book_swapitem`

- `book_fund_book_swapitem` (via `book_fund`) — Referential
- `book_pg_book_swapitem` (via `book_pg`) — Referential
- `book_state_book_swapitem_debit` (via `book_debitstate`) — Referential

---

## 5. Security & sharing

### Privileges to grant on the two new entities

Grant on `book_stateswap` and `book_swapitem` in these roles:

| Role | Create | Read | Write | Delete | Append | AppendTo | Assign | Share |
|---|---|---|---|---|---|---|---|---|
| `Book - State Approver` | User | User | User | User | User | User | None | User |
| `Book - State Administrator` | User | User | User | User | User | User | User | User |
| `Book - Budget Executor` | None | Organization | User | None | User | Organization | None | None |
| `Book - Checkbook Administrator` | Organization | Organization | Organization | Organization | Organization | Organization | Organization | Organization |
| `Book - Read Only` | None | Organization | None | None | None | Organization | None | None |

User-scope means "own + shared." That's why sharing (§5.2) matters —
without a share, a StateB user with User-scope Read cannot see StateA's swap.

### Sharing model — named per-state teams

Owner teams exist per (state, role) with the naming pattern:

```
{StateAbbreviation} - {Role Name}
```

Two teams per state, matching the two roles that gate this feature:

- `{Abbr} - State Approver` — e.g. `AL - State Approver`, `AK - State Approver`
- `{Abbr} - State Administrator` — e.g. `AL - State Administrator`

State Abbreviation comes from `book_state.book_abbreviation`.

### What the auto-share plugin does

Fires **post-op on Create** of `book_stateswap` (and post-op Update
when `book_statea` or `book_stateb` changes):

For each of the four teams (StateA-Approver, StateA-Administrator,
StateB-Approver, StateB-Administrator):

1. Resolve `state.book_abbreviation`.
2. Look up `team` by name `"{abbr} - {role}"`.
3. Grant `ReadAccess | WriteAccess | AppendToAccess` via
   `GrantAccessRequest`.

Share cascade to `book_swapitem` happens automatically via the
relationship Share = Cascade All (§4). BE and Checkbook Admin roles
have Organization-scope Read (see privilege table above) so they see
everything without needing shares.

If a team is missing at share time, log a trace and continue —
missing teams should not block record creation. Sharing can be
re-run by re-saving the record after the team is created.

---

## 6. Option sets

### New global option-set value on `book_ledgertype`

Already covered in §3.

### `book_stateswap` `statuscode` values

| Value | Label | State |
|---|---|---|
| `1` | Draft | Active |
| `100000000` | State A Approved | Active |
| `100000001` | State B Approved | Active |
| `100000002` | BE Pending | Active |
| `2` | BE Approved | Inactive |
| `100000003` | Denied | Active |

Rationale: values `1` and `2` are the Dataverse defaults for Active /
Inactive — keep them for OOB compatibility. Custom transitions use the
100000000+ range.

### `book_swapitem` `statuscode` values

Standard Active (`1`) / Inactive (`2`) only.

---

## 7. Business rules / calculated fields

None at the entity layer for v1 — everything goes through plugins so the
logic stays in one place. If you want a formula field on
`book_stateswap` for `book_isbalanced`, it can be Yes/No calculated as
`Equals(book_totalsentbya, book_totalsentbyb) && book_totalsentbya > 0`
— but the plugin will maintain the physical field regardless, so the
formula is optional convenience.

---

## 8. Design decisions (all resolved)

1. **Team naming:** `{StateAbbreviation} - {Role Name}`, two roles per
   state (State Approver, State Administrator). See §5.
2. **`book_ledgertype` value for Swap:** `2` — relabel the existing
   `Add` value. See §3.
3. **Denial workflow:** any approver can deny; sets `book_denied = true`,
   resets both state approvals so the drafter can revise; on next
   save the plugin clears `book_denied` but preserves
   `book_denialreason` as history until the swap is resubmitted.

---

## 9. Delivery notes

- Add both entities + the `book_ledger` additions to the **main
  `ARNGCheckbook` solution** (`src/ARNGCheckbook/`), not the delivery
  solution.
- After the entities exist and are published, PCF ships via
  `solution/ARNGCheckbookExtensions/` per convention.
- Plugin steps register via the Plugin Registration Tool — see
  `Plugins/PLUGIN-REGISTRATION.md` (to be extended with the swap steps
  once code lands).
