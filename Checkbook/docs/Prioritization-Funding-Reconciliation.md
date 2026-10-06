# Prioritization Funding Reconciliation (FY27)

Status: **design, not yet built** · Last updated 2026-10-06

> Fixes the production complaint "my Prioritization Funded Amount is different than my
> PF Funded amounts." Root cause mapped 2026-10-06; decisions below from the user.
> Related: [[realignment-fy27-redesign]] (the finding that surfaced this), the
> FundedAmountLock plugins, `Plugins/Items/PrioritizationItemizedRollup.cs`,
> `Plugins/Recalculations/PrioritizationFundingRollup.cs`,
> `Plugins/Recalculations/PrioritizationSingleRfAutoAllocate.cs`,
> `pcf/PrioritizationFundingGrid/`.

## 1. Problem (confirmed current state)

A Prioritization's "funded" is entered on **two independent, orthogonal axes**:

- **Per-item** — `book_itemizeddetails.book_fundedamount`, typed per RequirementDetail in
  the PrioritizationFundingGrid expand-rows → rolled to `book_prioritization.book_newfundedamounttdp`
  by `PrioritizationItemizedRollup` (Itemized mode).
- **Per-RF** — `book_prioritizationfunding.book_fundedamount` (the Prio↔RF junction), typed by
  hand in the per-Prio **"Allocate to RFs"** popup.

The RF total rolls up from the **per-RF** junctions; the Prio total comes from the **per-item**
sum. Nothing forces them equal except `PrioritizationSingleRfAutoAllocate` — which **no-ops at
2+ RFs** — and the junction→Prio rollup (`PrioritizationFundingRollupHelper`) **deliberately
skips in Itemized mode** ("items own the total; junctions are distributive metadata"). So
multi-RF / itemized Prios drift, with **no validator catching it**. `book_itemizeddetails` has
no RF lookup and `book_prioritizationfunding` has no item lookup — they are different
breakdowns of the same total.

## 2. Requirement (user, 2026-10-06)

- The NPM **identifies how much to Fund per detail** — per-detail Funded stays the authoritative input.
- We do **not** need to know which RF funds which detail (no per-(detail, RF) linkage).
- We **do** need the per-RF funded amounts to **sum to** the per-detail funded total.
- These must **never** be committable in a mismatched state.

### Invariant
> Σ `ItemizedDetail.funded`  ≡  `Prio.book_newfundedamounttdp`  ≡  Σ `book_prioritizationfunding.funded`
>
> **Funded only.** Validated is *not* reconciled — Validated may exceed Funded (you can validate
> more than you fund), so no aggregate check is placed on the Validated amounts.

## 3. Decisions

1. **Per-detail Funded is the input** → Prio total = Σ details (Itemized rollup unchanged; the
   `PrioritizationFundingRollupHelper` Itemized-skip stays — items own the total). Direct-mode
   Prios (no items) keep Prio total = Σ PF as today.
2. **No auto-seed of the multi-RF split.** The NPM allocates per RF by hand — "it's the NPM's
   job to identify how much and from where." (`SingleRfAutoAllocate` stays for the single-RF case.)
3. **Increase-only funding.** Funded/Validated may only be *increased* through the normal NPM
   surfaces; reductions happen only via authorized tools (Realignment / Turn-In, which already
   bypass the lock via their orchestrator ancestor). This is the existing **FundedAmountLock**
   mechanism (`book_LockManualFundedEdits` toggle + `PrioritizationFundedAmountLock`,
   `PrioritizationFundingFundedAmountLock`, `RequirementFundingTDPLock`).
4. **Flag + block until balanced.** An unbalanced Prio (Σ PF ≠ Prio total) is flagged and
   **cannot be saved/finalized** until balanced. A mismatch is never committable.
5. **Keep the "Allocate to RFs" popup** for now — strengthen its existing "sum ≠ target" warning
   into a hard block; no inline-grid rebuild yet.
6. **Maintain the single-RF auto-allocate** (`PrioritizationSingleRfAutoAllocate`): when the
   Requirement has exactly one active RF for the FY, setting the funded total still auto-syncs the
   one PF — the common case stays zero-extra-effort and always balanced.
7. **Require ≥1 RF before funding details.** The NPM cannot populate detail/Prio Validated or
   Funded until at least one `book_requirementfunding` exists for the Prio's (Requirement, Fiscal
   Year). This guarantees a funding source is present (and, when it's the only one, auto-allocates).
   A **soft notice** encourages identifying *all* source RFs up front, but only the presence of
   **one** is enforced (we can't force them to list every source).

## 4. Build

### 4.1 Enforcement — server guards (authoritative)
- **Over-allocation cap (extend `PrioritizationFundingGuard`, no new step):** reject any
  `book_prioritizationfunding` Create/Update whose write would make **Σ PF.funded** for the Prio
  **exceed** the Prio total (Σ details). Funded only — Validated is not reconciled (may exceed
  Funded). This is the aggregate check the guard was missing (it only caps each PF at its RF's TDP
  + the NPM-Review gate). Under-allocation is not dangerous (just incomplete) — the PCF blocks
  leaving it unbalanced (4.2) and the flag shows it.
- **≥1-RF precondition (new guard, decision #7):** on a funding write — `book_itemizeddetails`
  Update of `book_fundedamount`/`book_validatedamount`, and `book_prioritization` Update of
  `book_newfundedamounttdp`/`book_validatedamount` (direct mode) — require ≥1 active
  `book_requirementfunding` for the Prio's (Requirement, Fiscal Year); else throw
  "Add at least one Requirement Funding for FY{x} before funding details." One class, two PreOp
  steps (mirror `RequirementDetailFundingGuard`'s multi-entity shape).

### 4.2 PCF — `PrioritizationFundingGrid` "Allocate to RFs" popup
- The dialog already computes "Sum of Allocations vs Prio Funded (target)" and shows a warning.
  Make **"Save Allocations" hard-blocked** (disabled / rejected) unless Σ PF.funded == target
  **and** Σ PF.validated == validated target.
- Flag the Prio row in the grid (the existing warning badge) whenever Σ PF ≠ target.
- Respect increase-only: the per-PF inputs can't reduce an existing committed amount here
  (reductions flow through Realignment/Turn-In).

### 4.3 Increase-only lock — BUILT 2026-10-06
`book_LockManualFundedEdits` is **ON in gov**; the sandbox was set ON to match. Funded is now
increase-only across all levels via `FundedAmountLockBase` subclasses:
- `PrioritizationFundedAmountLock` (`book_prioritization`) — existing.
- `RequirementFundingTDPLock` (`book_requirementfunding`) — existing.
- `PrioritizationFundingFundedAmountLock` (`book_prioritizationfunding`) — **registered** (was in repo,
  not registered in the sandbox).
- `ItemizedDetailFundedAmountLock` (`book_itemizeddetails.book_fundedamount`) — **new**, closes the
  gap so the authoritative per-detail funded can't be reduced directly.

Reductions are allowed **only** through Turn-Ins / Realignments / State Swaps / the Distribution
generator — `FundedAmountLockBase` walks `ParentContext` for an authorizing Update on
`book_turnin`/`book_realignments`/`book_stateswap`. Validated in the sandbox: direct detail/PF
reductions blocked; a realignment reduces a PF (450k→400k) fine with the lock ON.

> **Gotcha (test tooling):** a raw Web-API `PATCH` is processed as the **Upsert** message, so the
> authorized-ancestor walk (which matches the **Update** message) didn't recognize it and blocked
> the realignment's reduction. Production approvals are form/PCF **Update** saves, so they chain
> correctly. The data-seed `dvapi.patch` now sends `If-Match: *` to force Update semantics.

## 5. Realignment ↔ itemized interaction — BUILT + validated 2026-10-06
A realignment that debits a PF (an authorized reduction) drops Σ PF below the Prio total,
breaking the invariant — and the NPM can't fix it afterward (reductions are locked). **Resolution:
the NPM explicitly selects which ItemizedDetails give up the funding, reducing them to a sum equal
to the realignment amount, as part of the realignment — and it cannot process until those detail
reductions balance to the move.** Example: a $10,000 realignment across 2 PFs requires the NPM to
pick N details and reduce them by a total of $10,000 before approval.

**Server mechanism (shipped to the sandbox; the `RealignmentBuilder` entry PCF — the UI below — is
still pending):**
- **Schema:** new child `book_realignmentdetailreduction` on `book_realignments` — lookup
  `book_itemizeddetail` → `book_itemizeddetails` + a reduction amount `book_newamount`. Parent
  `book_realignment` cascade-delete. Created via
  `devtools/sandbox-import/schema/realign_detailreduction_schema.py`. No plugin steps (pure data
  read by the validator/processor). Only used when the debit Prio is Itemized; Direct-mode debit has
  no details — the PF reduction *is* the Prio-total reduction.
- **Validator (`RealignmentValidator.EnforceItemizedDebitBalance`):** on any approval transition of
  an item-based realignment, sum the item amounts whose debit PF sits on an **Itemized** Prioritization;
  if that total > 0, block the approval unless Σ(active detail reductions) == that total (±0.005), and
  each reduced detail must belong to a debiting Prioritization. Funded only. RF/RDF debit and
  Direct-mode debit contribute nothing.
- **Processor (`RealignmentProcessor.ApplyDetailReductions`):** after the item PF moves, reduce each
  selected ItemizedDetail's Funded by its amount — as the authorized reducer, so the increase-only
  `ItemizedDetailFundedAmountLock` lets it through. `PrioritizationItemizedRollup` (no depth guard)
  recomputes the Prio total down, keeping Σ PF ≡ Σ details on both sides.
- **UI (`RealignmentBuilder`, pending):** a detail-selection grid where the NPM picks funded details
  and enters reductions, with a live remaining-to-balance against the realignment total.

**Validated** (`devtools/.../transactional/fy27_realign_detailreduction_validate.py`): a balanced
itemized Prio (total 300k = details 200k+100k = PF 300k) realigns 100k out of its PF. Approval with
no reductions is blocked ("reduce them by a total of 100,000.00 (currently 0.00)"); after a 100k
reduction on one detail, approval executes — PF 300k→200k, detail 200k→100k, Prio total 300k→200k,
Σ PF ≡ Σ details ≡ Prio total = 200k; credit PF-C 100k, RF TDP moves settle, LOA remaining unchanged
(same-LOA), realignment deactivated.

See [[realignment-fy27-redesign]] §5.

## 6. Migration
Existing divergent Prios (Σ PF ≠ Σ details) are surfaced **externally via a Power BI report**
(decision 2026-10-06) to inform NPMs — no in-app audit/auto-fix. Increase-only means most fixes
are completing an under-allocation.
