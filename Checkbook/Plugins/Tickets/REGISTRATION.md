# Ticket Board — Registration & Setup

Reddit-style feedback / feature-request board. Users submit `book_ticket`
rows and up/down vote them; the vote toggle and score tally run server-side
in the `book_CastVote` Custom API so a voter never needs Write on someone
else's ticket.

| Piece | Where | Delivered by |
|-------|-------|--------------|
| `book_ticket`, `book_ticketendorsement` tables + roles | `src/ARNGCheckbook/Entities/book_Ticket*`, `Roles/` | Already in the environment (solution 1.11.0.115+) |
| `Checkbook.Plugins.Tickets.CastVotePlugin` | `Plugins/Tickets/CastVotePlugin.cs` | Push `Checkbook_Plugins.dll` (PRT) |
| `book_CastVote` Custom API | — (environment only) | Maker portal / PRT, spec below |
| `TicketVotingGrid` PCF | `pcf/TicketVotingGrid/` | `dist/ARNGCheckbookExtensions.zip` import |

---

## 1. Schema (reference — already authored)

**`book_ticket`** (user-owned)

| Column | Type | Notes |
|--------|------|-------|
| `book_name` | Text | Title (primary name) |
| `book_description` | Multiline text | |
| `book_tickettype` | Choice | Grid filter chips |
| `book_ticketstatus` | Choice | Named to avoid the `statecode` clash |
| `book_module` | Choice | Which Checkbook area the ticket concerns |
| `book_individualassigned` | Lookup | Triage assignee |
| `book_score` | Whole number | **Written only by `book_CastVote`** — sum of votes |

**`book_ticketendorsement`** (user-owned) — one row per (ticket, voter)

| Column | Type | Notes |
|--------|------|-------|
| `book_ticket` | Lookup → `book_ticket` | |
| `book_endorser` | Lookup → `systemuser` | The voter (set to the caller's `InitiatingUserId`) |
| `book_value` | Whole number | `+1` up / `-1` down |

Alternate key **`book_uniquevote`** on (`book_endorser`, `book_ticket`) —
one vote per person per ticket, and the backstop for double-click races
(the second concurrent Create fails at the database).

**Security.** Read = Organization on both tables for every Book role.
`book_ticket` Write is **User** for submitter roles (NPM, State PM) and wider
for triage/admin roles (Local / Deep / Global) **by design**. Score updates
bypass this because plugins execute as the sysadmin super user.

---

## 2. Push the assembly

Re-push `Checkbook_Plugins.dll` so the `Checkbook.Plugins.Tickets.CastVotePlugin`
type exists (`pp-plugin-push <AssemblyId>` or PRT → *Update* assembly). Confirm
the type appears under the assembly before step 3.

---

## 3. Create the `book_CastVote` Custom API

Maker portal → solution → *New* → *More* → *Other* → **Custom API**
(or PRT → *Register* → *Register New Custom API*).

| Field | Value |
|-------|-------|
| Unique name | `book_CastVote` |
| Name / Display name | `book_CastVote` / `Cast Vote` |
| Description | `Toggles the caller vote on a ticket and recomputes its score` |
| Binding type | **Global** (unbound) |
| Is Function | **No** (action — has side effects) |
| Is Private | **No** |
| Enabled for Workflow | No |
| Allowed Custom Processing Step Type | **None** |
| Plugin Type | `Checkbook.Plugins.Tickets.CastVotePlugin` |

> No apostrophes in any description or label — solution import rejects them.

**Request parameters** (both required)

| Unique name | Name | Type | Notes |
|-------------|------|------|-------|
| `TicketId` | `TicketId` | **String** | GUID of the `book_ticket` (string, not Guid — matches the PCF call) |
| `Direction` | `Direction` | **Integer** | `1` upvote, `-1` downvote; anything else throws |

**Response properties**

| Unique name | Name | Type | Notes |
|-------------|------|------|-------|
| `NewScore` | `NewScore` | **Integer** | Recomputed `book_score` |
| `UserVote` | `UserVote` | **Integer** | Caller's resulting vote: `-1`, `0`, `1` |

The **Plugin Type** field wires the handler — no separate SDK Message
Processing Step is registered.

### Toggle semantics

| Caller's existing vote | Request | Result | `UserVote` |
|------------------------|---------|--------|------------|
| none | ±1 | create vote | ±1 |
| same direction | same | delete vote (un-vote) | 0 |
| opposite direction | flip | update vote | new direction |

After every call `book_score` = SUM(`book_value`) across all votes on the ticket.

---

## 4. Import the PCF and place the board

1. Import `dist/ARNGCheckbookExtensions.zip`, then **Publish all**.
2. Create (or edit) a `book_ticket` view, e.g. **Ticket Board**, with columns
   `book_name`, `book_tickettype`, `book_ticketstatus`, `book_score`,
   `ownerid`, sorted by **`book_score` descending**.
3. On that view → *Components* → add **TicketVotingGrid** (Web), bind:
   - Title → `book_name`
   - Ticket Type → `book_tickettype`
   - Status → `book_ticketstatus`
   - Score → `book_score`
   - Submitted By → `ownerid` (or `createdby`)
4. Add **Tickets** (`book_ticket`) to the Checkbook app sitemap so users can
   reach the board; save + publish the app.

---

## 5. Smoke test

Use two users (A and B) and one ticket owned by A.

1. **B upvotes** → arrow highlights, score `1`. In Dataverse: one
   `book_ticketendorsement` row, `book_endorser` = B, `book_value` = 1.
2. **B upvotes again** → un-vote, score `0`, the row is deleted.
3. **B downvotes, then upvotes** → score `-1`, then `1`; still one row (flipped).
4. **A upvotes own ticket** → score `2`.
5. **B opens the ticket form** → B cannot edit the body if B holds only a
   submitter role (NPM / State PM), yet B's votes still moved `book_score`.
6. Refresh the grid → each user's arrows reflect their own vote.
