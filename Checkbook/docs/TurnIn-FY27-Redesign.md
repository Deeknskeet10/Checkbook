# Turn-In FY27 Redesign — Prioritization Funding lines, no header Fund/SAG

Status: **built + deployed + validated in Blipsnchitz 2026-10-15; RF route + multi-Prio + entered AFP/Allotment 2026-10-16** · Author handoff doc

Related: [Realignment FY27 redesign](Realignment-FY27-Redesign.md) (same junction model),
`Plugins/PLUGIN-REGISTRATION.md` (TurnIns), `Plugins/TurnIns/REGISTRATION.md` (credit LOA),
`webresources/WIRING.md` §9a.

---

## 1. Why

FY27 money lives on junctions — `book_prioritizationfunding` (Prio ↔ RF, one per Fund/SAG)
and `book_requirementdetailfunding` (Requirement Detail ↔ RF) — not on a single funded number.
The FY26 Turn-In:

- lowered the **Prioritization total** and left the PF junctions alone. A multi-RF Direct Prio
  ended with Prio total ≠ Σ PF, and the RF re-summed from its junctions kept its Funded while
  its TDP dropped, giving negative Withholding or a blocked approval. An Itemized Prio ended
  with Σ details ≠ total;
- cut an RF-level item's Funded **and** TDP by the full amount, ignoring Withholding. On a
  detail-funded RF the Funded cut was undone by the next RDF re-sum — the same class of bug as
  the −700k Withholding defect;
- needed one header Fund/PG, so a Prio split across Fund/SAGs took one Turn-In per Fund/SAG.

## 2. Decisions (Eric, 2026-10-15)

1. **States turn in through Prioritizations only.** State Turn-Ins are State Approver
   approved and stay at the state level. (PEC/WTC exemption unchanged.)
   **RF-level Turn-Ins (revised 2026-10-16):** an **NPM** creates them and a **Resource
   Integrator or CSOR** approves them in **one step** — no State and no Budget Execution
   step. The approval rides on `book_beapproved` (the field-secured flag the CSO profile
   already writes; the RIs profile gets Update on it). FY26 RF-only Turn-Ins keep State → BE.
2. **No Fund/SAG on the FY27 header.** One Turn-In can hold **several Prioritizations**; for
   each, the user enters how much to turn in from each of its PF lines (one per Fund/SAG). A
   Turn-In carries Prioritization lines or RF lines, never both (different approval routes).
3. **Withholding first** for RF-level items (same as OPR realignments).
4. **Lower Requested** by the amount turned in — the state is saying it does not need the
   funds. Direct Prio: Prio Requested. Itemized Prio: each reduced detail's Requested (the
   itemized roll-up re-sums the Prio).
5. **TDP, AFP and Allotment are entered per line (2026-10-16)** — e.g. 100k TDP, 80k AFP, 30k
   Allotment. AFP / Allotment are optional: blank = sized automatically (TDP × the line's
   Fund/PG percentage); a value is kept as entered (per-item override flag). The header shows
   the totals.

## 3. Data model

| Table | Change |
|---|---|
| `book_turnin` | `book_fund`, `book_pg` relaxed to **optional** (FY26 + Sweep still set them). `book_newamount`, `book_afpamount`, `book_allotmentamount` become item roll-ups on FY27. |
| `book_turninitems` | + `book_prioritizationfunding` (→ PF), `book_afpamount`, `book_allotmentamount` (Decimal), `book_afpoverridden`, `book_allotmentoverridden` (Yes/No). State lines set Prio + RF + PF (RF/Prio must be the PF's). RF lines set RF only. |
| `book_turnindetailreduction` (**new**) | `book_turnin` (Cascade), `book_itemizeddetail`, `book_newamount`. Itemized Prio detail reductions. |
| `book_turninrdfreduction` (**new**) | `book_turnin` (Cascade), `book_requirementdetailfunding`, `book_newamount`. RF-level RDF reductions. |

Schema script: `devtools/sandbox-import/schema/turnin_fy27_schema.py` (idempotent).

## 4. Rules (TurnInValidator → `TurnInRules`, at approval)

FY27 branch = `book_turnin.book_fiscalyear` ≥ 2027 (`TurnInLOAResolver.IsFy27Plus`). Header
checks (amount > 0, Σ items == header), role gate, idempotency, the State-only RF rule and the
BE ordering rule are unchanged.

- Prioritization lines and RF lines can't be mixed; AFP / Allotment can't be negative.
- A Prioritization line must name its PF junction.
- Per PF: Σ lines ≤ PF funded.
- Per Itemized Prio: Σ detail reductions on that Prio == Σ its lines; each reduction ≤ detail funded.
- Per RF-level RF: a Prioritization-funded RF may give up Withholding only; otherwise
  ≤ Withholding + Funded; on a detail-funded RF Σ RDF reductions == max(0, amount − Withholding).
- Per (Fund, PG): any AFP / Allotment needs an active Funding Event of that type today, or it
  could not be distributed (TurnInDistributionCreator would skip it silently).
- **Approval routing (FY27, all lines RF-level):** a State approval is refused; the
  `book_beapproved` save must come from a Resource Integrator, CSOR or Checkbook Administrator,
  and needs no prior State approval.

## 5. Execution (TurnInApprovalPlugin → `TurnInExecutor`)

Runs once ready (Prio lines: State approval; RF lines: the RI / CSOR approval alone).

1. **Ledger** — debit each source LOA; credit the ARNG holding LOA with the same Fund + PG/SAG
   (per debit LOA; `book_TurnInCreditOPR` = ARNG OPR).
2. **Distributions** — one AFP and one Allotment pair per (Fund, PG) from the items' own
   amounts; debit FC = Turn-In Fund Center (state), credit FC = A18 root.
3. **PF lines** — PF funded −amount; per RF: Funded re-summed from junctions and TDP −amount
   in one update; Direct Prio re-summed from its junctions, Requested −amount.
4. **Detail reductions** — detail Funded and Requested −amount (itemized roll-up re-sums the Prio).
5. **RF lines** — `RequirementFundingHelper.ApplyDebit` (Withholding first, then Funded +
   TDP; shared with the RF→RF realignment leg), then RDF reductions and RD/RF re-sums.
6. Recalculate every touched LOA's TDP; deactivate the Turn-In.

Per LOA: source TDP and its RFs' TDP drop together (remaining unchanged); the ARNG LOA's TDP rises.

## 6. Plugins

| Plugin | Change |
|---|---|
| `TurnInValidator` | FY27 → `TurnInRules`; FY backfilled from the record when the pre-image lacks it; FY27 RF-level role gate = Resource Integrator / CSOR / Checkbook Admin on `book_beapproved`, State flag refused, no State-first ordering. |
| `TurnInApprovalPlugin` | FY27 with items → `TurnInExecutor`; FY27 RF-level ready on `book_beapproved` alone; FY26 / Sweep unchanged. |
| `TurnInAmountCalculator` | Skips FY27 (items own AFP/Allotment). |
| `TurnInItemAmountCalculator` (**new**) | Pre-Op item Create/Update: per-item AFP/Allotment = amount × pct of the item LOA's (Fund, PG). |
| `TurnInItemRollup` (**new**) | Post-Op item Create/Update/Delete: header Amount / AFP / Allotment = Σ active items. |
| `TurnInLOAResolver` | Loads PF + per-item AFP/Allotment + LOA SAG; active items only; `ResolveLOAsForItems`. |
| `TurnInLineLock` (**new**, all FYs) | Pre-Op Create/Update/Delete of items + both reduction tables: blocked once the Turn-In is approved, processed, denied or has ledgers (only a whole-Turn-In delete cascades through). Stops users "undoing" a completed Turn-In by editing or deleting its lines. |
| `RequirementFundingHelper` (**new**) | Withholding-first RF debit, extracted from `RealignmentProcessor.ApplyDebitToRF`. |

Registration: `devtools/sandbox-import/schema/register_turnin_fy27_steps.py`; details in
`Plugins/PLUGIN-REGISTRATION.md`.

## 7. Entry UI — `TurnInBuilder` PCF (v0.2.2)

Virtual React/Fluent 9.46.2 control bound to `book_newamount`, in a full-width body section
after the header fields (`turnin_place_builder.py`). Shell picks the type: saved type wins; State
roles → Prioritization; NPM / Resource Integrator / CSOR → Requirement Funding;
Checkbook Administrator, dual-role and no-role users get a toggle. **A State-only user never gets
the RF option.** FY26 and Sweep Turn-Ins show a message instead.

- **Prioritization:** add one or more FinalApproved FY Prioritizations in the Fund Center's
  state; each shows a line per funded PF (Fund/SAG) with TDP, AFP and Allotment inputs (AFP /
  Allotment blank = auto); an Itemized Prio shows its own detail-reduction grid that must
  balance to that Prio's TDP total. Totals row for TDP / AFP / Allotment.
- **Requirement Funding:** one RF + TDP / AFP / Allotment; shows TDP / Funded / Withholding and
  what can be turned in; RDF-reduction grid when Withholding does not cover it.
- Save **updates existing lines in place** and creates new ones; only removed lines are deleted.
  NPM, State PM, FC Reviewer and Resource Integrator have Create + Write but **no Delete** on
  Turn-In Items, and `DeactivationRoleGuard` blocks deactivation, so changing amounts never
  needs a delete. Removing a line or a Prioritization does — see §10. Fires
  `book:turnin-items-saved` so `TurnInApprovalProcess` (v0.1.4) re-reads the route.
- `TurnInApprovalProcess` v0.1.4: FY27 RF-level Turn-Ins show a single **RI / CSOR Approval**
  stage (button gated to Resource Integrator / CSOR / Checkbook Administrator).

`Turn-Ins.js` hides header Fund/PG and the legacy items section on FY27, locks the roll-up
amounts, and shows the builder only on FY27 (WIRING.md §9a).

## 8. Validation

`devtools/sandbox-import/data-seed/transactional/fy27_turnin_validate.py` — **PASS 2026-10-16**
(seeds AFP 50 % / Allotment 25 % Funding Events on G4's Fund/PG only):

1. **One Turn-In, two Prioritizations:** a Direct Prio split across G3 + G4 (PF 10k + 20k; 4k +
   6k TDP, AFP 5k / Allotment 2k entered on the G4 line) and an Itemized single-RF Prio on G4
   (12k TDP, AFP / Allotment auto = 6k / 3k, detail reduced 12k). Over-draw blocked; AFP entered
   on G3 (no Funding Event) blocked. After State approval: PFs 6k / 14k / 38k, both Prios'
   funded + requested down, RF TDP down, G3 / G4 TDP down with remaining unchanged, ARNG-G3 +4k /
   ARNG-G4 +18k, header and distributions AFP 11k / Allotment 5k.
2. Prioritization + RF lines on one Turn-In: blocked.
3. RF-level on a detail-funded RF (TDP 16k = RDF 10k + Withholding 6k), turn in 9k with AFP 4k /
   Allotment 2k entered: State approval refused; blocked without the 3k RDF reduction; then the
   RI / CSOR approval alone runs it → RF 7k/7k/0, RDF 7k, ARNG-G4 +9k, AFP 4k / Allotment 2k
   distributed.

OPR realignment regression (shared RF debit helper) re-checked on fresh records: PASS.

Test 4 — `TurnInLineLock`: deleting, changing, adding or re-parenting lines / reductions on a
completed Turn-In is blocked; a draft's lines stay deletable; whole-Turn-In deletes still cascade.
(The script's cleanup also removes its own ledgers / distributions so G3 / G4 balances don't
drift run over run.)

## 9. Gov cutover checklist

1. Run the schema (`turnin_fy27_schema.py` changes, maker portal or script).
2. Push `Checkbook_Plugins.dll`; register `TurnInItemAmountCalculator`, `TurnInItemRollup` and `TurnInLineLock`;
   add `book_fiscalyear` to the `TurnInValidator` pre-image (optional — it falls back to a Retrieve).
3. Set `book_TurnInCreditOPR` to the **ARNG** OPR; confirm an ARNG holding LOA exists per
   FY27 (Fund, PG/SAG) that states turn in from.
4. Import `dist/ARNGCheckbookExtensions.zip` (TurnInBuilder 0.2.2, TurnInApprovalProcess 0.1.4).
5. Place the builder on the Turn-In form; upload `Turn-Ins.js` to `book_TurnIns`.
6. Security (`turnin_fy27_security.py` in the sandbox): **ARNG Checkbook - RIs** field profile →
   Read + Update on `book_turnin.book_beapproved`; every role that creates Turn-In Items gets the
   same depth on `book_turnindetailreduction` / `book_turninrdfreduction`. The CSOR role already
   has Write on Turn-Ins and the CSO profile already writes `book_beapproved`.
7. Open Funding Events (AFP / Allotment) for each FY27 Fund/PG that states may return AFP or
   Allotment on — without one, a Turn-In carrying those amounts is blocked at approval.

## 10. Open items

- **Delete privilege:** NPM, State PM, FC Reviewer and Resource Integrator cannot delete
  Turn-In Items, so they can't remove a saved line or Prioritization from a draft (changing
  amounts works). Granting them Delete on Turn-In Items + the two reduction tables (at their
  Create depth) would close it — safe now that `TurnInLineLock` blocks deletes on anything
  approved / processed / denied. **Decision pending.**
- The header AFP/Allotment override flags do nothing on FY27 (per-line entry replaces them).
- A State user creating RF-level lines is blocked in the builder only; the server gate is the
  RI / CSOR approval.
- The Prio's state is filtered in the builder (Fund Center → state) but not re-checked server-side
  (same as FY26).
- One RF per RF-level Turn-In in the builder; the server accepts more.
