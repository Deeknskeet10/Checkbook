# ARNG Checkbook — Power Platform Development Context

This file gives you the context needed to work with the ARNG Checkbook Power
Platform solution(s) in this repo. It covers the repo layout, tooling, and
review conventions. For deep domain knowledge of the Checkbook solution itself
(entities, workflows, approval flows), see `src/ARNGCheckbook/CLAUDE.md`.

---

## What this repo contains

The **ARNG Checkbook** is the Army National Guard resource management and budget
execution tracking system — a Dataverse/Power Platform application for tracking
requirements, funding allocations, prioritizations, spend plans, and budget
execution across state National Guard units.

The repo holds the **unpacked sources** of the exported Power Platform solutions,
the **C# plugin project**, and the tooling to export/unpack/pack/import.

### Two solutions today — one solution is the goal

| Solution | Unpacked to | Publisher | Prefix | Version |
|----------|-------------|-----------|--------|---------|
| **ARNGCheckbook** | `src/ARNGCheckbook/` | `ARNGCheckbook` | `book` | 1.11.0.40 |
| **ARNGCheckbookSupplyCodes** | `src/ARNGCheckbookSupplyCodes/` | `ArmySupplyCodes` | `arsc` | 2.8.0.2 |

`ARNGCheckbookSupplyCodes` is a separate solution containing the 11 PCF code
components (and 3 dashboards) used by the Checkbook app.

> **Project goal:** consolidate into a **single solution**. The PCF components
> currently belong to the separate `ArmySupplyCodes` publisher (prefix `arsc`)
> and must be brought under the `ARNGCheckbook` publisher (prefix `book`) so
> that one `.zip` ships the whole application. See **"Merging the PCF solution"**
> below before doing this work.

---

## Directory Layout

```
Power Platform/
├── CLAUDE.md                       # This file — repo/tooling context
├── solutions/                      # Raw exported .zip files
│   ├── ARNGCheckbook_1_11_0_40.zip
│   └── ARNGCheckbookSupplyCodes_2_8_0_2.zip
├── src/                            # Unpacked solution sources — this is what you edit
│   ├── ARNGCheckbook/               # Main solution (publisher: book)
│   │   ├── CLAUDE.md                # Domain context for the Checkbook solution
│   │   ├── Other/Solution.xml       # Solution metadata (publisher, version)
│   │   ├── Other/Customizations.xml # Root component manifest
│   │   ├── Entities/                # 47 Dataverse tables (book_*)
│   │   │   └── book_requirements/
│   │   │       ├── Entity.xml
│   │   │       ├── Attributes/
│   │   │       ├── FormXml/
│   │   │       └── SavedQueries/
│   │   ├── AppModules/              # Model-driven apps
│   │   ├── AppModuleSiteMaps/
│   │   ├── CanvasApps/              # Custom pages (.msapp — binary)
│   │   ├── Workflows/               # 168 Power Automate flows + classic XAML workflows
│   │   ├── WebResources/            # JS / HTML / images (book_*)
│   │   ├── PluginAssemblies/        # Plugin registration metadata
│   │   ├── SdkMessageProcessingSteps/  # Plugin step registrations
│   │   ├── Roles/                   # 14 security roles
│   │   ├── OptionSets/
│   │   ├── appactions/
│   │   └── environmentvariabledefinitions/
│   └── ARNGCheckbookSupplyCodes/     # PCF solution (publisher: arsc)
│       ├── Other/Solution.xml
│       ├── Controls/                # 11 PCF code components (namespace ARNGCheckbook)
│       │   └── arsc_ARNGCheckbook.<Name>/
│       │       ├── ControlManifest.xml
│       │       ├── bundle.js
│       │       └── css/
│       └── Dashboards/
├── Plugins/                          # C# plugin project (.NET Framework 4.6.2)
├── pcf/                              # Buildable PCF projects (npm + pac pcf)
│   └── ItemizedDetailsGrid/          # Editable grid for a Prioritization's Itemized Details
├── pcf-reference/                    # PCF control source (.tsx) — REFERENCE ONLY
│   └── <ControlName>/                # *App.tsx, index.ts, ControlManifest.Input.xml, css/
├── solution/                         # pac solution projects → build importable .zip
│   └── ARNGCheckbookExtensions/      # Delivery solution (publisher: book) — bundles new PCF
├── .config/dotnet-tools.json         # pac CLI pinned as a local dotnet tool
└── devenv.nix                        # Dev environment + pp-* helper scripts
```

`pcf/` holds **buildable** PCF projects (each with `package.json` + `.pcfproj`),
distinct from the reference-only `pcf-reference/`. `solution/` holds `pac`
solution projects that package those controls into importable `.zip`s.

---

## Tooling — pac CLI

`pac` (Power Platform CLI) is **not on `PATH`**. It is pinned as a local dotnet
tool in `.config/dotnet-tools.json` (v2.4.1). Run it one of two ways:

```bash
dotnet tool restore                 # one-time, after a fresh clone
dotnet tool run pac -- <args>       # invoke pac
```

The `devenv.nix` shell installs it automatically and exposes helper scripts:

| Script | Does |
|--------|------|
| `pp-export <SolutionName>`  | export from the connected env + unpack into `src/` |
| `pp-unpack <ZipFile> [Out]` | unpack an existing solution zip |
| `pp-pack <SolutionName>`    | pack `src/<Solution>` into `solutions/<Solution>_packed.zip` |
| `pp-import <SolutionName>`  | import a packed zip into the connected env |
| `pp-diff <SolutionName>`    | diff unpacked source against git HEAD |

pac auth tokens are isolated to the project (`PAC_CONFIG_PATH=./.pac`).

### Common commands

```bash
# Unpack a freshly exported zip (overwriting existing source)
dotnet tool run pac -- solution unpack \
  --zipfile solutions/ARNGCheckbook_1_11_0_40.zip \
  --folder src/ARNGCheckbook --allowDelete true

# Pack source back into an importable zip
dotnet tool run pac -- solution pack \
  --zipfile solutions/ARNGCheckbook_packed.zip \
  --folder src/ARNGCheckbook

# Check a solution version without unpacking
unzip -p solutions/ARNGCheckbook_1_11_0_40.zip solution.xml | grep -oP '<Version>[^<]+'
```

---

## C# Plugin Development

Plugins live in `Plugins/` — the `Checkbook_Plugins` project (assembly
`Checkbook_Plugins.dll`, namespace root `Checkbook.Plugins`), targeting
**.NET Framework 4.6.2**, strong-named with `Checkbook_Plugins.snk`, and
referencing `Microsoft.CrmSdk.CoreAssemblies`. It is **already implemented** —
17 registered plugins, all inheriting `Base/PluginBase.cs`:

```
Plugins/
├── Checkbook Plugins.sln · Checkbook_Plugins.csproj
├── Base/PluginBase.cs               # Shared IPlugin base (Execute boilerplate + helpers)
├── Validation/                      # Pre-operation validators
│   ├── PrioritizationFundingValidator.cs
│   ├── RealignmentValidator.cs
│   ├── RequirementFundingTDPValidator.cs
│   └── ValidationMessages.cs
├── TurnIns/                         # Turn-In approve/deny workflow
│   ├── TurnInValidator.cs · TurnInApprovalPlugin.cs · TurnInDeactivator.cs
│   └── Helpers/                     # ledger/distribution creators, LOA resolver, RF/Prio updaters
├── Realignments/                    # RealignmentValidator, RealignmentProcessor,
│                                    #   SetSameFundSagFlagPlugin, LedgerCreator
├── Recalculations/                  # TDP roll-up recalculators (Decision, FundingLine,
│                                    #   FundingTrack, Ledger-create, Prioritization, RF)
├── Items/                           # ItemizedDetailsSynchronizer, PrioritizationItemizedRollup
├── Helpers/                         # NumericHelper, TDPCalculationHelper
└── Constants/                       # 20 per-entity attribute/name constant files
```

```bash
cd Plugins && dotnet build
# Output → bin/Debug/net462/Checkbook_Plugins.dll
```

A solution build **cannot** package plugin steps (their registration metadata
only exists in a Dataverse environment) — plugins are always delivered by
registering `Checkbook_Plugins.dll` with the Plugin Registration Tool, not via
a solution `.zip`. The solution's own copy of the registration lives under
`src/ARNGCheckbook/PluginAssemblies/` and `SdkMessageProcessingSteps/`.

> **Note:** this project has **no step-registration manifest** yet — the old
> `ARNGCheckbook.Plugins` project's `PluginRegistration.json` /
> `Register-Plugins.ps1` / `PLUGIN-REGISTRATION.md` were removed with it. Step
> registrations must currently be done by hand in the Plugin Registration Tool.

---

## Merging the PCF solution into ARNGCheckbook

The end state is a **single solution `.zip`**. Key facts gathered so far:

- The 11 PCF controls all use the namespace `ARNGCheckbook` (e.g.
  `ARNGCheckbook.LedgerBalance`) but are owned by the **`ArmySupplyCodes`**
  publisher, so their solution-component unique names carry the `arsc_` prefix
  (`arsc_ARNGCheckbook.LedgerBalance`).
- The main `ARNGCheckbook` solution already **references** two of them from
  `Entities/book_Requirements/FormXml/main/` — `arsc_ARNGCheckbook.SpendPlanGrid`
  and `arsc_ARNGCheckbook.PrioritizationsForRequirement` — and lists them as
  dependencies in `Other/Solution.xml`.

Implications to work through before/while merging:

1. A component's publisher prefix is fixed at creation in Dataverse — controls
   cannot simply be "renamed" `arsc_` → `book_`. Confirm whether the controls
   must be re-registered/recreated under the `book` publisher, or whether the
   `ArmySupplyCodes` publisher should instead be retired and its components
   re-owned.
2. Every form/view/dashboard reference to an `arsc_` control must be updated to
   the new unique name in lockstep, or the packed solution will fail to import.
3. The 3 dashboards in the SupplyCodes solution also need a home in the merged
   solution.

Treat this as an in-progress task — do not pack a "merged" solution until the
publisher question above is resolved.

### `pcf-reference/` — source for the rebuilds

`pcf-reference/` holds the **TypeScript/React source** (`*App.tsx`, `index.ts`,
`ControlManifest.Input.xml`, `css/`) for the PCF controls, extracted from a
project archive. It is **reference material only** — not a buildable PCF project
(no `package.json`/`pcfproj`) and not wired into any solution.

The plan is to **rebuild the controls one by one** from this source, as proper
PCF projects under the `book` publisher, then bring them into the single merged
solution. `pcf-reference/` has 13 controls — the 11 currently deployed in
`ARNGCheckbookSupplyCodes` plus `FundingTrackTimeline` and `SuppliesGrid`, which
are not yet deployed.

Rebuilt so far: **`ItemizedDetailsGrid`** (`pcf/ItemizedDetailsGrid/`) — a new
control, not one of the 13; an editable grid for a Prioritization's Itemized
Details.

---

## Building & delivering changes

`pcf/` projects build with npm + `pac`; `solution/ARNGCheckbookExtensions`
packages them into an importable `.zip`.

```bash
# Build a PCF control standalone
cd pcf/ItemizedDetailsGrid
npm install                  # required after a fresh clone — node_modules is git-ignored
npm run build

# Build the importable delivery solution
cd solution/ARNGCheckbookExtensions
dotnet build -c Release
# → bin/Release/ARNGCheckbookExtensions.zip   (unmanaged, publisher: book)
```

`ARNGCheckbookExtensions` is an **unmanaged delivery solution** under the
`ARNGCheckbook` publisher (prefix `book`). It is the vehicle for shipping new
work into the Checkbook environment **without** re-importing the full
`ARNGCheckbook` solution — which would overwrite security roles and other edits
made directly in the environment. Add each new PCF control with
`pac solution add-reference`.

How each kind of change reaches an environment:

| Change type | Delivery |
|-------------|----------|
| PCF control | Rebuild the delivery `.zip`, import it |
| Plugin (assembly + steps) | Register the DLL with the Plugin Registration Tool |
| Form / entity metadata | Author in the maker portal — cannot be built from the repo |

Treat the **Dataverse environment as authoritative**: pull changes in via the
delivery solution / PRT, then export the enriched solution back to the repo.
Never repack and re-import the full `src/ARNGCheckbook` source.

---

## File Types — How to Read Them

### `Other/Solution.xml`
Top-level metadata: `UniqueName`, `Version`, and the `<Publisher>` block
(`UniqueName`, `CustomizationPrefix`). Check `Version` when comparing
environments.

### `Entities/<table>/Entity.xml` + `Attributes/`
`Entity.xml` defines the Dataverse table. Note: with `pac` unpack, attribute
definitions are embedded in `Entity.xml` rather than split one-file-per-column.
Forms live under `FormXml/`, views under `SavedQueries/`.

### `Workflows/*.json`
Power Automate flow definitions (Logic Apps schema). Each flow has a paired
`*.data.xml`. Explore with `jq`:
```bash
jq '.properties.definition.triggers' src/ARNGCheckbook/Workflows/<flow>.json
jq '.properties.definition.actions | keys' src/ARNGCheckbook/Workflows/<flow>.json
```

### `Workflows/*.xaml`
Classic CRM workflows (form field logic, naming, status transitions).

### `WebResources/*`
Each web resource is a content file plus a `*.data.xml` descriptor. JS files
hold form scripts, ribbon commands, and business logic.

### `Controls/<control>/ControlManifest.xml`
PCF code component manifest — declares namespace, constructor, properties, and
the `bundle.js` resource.

### `Roles/*.xml`
Security role privilege definitions. Privilege depth bitmask: 0=none, 1=user,
2=BU, 3=parent BU, 4=org.

---

## Review Guidelines

1. **Flows (JSON)** — flag hardcoded environment-specific GUIDs, connection
   references, and sensitive data in HTTP actions. Flag flows calling external
   endpoints.
2. **Web Resources (JS)** — flag hardcoded org URLs, deprecated `Xrm.Page` usage
   (prefer `formContext`), and missing null checks on field values.
3. **Entity XML** — flag columns without descriptions, missing required levels,
   and relationships without intentional cascade-delete behavior.
4. **Security Roles** — org-scoped (depth `4`) privileges on sensitive tables
   must be justified.
5. **Plugins** — flag synchronous plugins on high-volume tables, missing
   try/catch around service calls, and `RetrieveMultiple` without a column set.
6. **PCF Controls** — flag hardcoded GUIDs/URLs in `bundle.js`; confirm the
   `ControlManifest.xml` property bindings match the form usage.

---

## Working Conventions

- Edit files under `src/` — never edit the `.zip`s in `solutions/`.
- After changing source, `pp-pack` to produce an importable zip; don't commit
  generated `_packed.zip` artifacts unless asked.
- The `book` prefix is the canonical publisher prefix for this application.
- When in doubt about Checkbook domain concepts, read `src/ARNGCheckbook/CLAUDE.md`.
