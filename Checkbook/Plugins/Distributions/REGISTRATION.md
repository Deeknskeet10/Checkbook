# Generate Distributions — Plugin Notes

Deep-dive doc for the FY27 Distribution-generation plugin (namespace
`Checkbook.Plugins.Distributions`).

> **Canonical step registration lives in
> [`../PLUGIN-REGISTRATION.md`](../PLUGIN-REGISTRATION.md) under the
> `## Distributions` section.** This file covers the *prerequisites* (env
> var, Custom API definition), the algorithm by phase, failure modes, and
> the smoke-test sequence.

Replaces (deactivate, don't delete):
- Cloud flow **`Distribution-GenerateAFPDistributions`**

## Prerequisites in Dataverse

1. **Environment variable** `book_DistributionHoldingFundCenter`
   - Schema name: `book_DistributionHoldingFundCenter`
   - Data type: **Text** (`100000000`)
   - Required: yes
   - Definition ships via `solution/ARNGCheckbookExtensions` (already authored).
   - Current value (the actual holding FC's GUID — the A18 record today) must be set
     per environment in the maker portal after the solution is imported.
2. **Custom API**: `book_GenerateDistributions`
   - Unique name: `book_GenerateDistributions`
   - Binding type: **Global** (unbound).
   - Is function: **No**.
   - Allowed custom processing step type: **Sync only**.
   - Execute privilege: a role granted to the PowerApps button caller.
   - Plugin type: **`Checkbook.Plugins.Distributions.GenerateDistributionsPlugin`**
     (set after the assembly is registered).
   - Request parameters:
     | Name | Type | Optional | Notes |
     |---|---|---|---|
     | `FundingType`       | Integer | Yes | `0` = AFP only, `1` = Allotment only. Omit to process both. |
     | `FiscalYear`        | Integer | Yes | Option-set value on `book_fund.book_fiscalyear` (e.g. FY26). Omit / `0` → process all FYs. |
     | `NextToken`         | String  | Yes | Echo the previous response's `NextToken` to resume. Omit / empty → fresh start. (Renamed from `ContinuationToken` — see note below.) |
   - Response properties:
     | Name | Type | Notes |
     |---|---|---|
     | `Deactivated`       | Integer | Pending sweep rows deactivated (no longer needed / duplicate / orphaned). Per-invocation count (caller sums across passes). |
     | `Created`           | Integer | Per-invocation count. |
     | `Updated`           | Integer | Pending sweep rows amended in place (amount / FE retag / re-pairing). Per-invocation count. **Added Jul 2026** — create this response property when deploying the amend-in-place build. |
     | `TurnInsCreated`    | Integer | Per-invocation count. |
     | `Skipped`           | Integer | Per-invocation count. |
     | `NextToken`         | String  | Empty → done. Non-empty → call again with this value as input. |

   > **Naming note:** the wire-level parameter is `NextToken`. It was originally
   > `ContinuationToken`, but that name is unusable in the target org: an
   > earlier `ContinuationToken` response property was created with Type=Boolean,
   > and its backing `sdkmessageresponsefield` row survived every delete
   > (Dataverse refuses `DELETE` on `sdkmessageresponsefield`), so any new
   > String-typed `ContinuationToken` property is shadowed by the Boolean
   > orphan at marshal time and non-empty strings throw a conversion error.
   > `NextToken` is a fresh name with no ancestor to shadow it.

## Execution mode

The Custom API's "Plugin Type" field auto-wires the handler — no separate
`SdkMessageProcessingStep` registration is required beyond setting that field.

**Run Sync.** The plugin self-budgets to ~105s of the 120s sandbox ceiling and
returns a `ContinuationToken` when more work remains. The caller (the
`book_generateDistributions` JS web resource) loops, passing each token back as
input, until the token comes back empty. Async execution would suppress the
output parameters and break the loop.

> **Migrating an existing Async registration:** if the step is currently Async
> (the original design), update the Custom API record's *Allowed Custom
> Processing Step Type* to `Sync` (and ensure the wired step itself is Sync) —
> re-import the assembly, then re-publish the JS web resource.

## What the plugin does

**Amend-in-place model (Jul 2026 rework).** The original design deactivated
every pending (`book_newenteredintogfebs = "No"`) row up front and recreated
reconcile rows from scratch — destroying pending Turn-In / State Swap / manual
rows and churning row GUIDs for the GFEBS clerks working the queue. The
reworked plugin instead classifies every active row in a (Fund, PG) group:

- **Immutable** — already entered into GFEBS (`book_entrydocumentnumber`
  set), manual entries (`book_manualentry`), Turn-In / State Swap / Realignment–linked
  rows (`book_turnin` / `book_stateswap` / `book_realignment`), and credits whose
  paired debit is already entered. Counted toward each FC's committed net; never modified.
- **Pending sweep rows** — everything else (no entry document number, not
  manual, not linked). Owned by the reconcile: amounts are updated in place,
  rows are created when missing and deactivated when no longer needed.

Phases:

1. **Resolve active Funding Events** — Filtered by `FundingType` input if supplied,
   else both. An event qualifies when `book_startdate ≤ today ≤ book_enddate` AND
   `statecode = 0`. Phases 2 + 3 run once per matching event. Re-resolved each
   invocation so list changes between passes don't break resumption (the cursor
   stores the FE Guid, not its index).
2. **Phase 2 — Prioritizations** — FetchXML aggregate of active
   Prioritizations with `book_newfundedamounttdp > 0`, collapsed by
   destination `(fund, state-level FC, PG, FY)` (FC = the Prio's FC walked up
   the parent chain to the child of the holding FC). FY filter (when
   `FiscalYear` input is set) constrains on `book_fund.book_fiscalyear`.
   Per destination:
   - target = `Σ funded × book_fundingdetails.book_distributionpercentage / 100`,
     where the FundingDetails row is keyed by `(FundingEvent, PG, Fund)`.
   - delta = target − committed immutable net (credits − debits) at the FC.
   - delta > 0 → the FC's pending credit is amended to carry exactly delta
     (created if missing; duplicate pending credits deactivated).
   - delta < 0 → pending credit deactivated; overage flows to the per-FC
     Sweep Turn-In (AFP / Allotment columns tracked independently).
   - delta = 0 → pending credit deactivated; Sweep Turn-In per-type amount
     zeroed. Once BOTH type amounts reach 0 the tracker is **deleted**, not
     deactivated (changed Aug 2026 — spent zero-amount trackers piled up as
     clutter, one per resolved overage). Safe because an open sweep tracker
     (active, not BE-approved) has no items, ledgers, or distributions
     attached. ⚠ No security role grants Delete on `book_turnin` — the
     delete works because plugins run under the sysadmin super user; if the
     execution identity ever changes, this is the first thing that breaks.
   After the destinations, the ONE pending debit at the holding FC is synced
   to Σ of all live pending credits in the (Fund, PG) group (created /
   amended / deactivated accordingly); credits point at it via
   `book_debiteddistribution`.
3. **Phase 3 — Requirements** — Same reconciliation against BE-approved
   Requirements (`book_approvalstatus = 7`) of types TARC (1) + ARNGExternal (4)
   that have no active Prioritizations. Same FC walk and FY filter apply.
   Phase 2 destinations (state-level FCs) and Phase 3 destinations (TARC-level
   FCs, which sit in their own branch of the FC tree) are expected to be
   disjoint — each phase reconciles only its own target against the full
   committed net at the FC, so a shared destination would make the two passes
   fight (spurious Sweep Turn-Ins, pending-credit clobbering). A warn-only
   tripwire traces `WARNING: destination … appears in BOTH Phase 2 and
   Phase 3 buckets` if that assumption ever breaks; if it fires, the phases
   need to be merged into one combined bucket set.
4. **Phase 4 — Orphan cleanup** — Pending sweep credits whose
   `(Fund, FC, PG)` matches no current bucket (funded dropped to zero, FC
   re-parented, FY filtered out) are deactivated, and every pending
   holding-FC debit is re-synced to the sum of its surviving credits
   (deactivated when none remain). A pending credit paired to an already
   GFEBS-entered debit is left alone. Honors the `FundingType` and
   `FiscalYear` input filters so an AFP-only run never touches Allotment rows.

## Continuation & time budget

The plugin tracks a `Stopwatch` with a 105-second wall-clock budget (below the
120 s sandbox kill). Between buckets it checks the budget; if exceeded it
returns a `NextToken` of the form `phase=<2|3>;fe=<guid>;idx=<n>` (or `phase=4`
for the cleanup phase) and stops. The caller pumps the API in a loop, passing
the previous token in until the response token is empty. Legacy `phase=1`
tokens (from the retired deactivation sweep) parse as a fresh start.

- Output counters (`Deactivated`, `Created`, `Updated`, `TurnInsCreated`,
  `Skipped`) are **per-invocation**, not cumulative — the JS caller sums them
  across passes.
- Bucket processing is idempotent (re-running an already-balanced bucket
  changes nothing: the pending credit already carries delta → no update; open
  Turn-In already carries the overage → no update), and steady-state runs
  keep pending row GUIDs stable. The cursor's bucket index is best-effort —
  if aggregate row order shifts between invocations, a re-pass may re-process
  a few buckets (harmless, idempotent) or miss a few; missed buckets get
  picked up on the next full button press. Phase 4 restarts from scratch on
  resume — its queries exclude already-deactivated rows.

## Open Turn-In definition

A bucket has an "open" Turn-In when there exists a `book_turnin` row matching
`(Fund, FC, PG)` with `statecode = 0` and `book_beapproved = false`. When one
exists, the plugin skips Turn-In creation for that bucket (avoids duplicates).

## Failure modes

- Env var not defined / empty / unparsable → `InvalidPluginExecutionException`
  with a clear "set the GUID" message (see `EnvironmentVariableHelper`).
- No matching FundingDetails for `(event, PG, fund)` → bucket counted in
  `Skipped`, trace explains why.
- No active Funding Event(s) for the requested FundingType → Phases 2 + 3 are
  skipped, but Phase 4 (orphan cleanup) still runs — it only deactivates
  pending rows whose bucket vanished, so rows waiting on an expired Funding
  Event survive as long as their bucket still exists.

## Smoke test sequence

1. Set `book_DistributionHoldingFundCenter` to the A18 record's GUID and add
   the `Updated` response property to the Custom API (see table above).
2. Invoke `book_GenerateDistributions` (no params) on a quiet environment:
   - For a known bucket missing its credits, expect a fresh debit/credit pair.
3. Re-invoke immediately → `Created = 0`, `Updated = 0`, `Deactivated = 0`
   (idempotent), and the pending rows keep the SAME record ids (note a credit's
   GUID before/after).
4. Increase a Prioritization's funded TDP, re-invoke → the existing pending
   credit's **amount changes in place** (`Updated ≥ 2` — credit + debit
   re-sync); no new row.
5. Set `book_entrydocumentnumber` on that credit (and its debit), re-invoke →
   both rows untouched; a further funded-TDP increase now produces a NEW
   pending pair for the delta only.
6. Decrease funded TDP below the committed credits, re-invoke → pending credit
   deactivated and/or an overage Turn-In appears (only if none is open for the
   bucket).
7. Zero out a bucket entirely (funded TDP → 0), re-invoke → its pending credit
   is deactivated by Phase 4 and the holding-FC debit shrinks (or deactivates
   when it was the last credit).
8. Approve a Turn-In, then re-invoke → the Turn-In's pending Distributions
   survive untouched (the retired Phase 1 used to deactivate them).
9. BE-approve a 2-leg State Swap (A→B and B→A) → per funding type with an
   active event, 8 swap-linked rows appear (2 pairs per direction through
   A18); re-invoke the API → they are treated as committed (no churn).
10. Invoke with `FundingType = 1` → confirm only the Allotment Funding Event
   contributes (AFP event ignored, even if active) and Phase 4 leaves AFP
   pending rows alone.
11. Invoke with `FiscalYear = <FY26 option value>` → confirm only FY26 buckets
   are touched; bucket counts in the trace drop accordingly.
12. With a workload large enough to exceed ~105 s in one pass, invoke from the
   command-bar button → the JS loop should pump 2+ passes, the progress
   indicator should tick `pass 1, 2, …`, and the completion dialog should
   report the summed counters across passes.
