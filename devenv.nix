{ pkgs, lib, config, ... }:

{
  # ============================================================
  # Power Platform Development Environment
  # ============================================================
  # Includes:
  #   - .NET SDK (for pac CLI and C# plugin development)
  #   - Node.js (for PCF controls)
  #   - pac CLI (installed as a local dotnet tool)
  #   - XML/JSON tooling (for working with unpacked solutions)
  #   - Helper scripts for the export → unpack → pack workflow

  packages = with pkgs; [
    # Core tooling
    git
    jq            # JSON processing (solution metadata, connector configs)
    libxml2       # xmllint — validate/format XML files in solutions
    zip
    unzip
    curl          # For API calls

    # Useful for reviewing/diffing solution XML
    delta         # Better git diffs for XML-heavy repos
    bat           # Syntax-highlighted file viewing

    # Plugin development
    mono          # Provides 'sn' tool for generating strong name key files
    powershell    # For plugin registration scripts

    # Azure / Dataverse authentication
    azure-cli     # az login for Dataverse API authentication
  ];

  # ── .NET ────────────────────────────────────────────────────
  languages.dotnet = {
    enable = true;
    package = pkgs.dotnet-sdk_10;  # pac CLI 2.x requires .NET 10
  };

  # ── Node.js (PCF Controls) ──────────────────────────────────
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
  };

  # ── Environment Variables ───────────────────────────────────
  env = {
    # Ensure dotnet tools are on PATH
    DOTNET_CLI_TELEMETRY_OPTOUT = "1";
    DOTNET_NOLOGO = "1";

    # pac will store auth tokens here (relative to project = isolated)
    PAC_CONFIG_PATH = "${config.devenv.root}/.pac";

    # Point to your solutions and source dirs
    SOLUTIONS_DIR = "${config.devenv.root}/solutions";
    SRC_DIR = "${config.devenv.root}/src";
  };

  # ── Shell Init ──────────────────────────────────────────────
  enterShell = ''
    # ── pac CLI ────────────────────────────────────────────────
    # pac is not in nixpkgs; install as a local dotnet tool.
    # The manifest lives at .config/dotnet-tools.json so it's
    # project-scoped (no global pollution).
    if [ ! -f .config/dotnet-tools.json ]; then
      echo "📦 Initializing dotnet tool manifest..."
      dotnet new tool-manifest --force
    fi

    if ! dotnet tool list 2>/dev/null | grep -q "microsoft.powerapps.cli.tool"; then
      echo "📦 Installing pac CLI (Power Platform CLI)..."
      dotnet tool install microsoft.powerapps.cli.tool
    fi

    # Restore all local tools (idempotent)
    dotnet tool restore --verbosity quiet

    # Add local tools to PATH for this shell
    export PATH="$DOTNET_ROOT/tools:$HOME/.dotnet/tools:$PATH"

    # ── Ensure directories exist ────────────────────────────────
    mkdir -p solutions src .pac

    # ── Greeting ────────────────────────────────────────────────
    echo ""
    echo "⚡ Power Platform Dev Environment"
    echo "──────────────────────────────────"
    echo "  pac    → $(dotnet tool run pac -- --version 2>/dev/null | head -1 || echo 'not yet installed')"
    echo "  dotnet → $(dotnet --version)"
    echo "  node   → $(node --version)"
    echo ""
    echo "  pac auth create                authenticate to an environment"
    echo "  pp-export <SolutionName>       export + unpack a solution"
    echo "  pp-unpack <ZipFile>            unpack an existing solution zip"
    echo "  pp-pack <SolutionName>         pack + ready for import"
    echo "  pp-genkey <Name.snk>           generate strong name key for plugins"
    echo "  pp-plugin-register <EnvUrl>    register plugins (first-time)"
    echo "  pp-plugin-push <AssemblyId>    update existing plugin assembly"
    echo ""
  '';

  # ── Scripts (available as commands in the shell) ─────────────
  scripts = {

    # Export and immediately unpack a solution from the connected environment
    pp-export.exec = ''
      set -euo pipefail
      SOLUTION=''${1:?Usage: pp-export <SolutionName> [managed|unmanaged]}
      TYPE=''${2:-unmanaged}
      ZIPFILE="solutions/$SOLUTION.zip"

      echo "🔽 Exporting $SOLUTION ($TYPE)..."
      dotnet tool run pac -- solution export \
        --name "$SOLUTION" \
        --path "$ZIPFILE" \
        --managed $([ "$TYPE" = "managed" ] && echo "true" || echo "false") \
        --overwrite

      echo "📂 Unpacking into src/$SOLUTION..."
      mkdir -p "src/$SOLUTION"
      dotnet tool run pac -- solution unpack \
        --zipfile "$ZIPFILE" \
        --folder "src/$SOLUTION" \
        --allowDelete true \
        --clobber

      echo "✅ Done → src/$SOLUTION"
    '';

    # Unpack an existing solution zip file (without exporting)
    pp-unpack.exec = ''
      set -euo pipefail
      ZIPFILE=''${1:?Usage: pp-unpack <SolutionZipFile> [OutputFolder]}

      # Derive solution name from zip filename if output folder not provided
      BASENAME=$(basename "$ZIPFILE" .zip)
      OUTFOLDER=''${2:-src/$BASENAME}

      echo "📂 Unpacking $ZIPFILE → $OUTFOLDER..."
      mkdir -p "$OUTFOLDER"
      dotnet tool run pac -- solution unpack \
        --zipfile "$ZIPFILE" \
        --folder "$OUTFOLDER" \
        --allowDelete true \
        --clobber

      echo "✅ Done → $OUTFOLDER"
    '';

    # Pack unpacked source back into a zip for import
    pp-pack.exec = ''
      set -euo pipefail
      SOLUTION=''${1:?Usage: pp-pack <SolutionName> [managed|unmanaged]}
      TYPE=''${2:-unmanaged}
      ZIPFILE="solutions/''${SOLUTION}_packed.zip"

      echo "📦 Packing src/$SOLUTION → $ZIPFILE..."
      dotnet tool run pac -- solution pack \
        --zipfile "$ZIPFILE" \
        --folder "src/$SOLUTION" \
        --managed $([ "$TYPE" = "managed" ] && echo "true" || echo "false")

      echo "✅ Packed → $ZIPFILE"
    '';

    # Import a packed solution into the connected environment
    pp-import.exec = ''
      set -euo pipefail
      SOLUTION=''${1:?Usage: pp-import <SolutionName>}
      ZIPFILE="solutions/''${SOLUTION}_packed.zip"

      echo "🚀 Importing $ZIPFILE..."
      dotnet tool run pac -- solution import \
        --path "$ZIPFILE" \
        --activate-plugins true \
        --force-overwrite true

      echo "✅ Import complete"
    '';

    # List all solutions in the connected environment
    pp-list.exec = ''
      dotnet tool run pac -- solution list
    '';

    # Show the current auth profiles
    pp-auth.exec = ''
      dotnet tool run pac -- auth list
    '';

    # Generate a strong name key file for plugin signing
    pp-genkey.exec = ''
      set -euo pipefail
      KEYFILE=''${1:?Usage: pp-genkey <KeyFileName.snk>}
      echo "🔑 Generating strong name key: $KEYFILE"
      sn -k "$KEYFILE"
      echo "✅ Key file created: $KEYFILE"
      echo ""
      echo "Add this to your .csproj:"
      echo "  <PropertyGroup>"
      echo "    <SignAssembly>true</SignAssembly>"
      echo "    <AssemblyOriginatorKeyFile>$KEYFILE</AssemblyOriginatorKeyFile>"
      echo "  </PropertyGroup>"
    '';

    # Pretty-print an XML file from the solution source tree
    pp-view.exec = ''
      FILE=''${1:?Usage: pp-view <path/to/file.xml>}
      xmllint --format "$FILE" | bat --language xml
    '';

    # Diff the current solution source against git HEAD — useful before packing
    pp-diff.exec = ''
      SOLUTION=''${1:?Usage: pp-diff <SolutionName>}
      git diff HEAD -- "src/$SOLUTION" | delta
    '';

    # Register plugins to a Dataverse environment
    pp-plugin-register.exec = ''
      set -euo pipefail
      ENV_URL=''${1:?Usage: pp-plugin-register <EnvironmentUrl> [SolutionName]}
      SOLUTION=''${2:-ARNGCheckbook}
      PLUGIN_DIR="plugins/ARNGCheckbook.Plugins"

      if [ ! -f "$PLUGIN_DIR/Register-Plugins.ps1" ]; then
        echo "❌ Register-Plugins.ps1 not found in $PLUGIN_DIR"
        exit 1
      fi

      if [ ! -f "$PLUGIN_DIR/bin/Debug/net462/ARNGCheckbook.Plugins.dll" ]; then
        echo "📦 Building plugin assembly..."
        dotnet build "$PLUGIN_DIR"
      fi

      echo "🔌 Registering plugins to $ENV_URL..."
      cd "$PLUGIN_DIR"
      pwsh -File Register-Plugins.ps1 -EnvironmentUrl "$ENV_URL" -SolutionName "$SOLUTION"
    '';

    # Update/push existing plugin assembly (requires pluginId)
    pp-plugin-push.exec = ''
      set -euo pipefail
      PLUGIN_ID=''${1:?Usage: pp-plugin-push <PluginAssemblyId>}
      PLUGIN_DIR="plugins/ARNGCheckbook.Plugins"

      echo "📦 Building plugin assembly..."
      dotnet build "$PLUGIN_DIR"

      echo "🚀 Pushing plugin update..."
      dotnet tool run pac -- plugin push \
        --pluginId "$PLUGIN_ID" \
        --pluginFile "$PLUGIN_DIR/bin/Debug/net462/ARNGCheckbook.Plugins.dll"
    '';
  };

  # ── Git config ───────────────────────────────────────────────
  # These ensure XML diffs are readable in git
  git-hooks.hooks = {
    # Keep solution XML consistently formatted before committing
    xmllint-format = {
      enable = false;  # opt-in: change to true to auto-format XML on commit
      entry = "${pkgs.libxml2}/bin/xmllint --format --output {file} {file}";
      types = [ "xml" ];
    };
  };
}
