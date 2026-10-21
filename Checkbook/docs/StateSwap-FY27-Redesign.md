# State Swap FY27 Redesign — Prioritization Funding lines + Itemized Details

Status: **plan — decisions made 2026-10-21 (§3), nothing built** · 2026-10-20

Related: [Realignment FY27 redesign](Realignment-FY27-Redesign.md),
[Turn-In FY27 redesign](TurnIn-FY27-Redesign.md),
[Prioritization Funding reconciliation](Prioritization-Funding-Reconciliation.md),
`dist/SCHEMA-StateSwap.md` (FY26 schema), `Plugins/PLUGIN-REGISTRATION.md` § State Swaps.

---

## 1. Why — what the FY26 swap does wrong on FY27 data

The State Swap pipeline still assumes the FY26 shape: **one Prioritization = one LOA = one RF**,
and money lives on the Prioritization total. Every step reads it that way:

| Where | FY26 assumption | What breaks on FY27 data |
|---|---|---|
| `SwapItemDerivedFieldsPlugin.RetrievePrioContext` | Fund/PG from `Prio.book_lineofaccounting` | FY27 Prios fund through PF junctions (one per Fund/SAG); a multi-RF Prio has no single LOA, so Fund/PG is missing or wrong. |
| `SwapLOAResolver.ResolveItems` | Debit/credit LOA + RF from `Prio.book_lineofaccounting` / `Prio.book_requirementfunding` | Same — throws "Prioritization without an LOA", or picks one RF of several. |
| `SwapValidator.ValidateAggregatedOverdraw` | Σ items ≤ Prio funded total | Doesn't stop a swap pulling more from one Fund/SAG than its PF holds. |
| `SwapPrioritizationUpdater.ApplyFundingDeltas` | Writes `Prio.FundedAmountTDP` ± amount and RF.TDP ± amount | **Leaves PF junctions untouched** → Prio total ≠ Σ PF; the RF re-summed from its junctions keeps its Funded while TDP drops → negative Withholding / blocked approval. On an **Itemized** Prio the total is owned by `PrioritizationItemizedRollup`, so the direct write is reverted or leaves Σ details ≠ total. This is exactly the drift Turn-In and Realignment were fixed for. |
| Credit side | Prio total +amount | No credit PF is created/raised; Itemized credit Prios get no detail increase. |

Distributions (`SwapDistributionCreator`) are **fine as-is**: they key on the item's Fund/PG and
the Prios' Fund Centers, both of which still exist on FY27.

## 2. Target model (mirrors Realignment's State path + Turn-In's multi-Prio lines)

One swap item = one **PF → PF leg**: *debit PF* (giving state's Prio ↔ RF) + amount → *credit
PF* (receiving state's Prio ↔ RF). Both PFs must already exist, hold funding (Funded > 0) and sit
on a Prio in NPM Review (FinalApproved); the RFs are whatever those PFs sit on — nobody picks an RF.
Each leg stays within one **Fund + PG** (debit PF's LOA Fund/PG == credit PF's). A swap can still
trade different Fund + PGs overall — e.g. A sends 100k of X to B, B sends 80k of Y back — as
separate legs (already true on FY26).

**Many PFs, many Prios per swap, on both sides.** A swap holds any number of legs; each state may
send from several PFs across several of its Prios and receive into several. One debit PF may feed
several legs (Σ ≤ its Funded), one credit PF may receive several, and a Prio may be debited in one
leg and credited in another. All rules and execution steps group by PF or by Prio, never by "the
swap's Prio".

Debit-first, two-party drafting is kept: the giving state enters debit PF + amount (+ detail
reductions); the receiving state later picks the credit PF (+ detail increases).

**Itemized Details are Prio-level and PF-agnostic.** Detail reductions / increases are just
amounts on the Prio's details; the only rule is that they balance to Σ legs out of / into that
Prio. Which detail pairs with which PF doesn't matter.

Invariants after approval, on every Prio the swap touches:
**Σ ItemizedDetail.funded ≡ Prio funded ≡ Σ PF funded**, and per LOA `remaining` unchanged except
for the ledger pair.

Branch key: `book_stateswap.book_newfiscalyear` via `FiscalYearHelper.IsLegacyFiscalYear` (same
as Turn-In). FY26 swaps keep today's code path unchanged.

## 3. Decisions (Eric, 2026-10-21)

1. **Per-leg match = Fund + PG** (not SAG). Different Fund + PGs are traded as separate legs; a
   single leg never changes Fund + PG.
2. **Requested is not lowered** on the debit side (a swap is a trade). The credit side still lifts
   Requested when the new Funded would exceed it — forced by the *Requested vs Funded* business rule.
3. **PF → PF.** The receiving state picks an existing credit PF; no RF picker, no PF creation.
4. **Itemized Details are Prio-level amounts**, independent of PFs. Because the credit PF is
   explicit, **multi-RF Itemized credit Prios are supported** (no Realignment-style rejection):
   details are raised first, then the chosen credit PF is set to *pre-swap funded + Σ legs into
   it* — an absolute value, so `SingleRfAutoAllocate` syncing the same junction can't double it.
5. **Approval route unchanged:** State A → State B → BE.
6. **`SwapLineLock`** (mirror `TurnInLineLock`): no item / reduction / increase writes once
   **either** state has approved, or the swap is BE-approved / processed / has ledgers. Denial
   clears approvals (`SwapDenialPlugin`) → editing re-opens.
7. **Only funded PFs on NPM Review Prios**, both sides: PF active, Funded > 0, parent Prio
   `ApprovalStatusValues.FinalApproved` + active. (`SumPrioritizationFundingForRF` only counts
   FinalApproved Prios, so anything else would leak out of RF.Funded.)

## 4. Data model

| Table | Change |
|---|---|
| `book_swapitem` | + `book_debitprioritizationfunding`, + `book_creditprioritizationfunding` (Lookups → PF). On FY27 the existing `book_debitprioritization` / `book_creditprioritization` are **derived** from the PFs (kept so `book_debitstate`, the roll-up, views and FY26 code keep working). |
| `book_swapdetailreduction` (**new**) | `book_stateswap` (Parental/Cascade), `book_itemizeddetail`, `book_newamount`. Debit Itemized Prios. Keyed to the swap (not the item) like `book_turnindetailreduction`, grouped by the detail's Prio. |
| `book_swapdetailincrease` (**new**) | Same shape. Credit Itemized Prios. |
| `book_stateswap` | No new columns. Relationships to both new tables: **Share cascade = Cascade All**. |

Schema script: `devtools/sandbox-import/schema/swap_fy27_schema.py` (idempotent, Web API, as for
`turnin_fy27_schema.py`). Security: State Approver / State Administrator get **User-level** CRUD +
Append/AppendTo/Share on both new tables (same as `book_swapitem`); BE + Read Only Org Read;
Checkbook Admin Org all.

## 5. Plugins

### 5.1 Shared helper extraction (do first — refactor, no behavior change)

`RealignmentExecutor` already contains the exact primitives the swap needs: `MovePfJunction`,
`UpsertCreditPf` (with BU stamping), `ApplyDetailIncreases` / `ApplyDetailReductions`,
`CountActivePf`, `GetActiveJunction`. Move them to `Helpers/PrioritizationFundingMoveHelper`,
parameterised on (debit PF, credit PF or credit Prio + RF, amount) and on the reduction/increase rows (entity +
attribute names), and have `RealignmentExecutor` + `TurnInExecutor.ApplyDetailReductions` call
them. Re-run `fy27_realign_validate.py`, `fy27_realign_twosided_validate.py`,
`fy27_turnin_validate.py` as regression before touching swaps.

While extracting, **verify the Direct credit Requested lift**: `RecalculatePrioritizationFunded`
writes Funded = Σ PF but never raises Requested, so a Direct credit Prio with Requested < new
Funded trips the entity-scoped *Requested vs Funded* business rule. FY26 swap handles this
(`SwapPrioritizationUpdater.AdjustPrioFunded`); the helper should lift Requested in the same
Update (a latent case for Realignment too).

### 5.2 Per-plugin changes

| Plugin / helper | Change |
|---|---|
| `SwapItemDerivedFieldsPlugin` | FY27 branch: require `book_debitprioritizationfunding`; derive `book_debitprioritization` + Fund/PG + `book_debitstate` from **PF → Prio / RF → LOA**; when the credit PF is set, derive `book_creditprioritization` from it and require: credit PF LOA Fund/PG == debit PF LOA Fund/PG, states differ and match StateA/StateB. Both PFs: active, Funded > 0, Prio FinalApproved + active (decision 7) — checked here for early feedback and again at approval. Add both PF lookups to the Update step filter / pre-image. |
| `SwapRollupPlugin` | "Unpaired" on FY27 = missing credit PF. Otherwise unchanged. |
| `SwapValidator` | Keep idempotency, role/BU gate, stamps, BE prereq. FY27 rules move to a new `Helpers/SwapRules` (mirror `TurnInRules`): completeness (credit PF on every item); per **debit PF** Σ legs ≤ PF funded; both PFs funded + Prio FinalApproved (decision 7); per debit Itemized Prio Σ reductions == Σ legs out of it, each ≤ detail funded; per credit Itemized Prio Σ increases == Σ legs into it; reductions / increases only on details of a Prio the swap debits / credits; Direct Prios must have no reduction / increase rows. FY26 keeps `ValidateAggregatedOverdraw`. |
| `SwapLOAResolver` | FY27 path: debit RF + LOA from the debit PF, credit RF + LOA from the credit PF; populate `DebitPF` / `CreditPF` / `DebitRF` / `CreditRF`. Fund Centers still from the Prios (feeds distributions unchanged). |
| `SwapExecutor` (**new**) | FY27 execution, §6. |
| `SwapPrioritizationUpdater` → `SwapExecutorLegacy` | Rename (helper, not a registered class — safe per the Legacy naming convention). Body unchanged. |
| `SwapApprovalPlugin` | Branch: FY27 → `SwapExecutor`; FY26 → existing steps 3–6. Distributions + deactivation shared. |
| `SwapLineLock` (**new**) | Pre-Op Create/Update/Delete on `book_swapitem`, `book_swapdetailreduction`, `book_swapdetailincrease` (decision 6). Whole-swap delete still cascades. |
| `SwapItemAutoSharePlugin` | Also register on Create of both new tables (reads the parent swap, shares with StateA + StateB teams), or generalise to read the parent lookup per entity. |
| `FundedAmountLockBase`, `PrioritizationFundingValidator`, `RequirementFundingTDPValidator` | **No change** — they already treat a `book_stateswap` Update ancestor as an authorised reducer / bypass. |

## 6. Execution order (`SwapExecutor`, on BE approval)

Per item, **debit-first** so every intermediate state is valid without relying on bypasses
(same reasoning as `SwapPrioritizationUpdater` and `MovePfJunction`):

0. Snapshot every credit PF's pre-swap Funded; target = snapshot − Σ legs out of it + Σ legs into
   it (the "out" term covers a PF that is debited by one leg and credited by another).
1. Resolve debit PF → debit RF → debit LOA; credit PF → credit RF → credit LOA.
2. Cross-LOA: `LedgerCreator.CreateStateSwapPair` + non-enforcing LOA TDP recalc. Same LOA: skip
   (unchanged FY26 rule).
3. Debit + RF move (shared helper): debit PF −amount; if debit RF ≠ credit RF → debit RF Funded
   re-sum + TDP −amount in one Update, then credit RF TDP +amount. Same RF (two states' Prios on
   one national Requirement) → no RF TDP change.
4. Credit Itemized Prios: `ApplyDetailIncreases` (lift Validated / Requested with Funded) — the
   roll-up raises the Prio total first, so the next step fits under the Σ PF ≤ Prio-total cap.
5. Set every credit PF Funded = its target from step 0 (absolute, so a `SingleRfAutoAllocate`
   sync in step 4 isn't doubled); lift PF Validated if below. Direct credit Prio: re-sum from
   junctions and lift Requested in the same Update when Funded > Requested.
6. Debit Itemized Prios: `ApplyDetailReductions`. Direct debit Prios: re-sum (Requested unchanged).
7. Re-sum every touched RF (junction roll-ups are depth-guarded off here); enforcing LOA TDP
   recalc on every touched LOA.
8. `SwapDistributionCreator` (unchanged), then deactivate (unchanged).

## 7. Entry UI — `SwapBuilder` PCF (new)

The FY26 native `book_swapitem` subgrid can't express PF → PF selection or detail grids.
New virtual React / Fluent **9.46.2** control on `book_stateswap` (bound to a Decimal, e.g.
`book_totalsentbya`), built on `RealignmentBuilder/shared.ts` (PF grid, detail grid,
remaining-to-balance) and `TurnInBuilder` (multi-Prio lines, save-in-place).

- **My side sends** (user's state = StateA or StateB): add one or more NPM Review FY Prios of
  that state; per funded PF line enter an amount; Itemized Prios show a detail-reduction grid that
  must balance to Σ amounts out of that Prio.
- **My side receives**: lists legs sent *to* this state that lack a credit PF; per leg pick a
  credit PF from this state's NPM Review FY Prios, filtered to funded PFs with the leg's Fund/PG.
  Itemized credit Prios show a detail-increase grid that must balance to Σ legs into that Prio.
- Read-only summary of the counterpart's legs; Save updates in place, fires
  `book:swap-items-saved` so `StateSwapApprovalProcess` re-reads readiness (bump its manifest
  version if touched).
- FY26 swaps: show a message; the legacy subgrid stays. Form script hides the subgrid on FY27
  (new `Book.StateSwap` lib in `webresources/`, per WIRING.md — no one-off form script).

Remember the manifest rules: version bump every change, no apostrophes in
description/display keys, Fluent pinned in package.json **and** `<platform-library>`; rebuild
`ARNGCheckbookExtensions` and copy the zip to `dist/` in the same commit.

## 8. Build sequence

1. ~~Decisions §3~~ — done 2026-10-21.
2. Schema + security in Blipsnchitz (`swap_fy27_schema.py`, `swap_fy27_security.py`); constants
   (`SwapItemAttributes` + 2 new attribute classes).
3. §5.1 helper extraction + realignment / turn-in regression.
4. Plugins §5.2; push DLL; register `SwapLineLock` + new share steps; update Derived-Fields
   filter/pre-image (`register_swap_fy27_steps.py`).
5. Server validation `fy27_swap_validate.py` (below) — before any UI.
6. `SwapBuilder` PCF + form placement (`swap_place_builder.py`) + `Book.StateSwap` form lib.
7. Docs: this file → "built", `PLUGIN-REGISTRATION.md`, `dist/SCHEMA-StateSwap.md` FY27 section,
   gov cutover checklist, `WIRING.md`.

### Validation scenarios (`fy27_swap_validate.py`)

1. **Two-way, Direct ↔ Direct, different LOAs**: A sends 10k from a G3 PF; B sends 5k from a G4
   PF. PFs, RF Funded/TDP, Prio totals both sides, ledger pairs, LOA remaining unchanged, A18 nets
   zero.
2. **Same RF** (both Prios on one national Requirement): PF move only, no ledger, RF unchanged.
3. **Itemized debit → Itemized single-RF credit**: reductions + increases balance; Σ details ≡
   total ≡ Σ PF on both Prios (credit PF not doubled by auto-allocate); unbalanced grids block
   approval.
4. **Itemized multi-RF credit Prio**: leg lands on one of its two PFs; Σ details ≡ total ≡ Σ PF.
5. **Mixed Fund/PG trade**: A sends X to B, B sends Y back — two legs, each same Fund/PG.
5a. **Many-to-many**: A sends from 3 PFs across 2 Prios (one Itemized) into 2 of B's Prios; one
   debit PF split across two legs; one credit PF receiving two legs; one of A's PFs debited by one
   leg and credited by B's return leg (net target correct).
6. Blocks: over-PF draw, Fund/PG mismatch within a leg, unfunded credit PF, credit PF on a
   non-NPM-Review Prio, edits after State A approval (lock), re-approval (idempotency).
7. **FY26 regression**: an FY26 swap still runs the legacy path end-to-end.
8. Direct credit Prio with Requested < new Funded: Requested lifted, no business-rule error;
   debit Prio Requested unchanged.

## 9. Open / out of scope

- OPR / RF-level swaps (no Prio) — not a state feature; out of scope.
- Crediting a Prio that has no funded PF for the leg's Fund/PG — not allowed (decision 7); the
  receiving state funds it through the normal process first.
- Delete privilege on the new tables for drafting users (same open question as Turn-In §10).
- The absolute-target credit PF write (§6 step 5) would also lift Realignment's multi-RF Itemized
  credit restriction — candidate follow-up once it's in the shared helper.
