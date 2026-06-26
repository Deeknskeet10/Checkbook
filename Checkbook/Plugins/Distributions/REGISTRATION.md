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
     | `ContinuationToken` | String  | Yes | Echo the previous response's `ContinuationToken` to resume. Omit / empty → fresh start. |
   - Response properties:
     | Name | Type | Notes |
     |---|---|---|
     | `Deactivated`       | Integer | Per-invocation count (caller sums across passes). |
     | `Created`           | Integer | Per-invocation count. |
     | `TurnInsCreated`    | Integer | Per-invocation count. |
     | `Skipped`           | Integer | Per-invocation count. |
     | `ContinuationToken` | String  | Empty → done. Non-empty → call again with this value as input. |

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

1. **Phase 1** — Deactivate every active `book_distributions` row where
   `book_newenteredintogfebs = "No"`. Batched per 500-row page into one
   `ExecuteMultipleRequest`. Skipped on resume (when the input
   `ContinuationToken` indicates we're already past Phase 1).
2. **Resolve active Funding Events** — Filtered by `FundingType` input if supplied,
   else both. An event qualifies when `book_startdate ≤ today ≤ book_enddate` AND
   `statecode = 0`. Phases 2 + 3 run once per matching event. Re-resolved each
   invocation so list changes between passes don't break resumption (the cursor
   stores the FE Guid, not its index).
3. **Phase 2 — Prioritizations** — FetchXML aggregate of active non-national
   Prioritizations with `book_newfundedamounttdp > 0`, grouped by
   `(parent_fc, state, PG, fund, FY)`. FY filter (when `FiscalYear` input is set)
   constrains on `book_fund.book_fiscalyear`. Per bucket:
   - target = `Σ funded × book_fundingdetails.book_distributionpercentage / 100`,
     where the FundingDetails row is keyed by `(FundingEvent, PG, Fund)`.
   - existing = `Σ active credit distros` for `(Fund, parent_fc, PG)`.
   - shortfall → create debit/credit pair (debit FC = holding FC, credit FC = parent FC).
   - overage AND no open Turn-In → create overage Turn-In on the parent FC.
4. **Phase 3 — Requirements** — Same reconciliation against BE-approved
   Requirements (`book_approvalstatus = 7`) of types TARC (1) + ARNGExternal (4),
   or national State-type (`book_national = 1 AND book_type = 0`). FC resolved
   as parent-or-self via `parent ∈ {holding_fc, null} → self`. Same FY filter
   applies.

## Continuation & time budget

The plugin tracks a `Stopwatch` with a 105-second wall-clock budget (below the
120 s sandbox kill). Between buckets it checks the budget; if exceeded it
returns a `ContinuationToken` of the form `phase=<2|3>;fe=<guid>;idx=<n>` and
stops. The caller pumps the API in a loop, passing the previous token in until
the response token is empty.

- Output counters (`Deactivated`, `Created`, `TurnInsCreated`, `Skipped`) are
  **per-invocation**, not cumulative — the JS caller sums them across passes.
- Bucket FetchXML queries carry explicit `<order>` clauses on the groupby
  aliases so the cursor's bucket index stays stable across passes.
- Bucket processing is roughly idempotent (re-running an already-balanced
  bucket creates no new rows), so a mid-bucket interruption that re-runs that
  bucket on resume is safe.

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
  skipped, but Phase 1 still runs.

## Smoke test sequence

1. Set `book_DistributionHoldingFundCenter` to the A18 record's GUID.
2. Mark one existing active Distribution `book_newenteredintogfebs = "No"`.
3. Invoke `book_GenerateDistributions` (no params):
   - That Distribution should now be `statecode = 1`.
   - `Deactivated ≥ 1`.
   - For a known bucket missing its credits, expect a fresh debit/credit pair.
4. Re-invoke immediately → `Created = 0` (idempotent: target now equals existing).
5. Increase a Prioritization's funded TDP, re-invoke → expect a top-up pair.
6. Decrease it below the existing credits, re-invoke → expect an overage Turn-In
   (only if none is open for the bucket).
7. Invoke with `FundingType = 1` → confirm only the Allotment Funding Event
   contributes (AFP event ignored, even if active).
8. Invoke with `FiscalYear = <FY26 option value>` → confirm only FY26 buckets
   are touched; bucket counts in the trace drop accordingly.
9. With a workload large enough to exceed ~105 s in one pass, invoke from the
   command-bar button → the JS loop should pump 2+ passes, the progress
   indicator should tick `pass 1, 2, …`, and the completion dialog should
   report the summed counters across passes.
