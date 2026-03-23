# Power Platform Development — LLM Context

This file gives you the context needed to work with unpacked Power Platform solutions in this repo.

---

## What is a Power Platform Solution?

A **Solution** is a container for Power Platform customizations — it holds entities, flows, apps, plugins, and web resources in a portable, versionable format.

When **exported** from a Power Platform environment (`.zip`), it's a binary blob. When **unpacked** with `pac solution unpack`, it becomes a readable directory tree of XML, JSON, and C# files that can be source-controlled and reviewed.

---

## Directory Layout

```
power-platform-project/
├── solutions/           # Raw exported .zip files (gitignored if large)
│   └── MySolution.zip
├── src/                 # Unpacked solution sources — this is what you edit
│   └── MySolution/
│       ├── solution.xml              # Solution metadata (publisher, version)
│       ├── customizations.xml        # Entity/table definitions, forms, views
│       ├── Other/
│       │   └── Solution.xml          # Additional solution descriptor
│       ├── Entities/                 # Dataverse table definitions
│       │   └── account/
│       │       ├── Entity.xml        # Table metadata
│       │       ├── Attributes/       # Column definitions (one XML per column)
│       │       ├── Forms/            # Form layouts (XML)
│       │       ├── Views/            # View definitions (XML/FetchXML)
│       │       └── Relationships/    # Table relationships
│       ├── CanvasApps/               # Power Apps canvas apps
│       │   └── MyApp_*.msapp         # Binary — use pac canvas unpack to inspect
│       ├── Workflows/                # Power Automate flows
│       │   └── MyFlow-<guid>.json    # Flow definition
│       ├── WebResources/             # JS, HTML, CSS, images
│       │   └── *.js / *.html
│       ├── PluginAssemblies/         # C# plugin registration metadata
│       ├── SdkMessageProcessingSteps/  # Plugin step registrations
│       └── Roles/                    # Security role definitions
│           └── <RoleName>.xml
├── plugins/             # C# plugin source (separate .csproj)
│   └── MyPlugin/
│       ├── MyPlugin.csproj
│       └── *.cs
├── scripts/             # Helper automation
├── devenv.nix
└── .claude/
    └── CLAUDE.md        # This file
```

---

## Key File Types and How to Read Them

### `solution.xml`
Top-level metadata. Check `Version` when comparing environments.
```xml
<ImportExportXml version="9.2.24.10334" ...>
  <SolutionManifest>
    <UniqueName>MySolution</UniqueName>
    <Version>1.0.0.5</Version>
    <Publisher>...</Publisher>
  </SolutionManifest>
</ImportExportXml>
```

### `Entities/<TableName>/Entity.xml`
Defines the Dataverse table. Key attributes: `Name`, `EntitySetName`, ownership type.

### `Entities/<TableName>/Attributes/*.xml`
Each file = one column. Look at `Type`, `RequiredLevel`, `DisplayName`.

### `Workflows/*.json`
Power Automate flow definitions. These are JSON but use the Logic Apps schema. Triggers and actions are nested. Use `jq` to explore:
```bash
jq '.properties.definition.triggers' src/MySolution/Workflows/MyFlow-*.json
jq '.properties.definition.actions | keys' src/MySolution/Workflows/MyFlow-*.json
```

### `WebResources/*.js`
Plain JavaScript. Often contains business logic, form scripts, or ribbon commands.

### `Roles/*.xml`
Security role privilege definitions. Privileges are encoded with a bitmask depth (0=none, 1=user, 2=BU, 3=parent BU, 4=org).

---

## Common Tasks

### Review a flow definition
```bash
jq '.' src/MySolution/Workflows/MyFlow-*.json | bat --language json
```

### Find all custom columns on a table
```bash
ls src/MySolution/Entities/myprefix_mytable/Attributes/
```

### See what changed since last commit
```bash
pp-diff MySolution
```

### Check solution version
```bash
xmllint --xpath "//Version/text()" src/MySolution/solution.xml
```

---

## C# Plugin Development

Plugins live in `plugins/<ProjectName>/`. They target `Microsoft.CrmSdk.CoreAssemblies`.

Key patterns:
- Plugins implement `IPlugin` with a single `Execute(IServiceProvider)` method
- Context is retrieved via `IPluginExecutionContext`
- Services: `IOrganizationService`, `ITracingService`
- Pre/post images contain snapshot data for update steps

```csharp
public class MyPlugin : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var context = (IPluginExecutionContext)
            serviceProvider.GetService(typeof(IPluginExecutionContext));
        var serviceFactory = (IOrganizationServiceFactory)
            serviceProvider.GetService(typeof(IOrganizationServiceFactory));
        var service = serviceFactory.CreateOrganizationService(context.UserId);
        var tracingService = (ITracingService)
            serviceProvider.GetService(typeof(ITracingService));

        // context.PrimaryEntityName  → which table triggered this
        // context.MessageName        → Create / Update / Delete / etc.
        // context.InputParameters["Target"] → the Entity being operated on
    }
}
```

### Building plugins
```bash
cd plugins/MyPlugin
dotnet build
# Output .dll goes to bin/Debug/net462/ — register with pac or the Plugin Registration Tool
```

---

## LLM Review Guidelines

When reviewing this codebase:

1. **Flows (JSON)**: Check for hardcoded environment-specific GUIDs, connection references, and sensitive data in HTTP actions. Flag any flows that call external endpoints.

2. **Web Resources (JS)**: Look for hardcoded org URLs, deprecated Xrm.Page API usage (prefer `formContext`), and missing null checks on field values.

3. **Entity XML**: Flag columns without descriptions, missing required levels, and relationships without cascade delete behaviors set intentionally.

4. **Security Roles**: Privilege bitmask depths of `4` (org-scoped) should be justified — flag any role granting org-level write on sensitive tables.

5. **Plugins**: Check for synchronous plugins on high-volume tables, missing try/catch around service calls, and use of `RetrieveMultiple` without column sets (causes full record fetches).

---

## Useful pac Commands

```bash
# Authentication
pac auth create --url https://yourorg.crm.dynamics.com
pac auth list
pac auth select --index 1

# Solutions
pac solution list
pac solution export --name MySolution --path solutions/MySolution.zip
pac solution unpack --zipfile solutions/MySolution.zip --folder src/MySolution
pac solution pack --zipfile solutions/MySolution_packed.zip --folder src/MySolution
pac solution import --path solutions/MySolution_packed.zip

# Canvas Apps (further unpack .msapp files)
pac canvas unpack --msapp src/MySolution/CanvasApps/MyApp.msapp --sources src/canvas/MyApp

# Dataverse tables (schema only)
pac modelbuilder build --outdirectory src/generated --namespace MyProject
```
