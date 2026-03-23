# Power Platform Dev Environment

A reproducible, source-controlled development environment for Power Platform solutions — built on [devenv](https://devenv.sh).

## Prerequisites

- [Nix](https://nixos.org/download) with flakes enabled
- [devenv](https://devenv.sh/getting-started/) (`nix profile install nixpkgs#devenv`)
- `direnv` recommended for auto-activation

## Getting Started

```bash
# Clone and enter the project
cd power-platform-project

# Start the environment (first run installs pac CLI)
devenv shell

# Or if you use direnv:
echo "use devenv" > .envrc && direnv allow
```

## Workflow

### 1. Authenticate to your Power Platform environment

```bash
pac auth create --url https://yourorg.crm.dynamics.com
# Opens a browser for OAuth — tokens are stored in .pac/ (gitignored)
```

### 2. Export and unpack a solution

```bash
pp-export MySolution
# Downloads MySolution.zip → solutions/
# Unpacks it → src/MySolution/
```

### 3. Review / edit with LLM

The `.claude/CLAUDE.md` file gives Claude (or any LLM) full context about the
solution structure, file formats, and review guidelines.

```bash
# With Claude Code:
claude

# Or point any LLM at the src/ directory
```

### 4. Pack and import back

```bash
pp-pack MySolution
pp-import MySolution
```

## Available Commands

| Command | Description |
|---|---|
| `pp-export <Name>` | Export solution from environment + unpack to `src/` |
| `pp-pack <Name>` | Pack `src/<Name>` → `solutions/<Name>_packed.zip` |
| `pp-import <Name>` | Import packed zip back to environment |
| `pp-list` | List solutions in connected environment |
| `pp-auth` | Show auth profiles |
| `pp-view <file>` | Pretty-print XML with syntax highlighting |
| `pp-diff <Name>` | Git diff of `src/<Name>` with delta formatting |

## Plugin Development

C# plugins live in `plugins/`. They target `.NET Framework 4.6.2` (Dataverse requirement).

```bash
cd plugins/MyPlugin
dotnet build
# Register the output .dll via pac or the Plugin Registration Tool
```

See `plugins/MyPlugin/PluginBase.cs` for the recommended base class pattern.
