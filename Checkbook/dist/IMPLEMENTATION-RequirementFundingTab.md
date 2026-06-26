# Implementation: Requirement Funding Tab

`book_ARNGCheckbook.RequirementFundingTab` is a **field PCF** that owns the
entire **Funding tab** on the Requirement form. One sticky Fiscal Year picker
at the top drives every section; section visibility is computed from whether
the Requirement has Prioritizations and/or Requirement Details.

## What it renders

| # | Section                             | Source PCF / shape                                | Shown when                          |
|---|-------------------------------------|---------------------------------------------------|-------------------------------------|
| 1 | Requirement Details                 | embeds `RequirementDetailsRank`                   | RDs exist on the Requirement        |
| 2 | Requirement Fundings                | container-owned read-only table (row → openForm)  | Always (FY-filtered)                |
| 3 | Funding by Prioritizations          | embeds `PrioritizationFundingGrid`                | Prios exist on the Requirement      |
| 4 | Funding by Requirement Details      | embeds `RequirementDetailFundingGrid`             | RDs exist **and no** Prios          |

The Prio-XOR-RD path matches `RequirementDetailFundingGuard` (see
[`IMPLEMENTATION-RequirementDetailsFunding.md`](./IMPLEMENTATION-RequirementDetailsFunding.md)) —
when both happen to be present in a transitional state, Prios win.

## Why a container PCF (not four sections)

- One FY picker drives every section — no per-section pickers to keep in sync.
- Section visibility is computed in TypeScript, not in form script.
- The three child PCFs stay shippable as standalone controls; the container
  imports them via relative path so there is no code duplication. The bundle
  is ~165 KiB because it includes the three child apps inline.

## Form configuration (maker portal)

> The form layout is authored in the maker portal, **not** in the unpacked
> source — these steps replace the current 4-section Funding tab in-place.

1. Open the Requirement main form in the form designer.
2. Find the **Funding** tab and remove its existing sections:
   - Requirement Details
   - Requirement Fundings
   - Funding by Prioritizations
   - Funding by Requirement Details
3. Add a single new section to the Funding tab. Hide its label.
4. Drop a text field onto the section — `book_name` works well. The bound
   field's value is ignored by the control; it only acts as a host.
   - Hide the field label.
   - Set the field to **read-only**.
5. With the field selected, open **Components → Get more components → Code**
   and add `ARNGCheckbook.RequirementFundingTab` (v0.1.0+).
6. In the field's component panel, switch the renderer to
   `RequirementFundingTab` for Web (Phone / Tablet too if you want it on
   mobile). Hide the default text-field renderer.
7. Save and publish.

The Funding tab now renders only the container PCF — the FY picker is sticky
at the top, and sections appear/disappear based on the Requirement's Prio and
RD state.

## What the container reads

- `parentRequirementId` from `context.mode.contextInfo.entityId` (the form's
  saved Requirement record).
- `book_prioritization` rows where `_book_requirement_value eq <reqId> and
  statecode eq 0`.
- `book_requirementdetails` rows where `_book_requirement_value eq <reqId> and
  statecode eq 0`.
- `book_requirementfunding` rows where `_book_requirement_value eq <reqId> and
  statecode eq 0`.

FY options are derived from the union of FY values present on the Prios and
RFs. The default selection is the current Federal FY (Oct–Sept, named for
ending year — Oct 2025 → "FY 2026") if it appears in the data; otherwise the
newest FY available.

## What changed in the three child PCFs

To support being embedded in the container while remaining usable
standalone, each child PCF gained optional props:

### `RequirementDetailsRank` (v0.2.2)

| Prop                    | Type                            | Purpose                                       |
|-------------------------|---------------------------------|-----------------------------------------------|
| `dataset`               | `DataSet?`                      | Now optional; required only standalone.       |
| `initialRowsOverride`   | `RequirementDetailsRankRow[]?`  | Pre-fetched RDs instead of dataset binding.   |
| `onRefresh`             | `() => void`                    | Replaces `dataset.refresh()` when embedded.   |
| `hideHeader`            | `boolean`                       | Suppress the in-PCF title.                    |

### `PrioritizationFundingGrid` (v0.2.3)

| Prop                    | Type                       | Purpose                                              |
|-------------------------|----------------------------|------------------------------------------------------|
| `dataset`               | `DataSet?`                 | Now optional.                                        |
| `prioRowsOverride`      | `PrioRow[]?`               | Pre-fetched Prios from the container.                |
| `fyFilterOverride`      | `number \| "all"?`         | Lock FY filter; hides internal picker when set.      |
| `hideFyPicker`          | `boolean`                  | Hide the picker without locking the value.           |
| `hideTitle`             | `boolean`                  | Suppress the toolbar title.                          |
| `onAfterSave`           | `() => void`               | Container refresh hook in addition to dataset.       |

### `RequirementDetailFundingGrid` (v0.1.2)

Same prop additions as `PrioritizationFundingGrid`, with `rdRowsOverride: RDRow[]`
instead of `prioRowsOverride`. The internal "RF FY" picker is suppressed when
`fyFilterOverride` is set.

## Delivery

```bash
# Rebuild and stage the extensions zip
cd Checkbook/solution/ARNGCheckbookExtensions
dotnet build -c Release
cp bin/Release/ARNGCheckbookExtensions.zip ../../dist/
```

Import `dist/ARNGCheckbookExtensions.zip` into the environment, then perform
the form configuration above on the Requirement main form.

## Invariants

- The container reads the parent Requirement ID from page context — it does
  **not** rely on the bound field's value, so any text field on
  `book_requirements` will work as a host.
- The Prio path and the RD-direct-funding path remain mutually exclusive
  (`RequirementDetailFundingGuard`); the visibility matrix in this control
  reflects that XOR.
- Each section's FY filter is the same FY picked at the top of the tab. When
  the user changes FY, all sections re-filter in lockstep.
