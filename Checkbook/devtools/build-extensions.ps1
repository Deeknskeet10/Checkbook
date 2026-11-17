<#
.SYNOPSIS
  Builds the ARNGCheckbookExtensions delivery solution and copies the zip into solutions/.

.DESCRIPTION
  1. npm install in each referenced PCF project that is missing node_modules
  2. dotnet build -c Release on solution/ARNGCheckbookExtensions
  3. Copy bin/Release/ARNGCheckbookExtensions.zip -> solutions/ (bin/ is git-ignored)

  Usage (from anywhere):  pwsh devtools/build-extensions.ps1   (or powershell -File ...)
#>
param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$root       = Resolve-Path (Join-Path $PSScriptRoot "..")
$projDir    = Join-Path $root "solution/ARNGCheckbookExtensions"
$zipName    = "ARNGCheckbookExtensions.zip"
$builtZip   = Join-Path $projDir "bin/$Configuration/$zipName"
$destDir    = Join-Path $root "solutions"

# 1. Make sure every referenced PCF project has its npm dependencies.
Select-String -Path (Join-Path $projDir "ARNGCheckbookExtensions.cdsproj") -Pattern 'pcf/([^/]+)/[^"]+\.pcfproj' |
  ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique | ForEach-Object {
    $pcfDir = Join-Path $root "pcf/$_"
    if (-not (Test-Path (Join-Path $pcfDir "node_modules"))) {
      Write-Host "npm install: $_"
      Push-Location $pcfDir
      try { npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm install failed in $_" } }
      finally { Pop-Location }
    }
  }

# 1b. Bump the solution version's last segment (1.9.0.1 -> 1.9.0.2) so Dataverse
#     sees the import as an upgrade. Preserves the file's BOM/encoding.
$solXml = Join-Path $projDir "src/Other/Solution.xml"
$bytes  = [IO.File]::ReadAllBytes($solXml)
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
$text   = [IO.File]::ReadAllText($solXml)
$m = [regex]::Match($text, '<Version>(\d+)\.(\d+)\.(\d+)\.(\d+)</Version>')
if (-not $m.Success) { throw "No <Version> found in $solXml" }
$oldVer = "$($m.Groups[1]).$($m.Groups[2]).$($m.Groups[3]).$($m.Groups[4])"
$newVer = "$($m.Groups[1]).$($m.Groups[2]).$($m.Groups[3]).$([int]$m.Groups[4].Value + 1)"
$text = $text.Remove($m.Index, $m.Length).Insert($m.Index, "<Version>$newVer</Version>")
[IO.File]::WriteAllText($solXml, $text, (New-Object Text.UTF8Encoding($hasBom)))
Write-Host "Solution version: $oldVer -> $newVer"

# 2. Build the delivery solution.
Write-Host "dotnet build -c $Configuration"
Push-Location $projDir
try { dotnet build -c $Configuration; if ($LASTEXITCODE -ne 0) { throw "dotnet build failed" } }
finally { Pop-Location }

# 3. Copy the zip into solutions/ since bin/ is git-ignored.
if (-not (Test-Path $builtZip)) { throw "Build succeeded but $builtZip was not found" }
Copy-Item $builtZip (Join-Path $destDir $zipName) -Force
Write-Host "Copied -> solutions/$zipName"
