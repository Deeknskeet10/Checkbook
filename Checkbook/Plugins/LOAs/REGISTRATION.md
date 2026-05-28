# LOA Generation — Plugin Registration

Cheat sheet for registering the FY27 LOA-generation plugins in the Plugin
Registration Tool. All three live in `Checkbook_Plugins.dll`, namespace
`Checkbook.Plugins.LOAs`.

Replaces (deactivate, don't delete):
- Cloud flow **`FundingTrack-GenerateLOAs`**
- Classic workflow **`LineofAccounting-Initialization`**

## Prerequisites in Dataverse

1. **Alternate key** on `book_fundingline`:
   - Name: `book_LOAUniqueName` (or any name; the plugins don't reference it).
   - Field: `book_name`.
   - Keep the existing `book_LOAUniqueKey` composite key in place — it still
     enforces uniqueness for FY26 rows.
2. **Custom API**: `book_GenerateLOAs`
   - Unique name: `book_GenerateLOAs`
   - Binding type: **Global** (unbound).
   - Is function: **No**.
   - Allowed custom processing step type: **Async + Sync**.
   - Plugin type: **`Checkbook.Plugins.LOAs.LOAGenerator`** (set after the assembly is registered).
   - Request parameter:
     | Name | Type | Optional | Notes |
     |---|---|---|---|
     | `FiscalYear` | Integer | Yes | Fund FY option-set value. `0` or omitted = all FYs. |
   - Response properties:
     | Name | Type |
     |---|---|
     | `Created` | Integer |
     | `Linked`  | Integer |
     | `Skipped` | Integer |

## Plugin steps

### 1. `LOAGenerator` — Custom API handler

| Setting | Value |
|---|---|
| Message | `book_GenerateLOAs` |
| Primary Entity | _(none — unbound)_ |
| Event Pipeline | PostOperation (40) |
| Execution Mode | Synchronous |
| Deployment | Server |
| Run in user's context | Calling User |
| Images | — |

> Dataverse wires the handler automatically once the Custom API's
> "Plugin Type" field points at `Checkbook.Plugins.LOAs.LOAGenerator`. No
> separate step registration is required.

### 2. `LOANameSetter` — LOA name + FY on create

| Setting | Value |
|---|---|
| Message | `Create` |
| Primary Entity | `book_fundingline` |
| Event Pipeline | **PreOperation (20)** |
| Execution Mode | Synchronous |
| Deployment | Server |
| Filtering Attributes | _(none — runs on every create)_ |
| Images | — |

### 3. `FundingTrackLOASynchronizer` — relink on grain change

| Setting | Value |
|---|---|
| Message | `Update` |
| Primary Entity | `book_fundingtrack` |
| Event Pipeline | **PreOperation (20)** |
| Execution Mode | Synchronous |
| Deployment | Server |
| Filtering Attributes | `book_disbursingofficial, book_fund, book_boc, book_dollartype, book_pg, book_sag, book_mdep` |
| PreImage Name | `PreImage` |
| PreImage Attributes | `book_disbursingofficial, book_fund, book_boc, book_dollartype, book_pg, book_sag, book_mdep, book_ape, book_lineofaccountingloa, owningbusinessunit` |

Step ordering: this synchronizer is **PreOp**; the existing
`FundingTrackTDPRecalculator` is **PostOp**. They run in the same pipeline
at the same depth, so the recalculator sees both the pre-image's old LOA
and the synchronizer's new LOA on the target — and rolls up both. Don't
add a `Depth > 1` skip to the synchronizer for the same reason.

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
