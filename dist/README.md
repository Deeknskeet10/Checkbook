# dist/

Pre-built, importable artifacts — committed so they can be pulled and imported
without a local build.

## `ARNGCheckbookExtensions.zip`

The **unmanaged** delivery solution (publisher `ARNGCheckbook`, prefix `book`)
containing the PCF controls:

- `book_ARNGCheckbook.ItemizedDetailsGrid`
- `book_ARNGCheckbook.ValidateAndFundGrid`

Import it into the Dataverse environment, then bind each control to its subgrid
in the form designer. The plugins are delivered separately via the Plugin
Registration Tool — build `Checkbook_Plugins.dll` from `Plugins/` and register
it with the Plugin Registration Tool.

Rebuilt from `solution/ARNGCheckbookExtensions/` with `dotnet build -c Release`;
refresh this file whenever the controls change.
