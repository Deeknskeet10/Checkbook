# dist/

Pre-built, importable artifacts — committed so they can be pulled and imported
without a local build.

## `ARNGCheckbookExtensions.zip`

The **unmanaged** delivery solution (publisher `ARNGCheckbook`, prefix `book`)
containing the PCF controls:

- `book_ARNGCheckbook.ItemizedDetailsGrid` — v0.2.0: Itemized Details are now
  **user-selected** — an Add Items dialog lists the parent Requirement's
  Details, plus per-row Remove. Auto-populate from Requirement Details is
  retired (see the migration note in
  [`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md))
- `book_ARNGCheckbook.PrioritizationFundingGrid`
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
