# dist/

Pre-built, importable artifacts — committed so they can be pulled and imported
without a local build.

## `ARNGCheckbookExtensions.zip`

The **unmanaged** delivery solution (publisher `ARNGCheckbook`, prefix `book`)
containing the PCF controls:

- `book_ARNGCheckbook.ItemizedDetailsGrid` — v0.3.0: adds the editable **Fund
  Center** column (lookup filtered to the states FCs; blank = state level).
  v0.2.0 made Itemized Details **user-selected** — an Add Items dialog lists
  the parent Requirement's Details, plus per-row Remove; auto-populate is
  retired (see the migration note in
  [`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md))
- `book_ARNGCheckbook.PrioritizationFundingGrid` — v0.2.5: Itemized Detail
  sub-rows show their Fund Center (read-only)
- `book_ARNGCheckbook.PrioritizationSpendPlanGrid` — v0.2.0: the **Breakout**
  spend-plan surface on the Prioritization form (filters to Breakout PFs via
  the new bound `spendPlanMode` property; non-breakout allocations are counted
  in a banner). See [`IMPLEMENTATION-FY27SpendPlan.md`](./IMPLEMENTATION-FY27SpendPlan.md).
- `book_ARNGCheckbook.RequirementSpendPlanGrid` — v0.1.0 (new): the **Centrally
  Managed** (Mode-A) plan on the Requirement form — one section per Requirement
  Funding (per FY), RF-anchored, shown only for `book_national` requirements.
- `book_ARNGCheckbook.StateSpendPlanGrid` — v0.1.0 (new): the **State-Rollup**
  (Mode-C) plan on a new custom page keyed by State + FY — one section per
  (Fund, SAG) bucket, funded read-only from the rollup.
  Grain model (Breakout / State-Rollup / Centrally Managed), schema, and past-FY
  immutability design: [`DESIGN-SpendPlanModes.md`](./DESIGN-SpendPlanModes.md);
  schema setup: [`SETUP-SpendPlanModes-Schema.md`](./SETUP-SpendPlanModes-Schema.md)
- `book_ARNGCheckbook.PrioritizationsForRequirement`
- `book_ARNGCheckbook.RequirementDetailFundingGrid`
- `book_ARNGCheckbook.RequirementDetailsRank`
- `book_ARNGCheckbook.RequirementFundingTab` — composite Funding tab; see
  [`IMPLEMENTATION-RequirementFundingTab.md`](./IMPLEMENTATION-RequirementFundingTab.md)
- `book_ARNGCheckbook.ValidateAndFundGrid`
- `book_ARNGCheckbook.ValidateAndFundRequirementDetailsGrid` — see
  [`IMPLEMENTATION-RequirementDetailsFunding.md`](./IMPLEMENTATION-RequirementDetailsFunding.md)

Import it into the Dataverse environment, then bind each control to its host
field/subgrid in the form designer. The plugins are delivered separately via
the Plugin Registration Tool — build `Checkbook_Plugins.dll` from `Plugins/`
and register it with the Plugin Registration Tool.

Rebuilt from `solution/ARNGCheckbookExtensions/` with `dotnet build -c Release`;
refresh this file whenever the controls change.
