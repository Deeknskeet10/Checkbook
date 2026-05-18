# SuppliesGrid PCF

Dataset PCF that replaces the default `book_supplies` subgrid on the `book_prioritization` form. Renders an editable grid with:

- Masked NSN entry (`XXXX-XX-XXX-XXXX`)
- Per-row OK/Incomplete badge
- Header pill `X / Y priced` against the parent Requirement's required SupplyItems (`arsc_isrequired = true`)
- "Missing supply rows for: ..." callout when incomplete

## Build & push

Prereqs: Node 18+, .NET 6+ SDK, `pac` CLI logged into the target environment.

```bash
cd pcf/SuppliesGrid
npm install
npm run build

# init a pcfproj on first push (one-time):
pac pcf init --namespace ARNGCheckbook --name SuppliesGrid --template dataset --run-npm-install false --overwrite-existing false
# then push:
pac pcf push --publisher-prefix arsc
```

## Bind it on the form

On `book_prioritization` main form, edit the existing **Supplies** subgrid → Components → Add component → "ARNGCheckbook.SuppliesGrid" → set:

- Dataset: the same subgrid view (default view filtered by Prioritization)
- `requirementIdField`: `book_requirement` (leave blank to default)

## Why this is only half the gate

The PCF runs client-side. The plugin in `/plugin` is the real enforcement — register both.
