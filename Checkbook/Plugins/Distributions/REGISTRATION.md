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
   - Allowed custom processing step type: **Async + Sync**.
   - Execute privilege: a role granted to the PowerApps button caller.
   - Plugin type: **`Checkbook.Plugins.Distributions.GenerateDistributionsPlugin`**
     (set after the assembly is registered).
   - Request parameter:
     | Name | Type | Optional | Notes |
     |---|---|---|---|
     | `FundingType` | Integer | Yes | `0` = AFP only, `1` = Allotment only. Omit to process both. |
   - Response properties:
     | Name | Type |
     |---|---|
     | `Deactivated`    | Integer |
     | `Created`        | Integer |
     | `TurnInsCreated` | Integer |
     | `Skipped`        | Integer |

## Execution mode

The Custom API's "Plugin Type" field auto-wires the handler — no separate
`SdkMessageProcessingStep` registration is required beyond setting that field.

**Run Async.** The PowerApps caller gets an immediate ack instead of blocking
on the 2-minute sync limit. Surface the async system job's terminal status
back to the user (poll or push).

## What the plugin does

1. **Phase 1** — Deactivate every active `book_distributions` row where
   `book_newenteredintogfebs = "No"`. Single Update writing `statecode = 1`.
2. **Resolve active Funding Events** — Filtered by `FundingType` input if supplied,
   else both. An event qualifies when `book_startdate ≤ today ≤ book_enddate` AND
   `statecode = 0`. Phases 2 + 3 run once per matching event.
3. **Phase 2 — Prioritizations** — FetchXML aggregate of active non-national
   Prioritizations with `book_newfundedamounttdp > 0`, grouped by
   `(parent_fc, state, PG, fund, FY)`. Per bucket:
   - target = `Σ funded × book_fundingdetails.book_distributionpercentage / 100`,
     where the FundingDetails row is keyed by `(FundingEvent, PG, Fund)`.
   - existing = `Σ active credit distros` for `(Fund, parent_fc, PG)`.
   - shortfall → create debit/credit pair (debit FC = holding FC, credit FC = parent FC).
   - overage AND no open Turn-In → create overage Turn-In on the parent FC.
4. **Phase 3 — Requirements** — Same reconciliation against BE-approved
   Requirements (`book_approvalstatus = 7`) of types TARC (1) + ARNGExternal (4),
   or national State-type (`book_national = 1 AND book_type = 0`). FC resolved
   as parent-or-self via `parent ∈ {holding_fc, null} → self`.

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
