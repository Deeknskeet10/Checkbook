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
> (and the same for Validated).

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

## 4. Build

### 4.1 Enforcement — the reconciliation guard (server, authoritative)
- **Never allow over-allocation:** reject any `book_prioritizationfunding` Create/Update whose
  write would make Σ PF.funded (or Σ PF.validated) for the Prio **exceed** the Prio total
  (Σ details). This is the aggregate check the current `PrioritizationFundingGuard` is missing
  (it caps each PF at its RF's TDP, not the aggregate at the Prio total). Add it there or in a
  sibling guard.
- **Block finalize/approve while under-allocated:** the Prio cannot reach its funded end-state
  (or be treated as funding-complete) while Σ PF < Prio total. Exact hook: a guard on the Prio
  funding-complete transition (NPM Review is the funding state, so key off the funded-lock/
  finalize action rather than a status change). Under-allocation is otherwise surfaced by the
  flag (4.2) so the NPM knows to finish allocating.

### 4.2 PCF — `PrioritizationFundingGrid` "Allocate to RFs" popup
- The dialog already computes "Sum of Allocations vs Prio Funded (target)" and shows a warning.
  Make **"Save Allocations" hard-blocked** (disabled / rejected) unless Σ PF.funded == target
  **and** Σ PF.validated == validated target.
- Flag the Prio row in the grid (the existing warning badge) whenever Σ PF ≠ target.
- Respect increase-only: the per-PF inputs can't reduce an existing committed amount here
  (reductions flow through Realignment/Turn-In).

### 4.3 Increase-only lock
- Confirm `book_LockManualFundedEdits` is ON in each env (prod + sandbox) so the FundedAmountLock
  plugins enforce increase-only on `book_prioritization`, `book_prioritizationfunding`,
  `book_itemizeddetails` funded. Extend coverage if `book_itemizeddetails.book_fundedamount`
  isn't already locked.

## 5. Open sub-decision — Realignment ↔ itemized interaction
A realignment that debits a PF (an authorized reduction) drops Σ PF below the Prio total,
breaking the invariant — and the NPM can't fix it (reductions are locked). So the realignment
must reduce the **detail** total by the same amount in the same transaction. With no
per-(detail, RF) link, *which* detail loses the funding is undefined. Options to resolve when
wiring [[realignment-fy27-redesign]] to this model: (a) the realignment debit on an itemized
Prio targets a specified ItemizedDetail; (b) reduce proportionally across details; (c) realign
itemized Prios only at the detail level. **Defer until this reconciliation lands.**

## 6. Migration
Existing divergent Prios (Σ PF ≠ Σ details) need a one-time reconcile report/pass: list every
Prio where the sums disagree so NPMs can rebalance (increase-only, so most fixes are completing
an under-allocation). Build a read-only audit query first; no silent auto-fix.
