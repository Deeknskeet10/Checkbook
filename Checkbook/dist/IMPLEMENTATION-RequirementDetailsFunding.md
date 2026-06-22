# Implementation: Requirement Details Direct Funding

Mirrors the Prio → Itemized Details → PrioritizationFunding chain for
Requirements that have **no Prioritization**. Each Requirement Detail becomes
the leaf funded unit, allocated from one or more Requirement Fundings through
a new `book_requirementdetailfunding` junction.

The Prio path and the RD-direct-funding path are mutually exclusive per
Requirement — enforced by `RequirementDetailFundingGuard`.

## Funding chain

```
LOA TDP  →  RF.book_newtdp  →  book_requirementdetailfunding  →  book_requirementdetails
                                  (per-(RD, RF) allocation)         (RD totals = sum of junctions)
```

The Requirement Funding's `book_newfundedamount` / `book_newvalidatedamount`
now **UNIONs** Prio-path sums and direct-funding-path sums; the XOR guard
guarantees only one source is ever non-zero per RF.

## Schema (owner: Eric)

### `book_requirementdetails` — add two columns

| Column                  | Type    | Notes                                             |
|-------------------------|---------|---------------------------------------------------|
| `book_validatedamount`  | Decimal | Sum of junction `book_validatedamount`. Plugin-managed. |
| `book_fundedamount`     | Decimal | Sum of junction `book_fundedamount`. Plugin-managed.    |

No Requested column — NPM is the only role that touches RDs in the
no-Prio path, and validation *is* effectively the request.

### `book_requirementdetailfunding` — new entity

Junction between Requirement Detail and Requirement Funding.

| Column                          | Type    | Notes                                                       |
|---------------------------------|---------|-------------------------------------------------------------|
| `book_requirementdetailfundingid` | PK    |                                                             |
| `book_name`                     | String  | Plugin auto-populates as `<RD> ↔ <RF>` on Create.           |
| `book_requirementdetail`        | Lookup  | → `book_requirementdetails`                                 |
| `book_requirementfunding`       | Lookup  | → `book_requirementfunding`                                 |
| `book_validatedamount`          | Decimal | NPM-edited via PCF.                                         |
| `book_fundedamount`             | Decimal | NPM-edited via PCF.                                         |

Add a 1:N relationship from `book_requirementfunding` to this junction so the
RF form can host a subgrid of junction rows.

## Plugins (`Checkbook_Plugins.dll`)

New code (build with `cd Plugins && dotnet build -c Release`):

| File                                                          | Role                                                         |
|---------------------------------------------------------------|--------------------------------------------------------------|
| `Constants/RequirementDetailFundingAttributes.cs`             | Junction schema constants.                                   |
| `Constants/EntityNames.cs` *(extended)*                       | Adds `RequirementDetailFunding`.                             |
| `Constants/RequirementDetailsAttributes.cs` *(extended)*      | Adds `ValidatedAmount`, `FundedAmount`.                      |
| `Helpers/RequirementDetailFundingRollupHelper.cs`             | Junction → RD totals, plus `SumForRequirementFunding`.       |
| `Helpers/PrioritizationRollupHelper.cs` *(extended)*          | `RecalculateRFFunded` now UNIONs Prio + RD direct funding.   |
| `Recalculations/RequirementDetailFundingRollup.cs`            | Junction events → recalc parent RD + parent RF.              |
| `Validation/RequirementDetailFundingGuard.cs`                 | Pre-Op guard: lookups, same Requirement, XOR, uniqueness, TDP cap. Also blocks Prio Create on a direct-funded Requirement. |

### Plugin Registration Tool — step registrations

`Checkbook_Plugins.dll` is delivered out-of-band; register the new steps
manually in PRT against the rebuilt assembly.

**`Checkbook.Plugins.Recalculations.RequirementDetailFundingRollup`**

| Stage | Message | Entity                          | Mode | Filter / PreImage                                                                                            |
|-------|---------|---------------------------------|------|---------------------------------------------------------------------------------------------------------------|
| Post  | Create  | `book_requirementdetailfunding` | Sync | —                                                                                                             |
| Post  | Update  | `book_requirementdetailfunding` | Sync | Filter: `book_fundedamount`, `book_validatedamount`, `book_requirementdetail`, `book_requirementfunding`, `statecode`. PreImage `"PreImage"` over the same fields. |
| Post  | Delete  | `book_requirementdetailfunding` | Sync | PreImage `"PreImage"` — `book_requirementdetail`, `book_requirementfunding`.                                  |

**`Checkbook.Plugins.Validation.RequirementDetailFundingGuard`**

| Stage | Message | Entity                          | Mode | Filter / PreImage                                                                            |
|-------|---------|---------------------------------|------|-----------------------------------------------------------------------------------------------|
| Pre   | Create  | `book_requirementdetailfunding` | Sync | —                                                                                             |
| Pre   | Update  | `book_requirementdetailfunding` | Sync | Filter: `book_requirementdetail`, `book_requirementfunding`, `book_fundedamount`, `book_validatedamount`. PreImage `"PreImage"` over the same fields. |
| Pre   | Create  | `book_prioritization`           | Sync | —                                                                                             |

## PCF: `ValidateAndFundRequirementDetailsGrid` (v0.1.0)

Bundled into `dist/ARNGCheckbookExtensions.zip` as
`book_ARNGCheckbook.ValidateAndFundRequirementDetailsGrid`.

Bound to a subgrid of `book_requirementdetailfunding` on the **Requirement
Funding** form. Each row is one junction (one (RD, RF) allocation); editing
Validated/Funded writes to the junction, plugins roll up to RD and RF.

### Form configuration

On the Requirement Funding form:

1. Add a subgrid pointed at the junction's 1:N relationship from RF.
2. Bind it to `ARNGCheckbook.ValidateAndFundRequirementDetailsGrid`.
3. Map the four dataset properties:
   - `requirementDetail` → `book_requirementdetail`
   - `name` → `book_name`
   - `validatedAmount` → `book_validatedamount`
   - `fundedAmount` → `book_fundedamount`
4. The existing `ValidateAndFundGrid` (Prio subgrid) can sit on the same form —
   each PCF self-hides when its dataset is empty, and the XOR guard guarantees
   only one is ever populated.

## Delivery

```bash
# Rebuild and re-stage the extensions zip
cd Checkbook/solution/ARNGCheckbookExtensions
dotnet build -c Release
cp bin/Release/ARNGCheckbookExtensions.zip ../../dist/

# Build plugins for registration
cd ../../Plugins
dotnet build -c Release
# → bin/Release/net462/Checkbook_Plugins.dll
```

Import order in the environment:

1. Add the two columns to `book_requirementdetails` and create
   `book_requirementdetailfunding` (manually in the maker portal).
2. Import `dist/ARNGCheckbookExtensions.zip`.
3. Register the new plugin steps in PRT against the rebuilt
   `Checkbook_Plugins.dll`.
4. Add the subgrid + bind the PCF on the Requirement Funding form.

## Invariants

- A Requirement is **either** on the Prio path **or** the direct-RD-funding
  path, never both (`RequirementDetailFundingGuard`).
- `book_requirementdetails.book_validatedamount` and `book_fundedamount` are
  sums of active `book_requirementdetailfunding` rows — never written by the
  PCF or by hand.
- `book_requirementfunding.book_newfundedamount` /
  `book_newvalidatedamount` = sum of Approved-Active Prios (legacy path) +
  sum of Active junction rows (new path).
- `book_requirementdetailfunding.book_fundedamount` total per RF is capped at
  `RF.book_newtdp` — enforced Pre-Op by the guard.
