<#
.SYNOPSIS
  Small local GUI for bumping PCF control versions and running the
  ARNGCheckbookExtensions build.

.DESCRIPTION
  Lists every pcf/<Name>/<Name>/ControlManifest.Input.xml with its
  <control version="x.y.z">.
    [+]     bumps the right-most number (0.4.8 -> 0.4.9). Not saved yet.
    [Save]  writes that row's version to its manifest.
    Build   saves every unsaved row, then runs devtools/build-extensions.ps1
            (npm install where needed, solution version bump, dotnet build,
            copy the zip to solutions/) and streams its output below.

  "In solution" shows whether the control is referenced by
  solution/ARNGCheckbookExtensions — only those are packaged by Build.

  Start it with devtools/build-extensions-gui.cmd (double-click), or:
    powershell -NoProfile -ExecutionPolicy Bypass -STA -File devtools/build-extensions-gui.ps1
#>
param(
  # Test hook: render the window to a PNG and exit (no interaction).
  [string]$SnapshotPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$root        = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pcfRoot     = Join-Path $root "pcf"
$cdsproj     = Join-Path $root "solution/ARNGCheckbookExtensions/ARNGCheckbookExtensions.cdsproj"
$solutionXml = Join-Path $root "solution/ARNGCheckbookExtensions/src/Other/Solution.xml"
$buildScript = Join-Path $PSScriptRoot "build-extensions.ps1"

# Only the version attribute of the <control> element — never the XML
# declaration or the <platform-library version="..."> entries.
$controlVersionRx = [regex]'(<control\b[^>]*?\sversion=")([^"]*)(")'
$versionFormatRx  = [regex]'^\d+(\.\d+)*$'

# ─── Manifest helpers ────────────────────────────────────────────────────

function Read-ManifestVersion([string]$path) {
  $m = $controlVersionRx.Match([IO.File]::ReadAllText($path))
  if ($m.Success) { $m.Groups[2].Value } else { $null }
}

function Write-ManifestVersion([string]$path, [string]$version) {
  # Preserve the file's BOM / encoding and every other byte of the file.
  $bytes  = [IO.File]::ReadAllBytes($path)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $text   = [IO.File]::ReadAllText($path)
  $m = $controlVersionRx.Match($text)
  if (-not $m.Success) { throw "No <control version=""..."" > in $path" }
  $g = $m.Groups[2]
  $text = $text.Remove($g.Index, $g.Length).Insert($g.Index, $version)
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($hasBom)))
}

function Step-Version([string]$version) {
  $parts = $version.Split('.')
  $parts[-1] = [string]([int]$parts[-1] + 1)
  $parts -join '.'
}

function Get-SolutionVersion {
  if (-not (Test-Path $solutionXml)) { return "?" }
  $m = [regex]::Match([IO.File]::ReadAllText($solutionXml), '<Version>([^<]+)</Version>')
  if ($m.Success) { $m.Groups[1].Value } else { "?" }
}

function Get-ReferencedControls {
  if (-not (Test-Path $cdsproj)) { return @() }
  [regex]::Matches([IO.File]::ReadAllText($cdsproj), 'pcf/([^/"]+)/[^"]+\.pcfproj') |
    ForEach-Object { $_.Groups[1].Value }
}

# ─── Form ────────────────────────────────────────────────────────────────

$brand     = [Drawing.Color]::FromArgb(0x20, 0x86, 0xFF)
$textMain  = [Drawing.Color]::FromArgb(0x24, 0x24, 0x24)
$textMuted = [Drawing.Color]::FromArgb(0x61, 0x61, 0x61)
$headBg    = [Drawing.Color]::FromArgb(0xF7, 0xF7, 0xF7)
$dirtyBg   = [Drawing.Color]::FromArgb(0xFF, 0xF9, 0xE6)
$okText    = [Drawing.Color]::FromArgb(0x15, 0x80, 0x3D)
$errText   = [Drawing.Color]::FromArgb(0xB9, 0x1C, 0x1C)
$uiFont    = New-Object Drawing.Font("Segoe UI", 9.5)
$uiBold    = New-Object Drawing.Font("Segoe UI", 9.5, [Drawing.FontStyle]::Bold)
$headFont  = New-Object Drawing.Font("Segoe UI", 8, [Drawing.FontStyle]::Bold)

$form = New-Object Windows.Forms.Form
$form.Text = "Checkbook — Build Extensions"
$form.Font = $uiFont
$form.BackColor = [Drawing.Color]::White
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object Drawing.Size(760, 760)
$form.MinimumSize = New-Object Drawing.Size(620, 520)

# Top bar: title + solution version + buttons
$top = New-Object Windows.Forms.Panel
$top.Dock = "Top"; $top.Height = 56; $top.Padding = New-Object Windows.Forms.Padding(14, 10, 14, 6)
# Give the bar its real width before anchoring buttons to its right edge.
$top.Width = $form.ClientSize.Width

$title = New-Object Windows.Forms.Label
$title.Text = "PCF control versions"; $title.Font = New-Object Drawing.Font("Segoe UI", 12, [Drawing.FontStyle]::Bold)
$title.ForeColor = $textMain; $title.AutoSize = $true; $title.Location = New-Object Drawing.Point(14, 8)

$solLabel = New-Object Windows.Forms.Label
$solLabel.ForeColor = $textMuted; $solLabel.AutoSize = $true; $solLabel.Location = New-Object Drawing.Point(16, 32)

function New-FlatButton([string]$text, [bool]$primary) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text; $b.FlatStyle = "Flat"; $b.Height = 32; $b.Width = 96; $b.Cursor = "Hand"
  $b.Anchor = "Top, Right"
  if ($primary) {
    $b.BackColor = $brand; $b.ForeColor = [Drawing.Color]::White; $b.Font = $uiBold
    $b.FlatAppearance.BorderSize = 0
  } else {
    $b.BackColor = [Drawing.Color]::White; $b.ForeColor = $textMain
    $b.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(0xD1, 0xD1, 0xD1)
  }
  $b
}
$btnBuild  = New-FlatButton "Build" $true
$btnReload = New-FlatButton "Reload" $false
$btnBuild.Location  = New-Object Drawing.Point(($form.ClientSize.Width - 14 - 96), 12)
$btnReload.Location = New-Object Drawing.Point(($form.ClientSize.Width - 14 - 96 - 8 - 96), 12)
$top.Controls.AddRange([Windows.Forms.Control[]]@($title, $solLabel, $btnReload, $btnBuild))

# Grid
$grid = New-Object Windows.Forms.DataGridView
$grid.Dock = "Fill"
$grid.BackgroundColor = [Drawing.Color]::White
$grid.BorderStyle = "None"
$grid.CellBorderStyle = "SingleHorizontal"
$grid.GridColor = [Drawing.Color]::FromArgb(0xF0, 0xF0, 0xF0)
$grid.RowHeadersVisible = $false
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.AllowUserToResizeRows = $false
$grid.SelectionMode = "CellSelect"
$grid.MultiSelect = $false
$grid.AutoSizeColumnsMode = "None"
$grid.RowTemplate.Height = 34
$grid.EnableHeadersVisualStyles = $false
$grid.ColumnHeadersHeight = 34
$grid.ColumnHeadersHeightSizeMode = "DisableResizing"
$grid.ColumnHeadersBorderStyle = "None"
$grid.ColumnHeadersDefaultCellStyle.BackColor = $headBg
$grid.ColumnHeadersDefaultCellStyle.ForeColor = [Drawing.Color]::FromArgb(0x42, 0x42, 0x42)
$grid.ColumnHeadersDefaultCellStyle.Font = $headFont
$grid.ColumnHeadersDefaultCellStyle.SelectionBackColor = $headBg
$grid.DefaultCellStyle.SelectionBackColor = [Drawing.Color]::FromArgb(0xF5, 0xF9, 0xFF)
$grid.DefaultCellStyle.SelectionForeColor = $textMain
$grid.DefaultCellStyle.Padding = New-Object Windows.Forms.Padding(6, 0, 6, 0)

$colName = New-Object Windows.Forms.DataGridViewTextBoxColumn
$colName.Name = "Component"; $colName.HeaderText = "COMPONENT"; $colName.ReadOnly = $true
$colName.AutoSizeMode = "Fill"; $colName.SortMode = "NotSortable"

$colIn = New-Object Windows.Forms.DataGridViewTextBoxColumn
$colIn.Name = "InSolution"; $colIn.HeaderText = "IN SOLUTION"; $colIn.ReadOnly = $true; $colIn.Width = 100
$colIn.DefaultCellStyle.Alignment = "MiddleCenter"; $colIn.SortMode = "NotSortable"

$colVer = New-Object Windows.Forms.DataGridViewTextBoxColumn
$colVer.Name = "Version"; $colVer.HeaderText = "VERSION"; $colVer.Width = 110; $colVer.SortMode = "NotSortable"
$colVer.DefaultCellStyle.Font = New-Object Drawing.Font("Consolas", 10)

$colPlus = New-Object Windows.Forms.DataGridViewButtonColumn
$colPlus.Name = "Plus"; $colPlus.HeaderText = ""; $colPlus.Text = "+"; $colPlus.UseColumnTextForButtonValue = $true
$colPlus.Width = 44; $colPlus.FlatStyle = "Flat"

$colSave = New-Object Windows.Forms.DataGridViewButtonColumn
$colSave.Name = "Save"; $colSave.HeaderText = ""; $colSave.Text = "Save"; $colSave.UseColumnTextForButtonValue = $true
$colSave.Width = 70; $colSave.FlatStyle = "Flat"

$colPath = New-Object Windows.Forms.DataGridViewTextBoxColumn
$colPath.Name = "Path"; $colPath.Visible = $false
$colSaved = New-Object Windows.Forms.DataGridViewTextBoxColumn
$colSaved.Name = "SavedVersion"; $colSaved.Visible = $false

$grid.Columns.AddRange([Windows.Forms.DataGridViewColumn[]]@($colName, $colIn, $colVer, $colPlus, $colSave, $colPath, $colSaved))

# Log
$log = New-Object Windows.Forms.TextBox
$log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = "Vertical"; $log.WordWrap = $false
$log.Dock = "Bottom"; $log.Height = 230
$log.Font = New-Object Drawing.Font("Consolas", 9)
$log.BackColor = [Drawing.Color]::FromArgb(0xFA, 0xFA, 0xFA)
$log.BorderStyle = "None"

$status = New-Object Windows.Forms.Label
$status.Dock = "Bottom"; $status.Height = 28; $status.TextAlign = "MiddleLeft"
$status.Padding = New-Object Windows.Forms.Padding(14, 0, 0, 0); $status.ForeColor = $textMuted

$form.Controls.Add($grid)      # Fill must be added first so docked edges win
$form.Controls.Add($top)
$form.Controls.Add($status)
$form.Controls.Add($log)

function Write-Log([string]$line) {
  $log.AppendText($line + [Environment]::NewLine)
}

function Set-Status([string]$text, [Drawing.Color]$color) {
  $status.Text = $text; $status.ForeColor = $color
}

# ─── Rows ────────────────────────────────────────────────────────────────

function Update-RowState([Windows.Forms.DataGridViewRow]$row) {
  $dirty = [string]$row.Cells["Version"].Value -ne [string]$row.Cells["SavedVersion"].Value
  $bg = if ($dirty) { $dirtyBg } else { [Drawing.Color]::White }
  foreach ($c in @("Component", "InSolution", "Version")) { $row.Cells[$c].Style.BackColor = $bg }
  $row.Cells["Save"].Style.ForeColor = if ($dirty) { $brand } else { [Drawing.Color]::FromArgb(0xA0, 0xA0, 0xA0) }
  $row.Cells["Save"].Style.Font = if ($dirty) { $uiBold } else { $uiFont }
}

function Get-DirtyRows {
  @($grid.Rows | Where-Object { [string]$_.Cells["Version"].Value -ne [string]$_.Cells["SavedVersion"].Value })
}

function Import-Manifests {
  $grid.Rows.Clear()
  $referenced = Get-ReferencedControls
  Get-ChildItem -Path $pcfRoot -Directory | Sort-Object Name | ForEach-Object {
    $manifest = Join-Path $_.FullName "$($_.Name)/ControlManifest.Input.xml"
    if (-not (Test-Path $manifest)) { return }
    $ver = Read-ManifestVersion $manifest
    if ($null -eq $ver) { return }
    $inSol = if ($referenced -contains $_.Name) { "Yes" } else { "—" }
    $i = $grid.Rows.Add($_.Name, $inSol, $ver, "+", "Save", $manifest, $ver)
    $row = $grid.Rows[$i]
    if ($inSol -ne "Yes") { $row.Cells["Component"].Style.ForeColor = $textMuted; $row.Cells["InSolution"].Style.ForeColor = $textMuted }
    Update-RowState $row
  }
  $solLabel.Text = "Solution ARNGCheckbookExtensions  ·  v$(Get-SolutionVersion)  (Build bumps the last number)"
  Set-Status "$($grid.Rows.Count) controls loaded from pcf/" $textMuted
}

function Save-Row([Windows.Forms.DataGridViewRow]$row) {
  $name = $row.Cells["Component"].Value
  $ver  = ([string]$row.Cells["Version"].Value).Trim()
  if (-not $versionFormatRx.IsMatch($ver)) { throw "$name — '$ver' is not a version (expected e.g. 1.2.3)" }
  if ($ver -eq [string]$row.Cells["SavedVersion"].Value) { return $false }
  Write-ManifestVersion ([string]$row.Cells["Path"].Value) $ver
  Write-Log "Saved $name  $($row.Cells['SavedVersion'].Value) -> $ver"
  $row.Cells["Version"].Value = $ver
  $row.Cells["SavedVersion"].Value = $ver
  Update-RowState $row
  return $true
}

# ─── Events ──────────────────────────────────────────────────────────────

$grid.add_CellContentClick({
  param($s, $e)
  if ($e.RowIndex -lt 0 -or $script:building) { return }
  $row = $grid.Rows[$e.RowIndex]
  $col = $grid.Columns[$e.ColumnIndex].Name
  try {
    if ($col -eq "Plus") {
      $grid.EndEdit() | Out-Null
      $cur = ([string]$row.Cells["Version"].Value).Trim()
      if (-not $versionFormatRx.IsMatch($cur)) { throw "'$cur' is not a version (expected e.g. 1.2.3)" }
      $row.Cells["Version"].Value = Step-Version $cur
      Update-RowState $row
      Set-Status "$($row.Cells['Component'].Value): $cur -> $($row.Cells['Version'].Value)  (not saved)" $textMuted
    }
    elseif ($col -eq "Save") {
      $grid.EndEdit() | Out-Null
      if (Save-Row $row) { Set-Status "Saved $($row.Cells['Component'].Value) $($row.Cells['Version'].Value)" $okText }
      else { Set-Status "$($row.Cells['Component'].Value): nothing to save" $textMuted }
    }
  } catch { Set-Status $_.Exception.Message $errText }
})

# Typing a version directly also marks the row unsaved.
$grid.add_CellEndEdit({ param($s, $e) Update-RowState $grid.Rows[$e.RowIndex] })

$btnReload.add_Click({
  if ((Get-DirtyRows).Count -gt 0) {
    $r = [Windows.Forms.MessageBox]::Show("Discard unsaved version changes?", "Reload", "YesNo", "Question")
    if ($r -ne "Yes") { return }
  }
  Import-Manifests
})

$form.add_FormClosing({
  param($s, $e)
  if ($SnapshotPath) { return }   # test hook: never prompt
  if ($script:building) {
    [Windows.Forms.MessageBox]::Show("A build is still running.", "Build Extensions") | Out-Null
    $e.Cancel = $true; return
  }
  if ((Get-DirtyRows).Count -gt 0) {
    $r = [Windows.Forms.MessageBox]::Show("You have unsaved version changes. Close anyway?", "Build Extensions", "YesNo", "Warning")
    if ($r -ne "Yes") { $e.Cancel = $true }
  }
})

# ─── Build (runs build-extensions.ps1 in a child process) ────────────────
# Output goes to temp files that a UI timer tails, so the window stays
# responsive and no PowerShell code runs on a background thread.

$script:building = $false
$script:proc = $null
$script:outFile = $null; $script:errFile = $null
$script:outPos = 0L; $script:errPos = 0L

function Read-NewText([string]$path, [ref]$pos) {
  if (-not (Test-Path $path)) { return "" }
  $fs = [IO.File]::Open($path, "Open", "Read", "ReadWrite")
  try {
    if ($fs.Length -le $pos.Value) { return "" }
    $fs.Seek($pos.Value, "Begin") | Out-Null
    $sr = New-Object IO.StreamReader($fs)
    $txt = $sr.ReadToEnd()
    $pos.Value = $fs.Length
    return $txt
  } finally { $fs.Dispose() }
}

function Sync-BuildOutput {
  foreach ($pair in @(@($script:outFile, [ref]$script:outPos), @($script:errFile, [ref]$script:errPos))) {
    $t = Read-NewText $pair[0] $pair[1]
    if ($t) { $log.AppendText(($t -replace "`r?`n", [Environment]::NewLine)) }
  }
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 300
$timer.add_Tick({
  Sync-BuildOutput
  if ($script:proc -and $script:proc.HasExited) {
    $timer.Stop()
    Sync-BuildOutput
    $code = $script:proc.ExitCode
    $script:building = $false
    $btnBuild.Enabled = $true; $btnReload.Enabled = $true; $grid.Enabled = $true
    $btnBuild.Text = "Build"
    if ($code -eq 0) { Set-Status "Build succeeded  ·  solutions/ARNGCheckbookExtensions.zip" $okText }
    else { Set-Status "Build failed (exit code $code) — see the log" $errText }
    $solLabel.Text = "Solution ARNGCheckbookExtensions  ·  v$(Get-SolutionVersion)  (Build bumps the last number)"
    Remove-Item $script:outFile, $script:errFile -ErrorAction SilentlyContinue
  }
})

$btnBuild.add_Click({
  if ($script:building) { return }
  $grid.EndEdit() | Out-Null
  try {
    $saved = 0
    foreach ($row in Get-DirtyRows) { if (Save-Row $row) { $saved++ } }
    if ($saved) { Write-Log "Saved $saved manifest(s) before building." }
  } catch { Set-Status $_.Exception.Message $errText; return }

  $script:outFile = [IO.Path]::GetTempFileName(); $script:errFile = [IO.Path]::GetTempFileName()
  $script:outPos = 0L; $script:errPos = 0L
  Write-Log ("─" * 60)
  Write-Log "Running build-extensions.ps1  ($(Get-Date -Format 'HH:mm:ss'))"
  $script:proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$buildScript`"") `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $script:outFile -RedirectStandardError $script:errFile
  $null = $script:proc.Handle   # cache the handle so ExitCode is readable after exit
  $script:building = $true
  $btnBuild.Enabled = $false; $btnReload.Enabled = $false; $grid.Enabled = $false
  $btnBuild.Text = "Building…"
  Set-Status "Building… (npm install where needed, then dotnet build)" $brand
  $timer.Start()
})

# ─── Run ─────────────────────────────────────────────────────────────────

Import-Manifests

if ($SnapshotPath) {
  # Test hook: show a bumped, unsaved row so the dirty state is visible, render, exit.
  $form.add_Shown({
    if ($grid.Rows.Count -gt 1) {
      $r = $grid.Rows[1]; $r.Cells["Version"].Value = Step-Version ([string]$r.Cells["Version"].Value); Update-RowState $r
      Set-Status "$($r.Cells['Component'].Value): $($r.Cells['SavedVersion'].Value) -> $($r.Cells['Version'].Value)  (not saved)" $textMuted
    }
    $form.Refresh()
    $bmp = New-Object Drawing.Bitmap($form.Width, $form.Height)
    $form.DrawToBitmap($bmp, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
    $bmp.Save($SnapshotPath, [Drawing.Imaging.ImageFormat]::Png)
    $form.Close()
  })
}

[void]$form.ShowDialog()
