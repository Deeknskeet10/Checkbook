# Gov Dev Cutover — FY27 Realignment / Turn-In / State Swap + Ticket Board

Status: **ready to run** · Built 2026-10-25 from the Blipsnchitz sandbox ·
Target: a gov environment at the **prod baseline** (ARNGCheckbook 1.11.0.119).

Brings gov up to the four branches **plugin-review-cleanup → stateswap-fy27 →
ticket-board → bulk-upload-depth-guard** (merged in that order). Everything a
solution can carry is in two zips; the rest is the manual steps below.

| File | What it carries |
|------|-----------------|
| `dist/ARNGCheckbookExtensions.zip` | All PCF controls (Realignment/Turn-In/Swap builders + approval bars, TicketVotingGrid, …) |
| `dist/ARNGCheckbookFY27Cutover.zip` | Schema, 5 forms, 2 form libraries, `book_CastVote` Custom API, **plugin assembly + all 116 steps** |

> The cutover zip was built by `devtools/sandbox-import/schema/build_gov_cutover_solution.py`
> from a diff of the sandbox against `src/ARNGCheckbook`. Its 719 dependencies were checked
> against the baseline: all resolve once the Extensions zip is in.

---

## 0. Before you start

- You need **System Administrator** in gov dev.
- Export gov's current `ARNGCheckbook` (unmanaged) as a rollback point.
- Have the **Plugin Registration Tool** (PRT) connected to gov dev.

---

## 1. Delete four stale plugin steps (PRT) — BEFORE importing

The sandbox re-registered three of these under new IDs (the cutover zip brings
the new ones) and retired the fourth. Leaving them would run the validators twice
and keep a retired auto-populate alive.

| Step | Step ID | Why |
|------|---------|-----|
| `SpendPlanValidator: Create of book_spendplan` | `d1d14d4c-6b8f-f111-ab0f-001dd8204135` | replaced (new ID in zip) |
| `SpendPlanValidator: Update of book_spendplan` | `41ac2d99-6b8f-f111-ab0f-001dd8204df7` | replaced (new ID in zip) |
| `RequirementFundingFundedAmountLock: Update of book_requirementfunding` | `a4d9f6b5-ea8c-f111-ab0f-001dd8204df7` | replaced (new ID in zip) |
| `ItemizedDetailsSynchronizer: Create of book_requirementdetails` | `f9b09535-2753-f111-bec5-001dd8204df7` | retired (Itemized Details are user-selected) |

Find each under **Checkbook_Plugins** → its plugin type → right-click the step → *Unregister*.

---

## 2. Import the PCF controls

Maker portal → Solutions → *Import* → `dist/ARNGCheckbookExtensions.zip` → **Publish all**.
Must come first: the cutover forms reference these controls.

## 3. Import the cutover solution

Import `dist/ARNGCheckbookFY27Cutover.zip` (keep *Enable plug-in steps* on) → **Publish all**.

What it changes:
- **New tables:** `book_realignmentitem`, `book_realignmentdetailreduction`,
  `book_realignmentdetailincrease`, `book_realignmentrdfreduction`,
  `book_realignmentrdfincrease`, `book_swapdetailreduction`, `book_swapdetailincrease`,
  `book_turnindetailreduction`, `book_turninrdfreduction`.
- **New columns:** Realignments `book_newfiscalyear`, `book_realignmententrymode`,
  `book_totalamount`, `book_allsamefundsag`, `book_itemcount`; Swap Item
  `book_debitprioritizationfunding`, `book_creditprioritizationfunding`; Turn-In Items
  `book_prioritizationfunding`, `book_afpamount`, `book_allotmentamount`,
  `book_afpoverridden`, `book_allotmentoverridden`.
- **Required → optional:** Realignments `book_fund`, `book_newamount`,
  `book_newdebitedloa`, `book_newcreditedloa`; Turn-In `book_fund`, `book_pg`.
- **Forms (overwritten, role assignments preserved):** Realignments *Realign Requirement*,
  *Information*, *Realign Admin*; State Swap *Information*; Turn-In *Turn-In* — builders and
  approval bars already placed.
- **Form libraries:** `book_StateSwaps`, `book_TurnIns`.
- **Plugins:** updates `Checkbook_Plugins` (all four branches) and registers/updates all 116
  steps + images, including the corrected `FundingTrackLOASynchronizer` PreImage.
- **Custom API:** `book_CastVote` (Ticket board voting).

If the import complains that a plugin type is still in use, a step from §1 was missed.

---

## 4. Security roles (manual — roles are NOT in the zip)

Gov roles may have drifted from the baseline, so add these by hand
(Settings → Security roles → *Custom Entities* tab). Rule: **each new table gets
the same privileges the role already has on its parent table.**

Depth legend (role editor wording): **User** = User · **BU** = Business Unit ·
**Parent BU** = Parent: Child Business Units · **Org** = Organization · **–** = none.
Roles not listed get nothing on that table.

### State Swap detail tables — mirror `book_swapitem`
Apply to **both** `book_swapdetailreduction` and `book_swapdetailincrease`:

| Role | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|------|--------|------|-------|--------|--------|-----------|--------|-------|
| Checkbook Administrator | Org | Org | Org | Org | Org | Org | Org | Org |
| State Administrator | Parent BU | Parent BU | Parent BU | User | Org | Org | Parent BU | Parent BU |
| State Approver | Parent BU | Parent BU | Parent BU | User | Org | Org | Parent BU | Parent BU |
| Budget Executor, NPM, Resource Integrator, Read Only | – | Org | – | – | – | – | – | – |

### Turn-In detail tables — mirror `book_turninitems`
Apply to **both** `book_turnindetailreduction` and `book_turninrdfreduction`:

| Role | Create | Read | Write | Delete | Append | Append To |
|------|--------|------|-------|--------|--------|-----------|
| Checkbook Administrator | Org | Org | Org | – | Org | Org |
| Budget Executor | Org | Org | Org | – | Org | Org |
| State Administrator | Parent BU | Parent BU | Parent BU | Parent BU | Parent BU | Parent BU |
| State Approver | Parent BU | Parent BU | Parent BU | Parent BU | Parent BU | Parent BU |
| State PM | Parent BU | Parent BU | Parent BU | – | Parent BU | Parent BU |
| FC Reviewer | Parent BU | Parent BU | Parent BU | – | Parent BU | Parent BU |
| NPM, Resource Integrator, PEC | BU | Org | BU | – | BU | BU |

### Realignment tables — ⚠ not configured in the sandbox
No Book role has privileges on the five new Realignment tables in the sandbox
either (sandbox testing ran as an administrator), so State / OPR users will be
blocked from saving realignment items until this is done. Recommended — mirror
each role's `book_realignments` privileges onto `book_realignmentitem`,
`book_realignmentdetailreduction`, `book_realignmentdetailincrease`,
`book_realignmentrdfreduction`, `book_realignmentrdfincrease`:

| Role | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|------|--------|------|-------|--------|--------|-----------|--------|-------|
| Checkbook Administrator | Org | Org | Org | Org | Org | Org | Org | Org |
| Budget Executor | Org | Org | Org | – | Org | Org | Org | Org |
| State Administrator | Parent BU | Parent BU | Parent BU | – | Parent BU | Org | Parent BU | Parent BU |
| State Approver | Parent BU | Parent BU | Parent BU | – | Parent BU | Parent BU | Parent BU | Parent BU |
| NPM, Resource Integrator | BU | Org | Org | – | BU | BU | BU | BU |
| CSOR | BU | Org | BU | – | BU | BU | BU | BU |
| FC Reviewer, State PM | BU | BU | BU | – | BU | Org | BU | BU |
| PEC | BU | BU | BU | – | BU | BU | BU | BU |
| Read Only | – | Org | – | – | – | – | – | – |

Test with a real State user after granting (step 9).

### Field security profile
**ARNG Checkbook - RIs** → `book_turnin.book_beapproved` → **Read + Update** = Yes.

---

## 5. Environment variable values

All definitions already exist in gov; confirm the **current values**:

| Variable | Value |
|----------|-------|
| `book_TurnInCreditOPR` | the **ARNG** OPR |
| `book_DistributionHoldingFundCenter` | the A18 (root) Fund Center |
| `book_activeplanningfy` | optional — `2027`; unset falls back to the computed federal FY |

---

## 6. Processes and flows

**Deactivate** (retired — replaced by plugins / PCF; deactivate, don't delete):
- BPF **Realignments - Review/Approve** (replaced by the RealignmentApprovalProcess bar).
- Cloud flow **Distribution - Generate AFP Distributions** (→ `book_GenerateDistributions`).
- Cloud flow **Funding Track - Generate LOAs** and classic workflow
  **LineofAccounting-Initialization** (→ `book_GenerateLOAs`).
- Cloud flow **Itemized Details - Add to Prioritization** — the flow form of the retired
  auto-populate (§1, fourth step).

**Review** — active in prod but never brought into the sandbox, so untested against the
FY27 plugins:
- **Turn-In - Create Ledger Entry** — fires when a Turn-In's *State Approved* changes and
  writes a ledger entry. FY27 Turn-Ins post ledger entries in the plugin, so approve one
  FY27 Turn-In in gov dev and check for **duplicate ledger rows**; deactivate if doubled.
- **Prioritization - Set Name**, **Req Funding - Funded vs TDP**, **LOA - Recalculate from
  Ledger** — overlap `PrioritizationNameSetter`, `RequirementFundingTDPValidator` and
  `LOATDPReconciler`. Low risk if left on; deactivate once you confirm the plugin covers it.

---

## 7. Data prerequisites

- An **ARNG holding LOA** per FY27 Fund + PG/SAG that states turn in from.
- **Funding Events** (AFP / Allotment) open for each FY27 Fund/PG states may return —
  without one, a Turn-In carrying those amounts is blocked at approval.
- Run **`book_RecalculateLOATDP`** once per FY (Admin Center button) to repair LOAs left
  stale by past bulk imports. Funding Tracks whose grain changed while the synchronizer
  image was broken may still point at their old LOA — re-save a grain field to re-link.

---

## 8. Portal work (not in any zip)

- **Ticket board:** create a `book_ticket` view *Ticket Board* (`book_name`,
  `book_tickettype`, `book_ticketstatus`, `book_score`, `ownerid`; sort `book_score` desc),
  add the **TicketVotingGrid** component and bind Title / Ticket Type / Status / Score /
  Submitted By; add **Tickets** to the app sitemap. Details: `Plugins/Tickets/REGISTRATION.md` §4.
- Hide legacy Realignment fields on any *other* realignment forms you use (Fund, Debited LOA,
  Credited LOA) — the three shipped forms already do.

---

## 9. Smoke tests

| Area | Test | Doc |
|------|------|-----|
| Realignment | State user: shell → builder → save items → approve; OPR user: RF→RF | `docs/Realignment-FY27-Gov-Cutover.md` §6 |
| Turn-In | FY27 multi-Prio Turn-In through RI/CSOR approval; check ledger rows (§6) | `docs/TurnIn-FY27-Redesign.md` |
| State Swap | PF→PF swap, both legs, BE approval | `docs/StateSwap-FY27-Redesign.md` |
| Plugin cleanup | the six checks in `Plugins/REGISTRATION-TODO.md` → *Plugin review cleanup* §5 | |
| Bulk upload | Import Decisions / Funding Tracks from Excel → LOA TDP updates | `Plugins/REGISTRATION-TODO.md` → *Bulk-upload* |
| Tickets | two users: vote, un-vote, flip; submitter-only edit | `Plugins/Tickets/REGISTRATION.md` §5 |

---

## Not in this cutover

- **Spend Plan lock** (`book_ToggleSpendPlanLock` Custom API, `book_LockSpendPlanEdits`
  env var, `SpendPlanEditLockGuard` steps): the plugin types ship in the assembly but nothing
  is registered, so it stays inert. Set up separately per `docs/SpendPlanLock-Setup.md`.
- **In-app notifications** — still in progress, not on any of these branches.
