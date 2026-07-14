# LOA Generation — Plugin Notes

Deep-dive doc for the FY27 LOA-generation plugins (namespace
`Checkbook.Plugins.LOAs`).

> **Canonical step registrations live in
> [`../PLUGIN-REGISTRATION.md`](../PLUGIN-REGISTRATION.md) under the
> `## LOAs` section.** This file covers the *prerequisites* (alternate key,
> Custom API definition), step-ordering contract with
> `FundingTrackTDPRecalculator`, and the smoke-test sequence.

Replaces (deactivate, don't delete):
- Cloud flow **`FundingTrack-GenerateLOAs`**
- Classic workflow **`LineofAccounting-Initialization`**

## Prerequisites in Dataverse

1. **Alternate key** on `book_fundingline`:
   - Name: `book_LOAUniqueName` (or any name; the plugins don't reference it).
   - Field: `book_name`.
   - Keep the existing `book_LOAUniqueKey` composite key in place — it still
     enforces uniqueness for FY26 rows.
1a. **FY27 fund-model columns** (see the "Schema + env vars" checklist in
   [`../PLUGIN-REGISTRATION.md`](../PLUGIN-REGISTRATION.md)): table
   `book_fundedprogram`, lookup `book_newfundedprogram` on `book_fund`, and
   the `book_category` choice (explicit values matching
   `Constants/CategoryValues.cs`) on `book_fundingtrack` + `book_fundingline`.
   FY27+ LOA names are `{OPR}-{Fund}-{PG or SAG}-{FundedProgram}-{Category}`;
   the name builder refuses FY27+ grains missing either part, so FY27 FTs
   without a Category (or Funds without a Funded Program) are skipped and
   surface in the Custom API's `Skipped` count.
2. **Custom API**: `book_GenerateLOAs`
   - Unique name: `book_GenerateLOAs`
   - Binding type: **Global** (unbound).
   - Is function: **No**.
   - Allowed custom processing step type: **Async + Sync**.
   - Plugin type: **`Checkbook.Plugins.LOAs.LOAGenerator`** (set after the assembly is registered).
   - Request parameters:
     | Name | Type | Optional | Notes |
     |---|---|---|---|
     | `FiscalYear` | Integer | Yes | Fund FY option-set value. `0` or omitted = all FYs. |
     | `BatchSize`  | Integer | Yes | Max Funding Tracks to attempt this invocation. `0` or omitted = unlimited. Use with `Remaining` to pump large backlogs in slices. |
   - Response properties:
     | Name | Type | Notes |
     |---|---|---|
     | `Created` | Integer | |
     | `Linked`  | Integer | |
     | `Skipped` | Integer | |
     | `Failed`  | Integer | FTs that threw during processing (per-FT failures do not abort the run). |
     | `Remaining` | Integer | FTs left unprocessed when `BatchSize` capped the run; re-invoke until 0. |
     | `FailedDetails` | String | Semicolon-joined `FT id: error` list for the `Failed` count. |

## Step-ordering contract

`FundingTrackLOASynchronizer` is **PreOp**; the existing
`FundingTrackTDPRecalculator` is **PostOp**. They run in the same pipeline
at the same depth, so the recalculator sees both the pre-image's old LOA
and the synchronizer's new LOA on the target — and rolls up both. **Don't
add a `Depth > 1` skip to the synchronizer for the same reason.**

The full step rows are in
[`../PLUGIN-REGISTRATION.md`](../PLUGIN-REGISTRATION.md).

## Leave alone — existing TDP roll-up

`FundingTrackTDPRecalculator` (PostOp Create/Update/Delete on
`book_fundingtrack`) does NOT change. Its `Depth > 1` guard intentionally
skips when our Custom API issues recursive FT updates — in that path
`LOAGenerator` drives `TDPCalculationHelper.BatchRecalculateLOATDP`
itself at the end of its run.

## Smoke test sequence

1. Create a fresh FT with all grain fields set, no LOA linked.
2. Invoke `book_GenerateLOAs` (no params): expect `Created=1, Linked=0, Skipped=0`,
   FT now linked, LOA name matches the canonical format, LOA TDP = FT amount.
3. Change the FT's BOC to a new value: expect FT relinked to a different LOA
   (or freshly created), old LOA's TDP drops, new LOA's TDP rises.
4. Create a second FT with the same grain as the first: invoke
   `book_GenerateLOAs` again — expect `Created=0, Linked=1`, both FTs share
   the same LOA, LOA TDP = sum of both FTs.
5. Try to create an LOA in the UI with a duplicate name → Dataverse rejects
   it on the `book_LOAUniqueName` alternate key.

### FY27 additions

6. Create an FY27 FT (Fund name ending in 27+, Fund has a Funded Program,
   FT has a Category): expect an LOA named
   `{OPR}-{Fund}-{PG/SAG}-{FP}-{Category}` with `book_category` set and
   BOC / DollarType / MDEP empty.
7. Change that FT's Category: expect relink to a different/new LOA, TDP
   moving with it (same behavior as the FY26 BOC swap in step 3).
8. Create an FY27 FT whose Fund has no Funded Program (or FT has no
   Category): expect `Skipped` to increment and no LOA created.
9. Re-run step 1–4 with an FY26 FT afterward to confirm the legacy path is
   untouched.
