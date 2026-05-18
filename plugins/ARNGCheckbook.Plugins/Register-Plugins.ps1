<#
.SYNOPSIS
    Registers plugin assembly and steps to Dataverse using Web API.

.DESCRIPTION
    This script registers the ARNGCheckbook.Plugins assembly and all configured
    plugin steps to a Dataverse environment. It uses the PluginRegistration.json
    file for step configuration.

.PARAMETER EnvironmentUrl
    The Dataverse environment URL (e.g., https://yourorg.crm.dynamics.com)

.PARAMETER SolutionName
    The solution unique name to add components to (default: ARNGCheckbook)

.EXAMPLE
    ./Register-Plugins.ps1 -EnvironmentUrl "https://myorg.crm.dynamics.com"

.NOTES
    Requires: Azure CLI (az) for authentication, or provide a bearer token
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$EnvironmentUrl,

    [Parameter(Mandatory=$false)]
    [string]$SolutionName = "ARNGCheckbook",

    [Parameter(Mandatory=$false)]
    [string]$AssemblyPath = "bin/Debug/net462/ARNGCheckbook.Plugins.dll",

    [Parameter(Mandatory=$false)]
    [string]$BearerToken
)

$ErrorActionPreference = "Stop"

# Ensure URL doesn't have trailing slash
$EnvironmentUrl = $EnvironmentUrl.TrimEnd('/')
$ApiUrl = "$EnvironmentUrl/api/data/v9.2"

# Get authentication token
function Get-DataverseToken {
    param([string]$ResourceUrl)

    if ($BearerToken) {
        return $BearerToken
    }

    # Method 1: Try Azure CLI
    Write-Host "Attempting Azure CLI authentication..." -ForegroundColor Cyan
    try {
        $token = az account get-access-token --resource "$ResourceUrl" --query accessToken -o tsv 2>$null
        if ($token) {
            Write-Host "  Authenticated via Azure CLI" -ForegroundColor Green
            return $token
        }
    } catch {
        Write-Host "  Azure CLI not available" -ForegroundColor Yellow
    }

    # Method 2: Try to read from pac CLI config
    Write-Host "Attempting to read pac CLI token..." -ForegroundColor Cyan
    $pacConfigPath = Join-Path $env:HOME ".pac" "tools" "pac" "authprofiles.json"
    if (-not (Test-Path $pacConfigPath)) {
        $pacConfigPath = Join-Path (Get-Location) ".pac" "authprofiles.json"
    }

    if (Test-Path $pacConfigPath) {
        try {
            $pacConfig = Get-Content $pacConfigPath | ConvertFrom-Json
            foreach ($profile in $pacConfig.profiles) {
                if ($profile.resource -like "*$($ResourceUrl.Replace('https://', '').Split('.')[0])*" -or
                    $profile.environmentUrl -like "*$($ResourceUrl.Replace('https://', '').Split('.')[0])*") {
                    if ($profile.accessToken) {
                        Write-Host "  Found pac CLI token" -ForegroundColor Green
                        return $profile.accessToken
                    }
                }
            }
        } catch {
            Write-Host "  Could not read pac CLI config" -ForegroundColor Yellow
        }
    }

    # Method 3: Interactive device code flow
    Write-Host ""
    Write-Host "No existing authentication found. Starting interactive login..." -ForegroundColor Cyan
    Write-Host ""

    # Use the well-known Power Platform / Dynamics 365 client ID
    $clientId = "51f81489-12ee-4a9e-aaae-a2591f45987d"  # Power Platform CLI client ID
    $tenantId = "common"
    $scope = "$ResourceUrl/.default"

    $deviceCodeUrl = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/devicecode"
    $tokenUrl = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"

    # Request device code
    $deviceCodeBody = @{
        client_id = $clientId
        scope = $scope
    }

    try {
        $deviceCodeResponse = Invoke-RestMethod -Method POST -Uri $deviceCodeUrl -Body $deviceCodeBody
    } catch {
        Write-Error "Failed to initiate device code flow: $_"
        Write-Host ""
        Write-Host "Alternative: Run 'az login' first, then re-run this script" -ForegroundColor Yellow
        Write-Host "Or provide a bearer token: -BearerToken <your-token>" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host $deviceCodeResponse.message -ForegroundColor White
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""

    # Poll for token
    $tokenBody = @{
        grant_type = "urn:ietf:params:oauth:grant-type:device_code"
        client_id = $clientId
        device_code = $deviceCodeResponse.device_code
    }

    $expiresAt = (Get-Date).AddSeconds($deviceCodeResponse.expires_in)
    $interval = $deviceCodeResponse.interval

    while ((Get-Date) -lt $expiresAt) {
        Start-Sleep -Seconds $interval

        try {
            $tokenResponse = Invoke-RestMethod -Method POST -Uri $tokenUrl -Body $tokenBody -ErrorAction Stop
            Write-Host "  Authentication successful!" -ForegroundColor Green
            return $tokenResponse.access_token
        } catch {
            $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($errorResponse.error -eq "authorization_pending") {
                Write-Host "  Waiting for authorization..." -ForegroundColor Gray
            } elseif ($errorResponse.error -eq "slow_down") {
                $interval += 5
            } else {
                throw
            }
        }
    }

    Write-Error "Device code expired. Please try again."
    exit 1
}

# Make authenticated API request
function Invoke-DataverseApi {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body,
        [hashtable]$Headers = @{}
    )

    $defaultHeaders = @{
        "Authorization" = "Bearer $script:Token"
        "OData-MaxVersion" = "4.0"
        "OData-Version" = "4.0"
        "Accept" = "application/json"
        "Content-Type" = "application/json; charset=utf-8"
        "Prefer" = "return=representation"
    }

    $allHeaders = $defaultHeaders + $Headers

    $params = @{
        Method = $Method
        Uri = $Uri
        Headers = $allHeaders
    }

    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }

    try {
        $response = Invoke-RestMethod @params
        return $response
    }
    catch {
        $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($errorDetails) {
            Write-Error "API Error: $($errorDetails.error.message)"
        }
        throw
    }
}

# Get SDK Message ID by name
function Get-SdkMessageId {
    param([string]$MessageName)

    $filter = "name eq '$MessageName'"
    $uri = "$ApiUrl/sdkmessages?`$filter=$filter&`$select=sdkmessageid"
    $result = Invoke-DataverseApi -Method GET -Uri $uri

    if ($result.value.Count -eq 0) {
        throw "SDK Message '$MessageName' not found"
    }

    return $result.value[0].sdkmessageid
}

# Get SDK Message Filter ID
function Get-SdkMessageFilterId {
    param(
        [string]$MessageId,
        [string]$EntityLogicalName
    )

    $filter = "_sdkmessageid_value eq $MessageId and primaryobjecttypecode eq '$EntityLogicalName'"
    $uri = "$ApiUrl/sdkmessagefilters?`$filter=$filter&`$select=sdkmessagefilterid"
    $result = Invoke-DataverseApi -Method GET -Uri $uri

    if ($result.value.Count -eq 0) {
        # Try without entity filter for global messages
        $filter = "_sdkmessageid_value eq $MessageId"
        $uri = "$ApiUrl/sdkmessagefilters?`$filter=$filter&`$top=1&`$select=sdkmessagefilterid"
        $result = Invoke-DataverseApi -Method GET -Uri $uri
    }

    if ($result.value.Count -eq 0) {
        throw "SDK Message Filter not found for message $MessageId on entity $EntityLogicalName"
    }

    return $result.value[0].sdkmessagefilterid
}

# Get Solution ID
function Get-SolutionId {
    param([string]$UniqueName)

    $filter = "uniquename eq '$UniqueName'"
    $uri = "$ApiUrl/solutions?`$filter=$filter&`$select=solutionid"
    $result = Invoke-DataverseApi -Method GET -Uri $uri

    if ($result.value.Count -eq 0) {
        throw "Solution '$UniqueName' not found"
    }

    return $result.value[0].solutionid
}

# Register Plugin Assembly
function Register-PluginAssembly {
    param(
        [string]$AssemblyPath,
        [string]$SolutionUniqueName
    )

    Write-Host "Registering plugin assembly..." -ForegroundColor Cyan

    # Read and encode assembly
    $assemblyBytes = [System.IO.File]::ReadAllBytes($AssemblyPath)
    $assemblyBase64 = [Convert]::ToBase64String($assemblyBytes)

    # Get assembly info
    $assemblyName = [System.IO.Path]::GetFileNameWithoutExtension($AssemblyPath)

    # Check if assembly already exists
    $filter = "name eq '$assemblyName'"
    $uri = "$ApiUrl/pluginassemblies?`$filter=$filter&`$select=pluginassemblyid,version"
    $existing = Invoke-DataverseApi -Method GET -Uri $uri

    $assemblyBody = @{
        name = $assemblyName
        content = $assemblyBase64
        isolationmode = 2  # Sandbox
        sourcetype = 0     # Database
    }

    if ($existing.value.Count -gt 0) {
        # Update existing
        $assemblyId = $existing.value[0].pluginassemblyid
        Write-Host "  Updating existing assembly: $assemblyId" -ForegroundColor Yellow
        $uri = "$ApiUrl/pluginassemblies($assemblyId)"
        Invoke-DataverseApi -Method PATCH -Uri $uri -Body $assemblyBody | Out-Null
    }
    else {
        # Create new
        Write-Host "  Creating new assembly registration" -ForegroundColor Green
        $uri = "$ApiUrl/pluginassemblies"
        $headers = @{ "MSCRM.SolutionUniqueName" = $SolutionUniqueName }
        $result = Invoke-DataverseApi -Method POST -Uri $uri -Body $assemblyBody -Headers $headers
        $assemblyId = $result.pluginassemblyid
    }

    Write-Host "  Assembly ID: $assemblyId" -ForegroundColor Green
    return $assemblyId
}

# Register Plugin Type
function Register-PluginType {
    param(
        [string]$AssemblyId,
        [string]$TypeName,
        [string]$FriendlyName,
        [string]$Description,
        [string]$SolutionUniqueName
    )

    Write-Host "  Registering plugin type: $TypeName" -ForegroundColor Cyan

    # Check if type already exists
    $filter = "typename eq '$TypeName'"
    $uri = "$ApiUrl/plugintypes?`$filter=$filter&`$select=plugintypeid"
    $existing = Invoke-DataverseApi -Method GET -Uri $uri

    if ($existing.value.Count -gt 0) {
        Write-Host "    Plugin type already exists: $($existing.value[0].plugintypeid)" -ForegroundColor Yellow
        return $existing.value[0].plugintypeid
    }

    $body = @{
        typename = $TypeName
        friendlyname = $FriendlyName
        name = $FriendlyName
        description = $Description
        "pluginassemblyid@odata.bind" = "/pluginassemblies($AssemblyId)"
    }

    $uri = "$ApiUrl/plugintypes"
    $headers = @{ "MSCRM.SolutionUniqueName" = $SolutionUniqueName }
    $result = Invoke-DataverseApi -Method POST -Uri $uri -Body $body -Headers $headers

    Write-Host "    Created plugin type: $($result.plugintypeid)" -ForegroundColor Green
    return $result.plugintypeid
}

# Register SDK Message Processing Step
function Register-PluginStep {
    param(
        [string]$PluginTypeId,
        [object]$StepConfig,
        [string]$SolutionUniqueName
    )

    $stepName = $StepConfig.name
    Write-Host "    Registering step: $stepName" -ForegroundColor Cyan

    # Check if step already exists
    $filter = "name eq '$stepName'"
    $uri = "$ApiUrl/sdkmessageprocessingsteps?`$filter=$filter&`$select=sdkmessageprocessingstepid"
    $existing = Invoke-DataverseApi -Method GET -Uri $uri

    if ($existing.value.Count -gt 0) {
        Write-Host "      Step already exists: $($existing.value[0].sdkmessageprocessingstepid)" -ForegroundColor Yellow
        return $existing.value[0].sdkmessageprocessingstepid
    }

    # Get message and filter IDs
    $messageId = Get-SdkMessageId -MessageName $StepConfig.message
    $filterId = Get-SdkMessageFilterId -MessageId $messageId -EntityLogicalName $StepConfig.primaryEntity

    # Map stage name to code
    $stageMap = @{
        "PreValidation" = 10
        "PreOperation" = 20
        "PostOperation" = 40
    }
    $stage = $stageMap[$StepConfig.stage]
    if ($null -eq $stage) { $stage = 20 }

    # Map execution mode
    $mode = if ($StepConfig.executionMode -eq "Asynchronous") { 1 } else { 0 }

    $body = @{
        name = $stepName
        stage = $stage
        mode = $mode
        rank = 1
        supporteddeployment = 0  # Server only
        "sdkmessageid@odata.bind" = "/sdkmessages($messageId)"
        "sdkmessagefilterid@odata.bind" = "/sdkmessagefilters($filterId)"
        "plugintypeid@odata.bind" = "/plugintypes($PluginTypeId)"
    }

    # Add filtering attributes if specified
    if ($StepConfig.filteringAttributes) {
        $body.filteringattributes = $StepConfig.filteringAttributes
    }

    # Add async auto-delete for async steps
    if ($mode -eq 1) {
        $body.asyncautodelete = $true
    }

    $uri = "$ApiUrl/sdkmessageprocessingsteps"
    $headers = @{ "MSCRM.SolutionUniqueName" = $SolutionUniqueName }
    $result = Invoke-DataverseApi -Method POST -Uri $uri -Body $body -Headers $headers
    $stepId = $result.sdkmessageprocessingstepid

    Write-Host "      Created step: $stepId" -ForegroundColor Green

    # Register images if specified
    if ($StepConfig.images) {
        foreach ($image in $StepConfig.images) {
            Register-StepImage -StepId $stepId -ImageConfig $image -SolutionUniqueName $SolutionUniqueName
        }
    }

    return $stepId
}

# Register Step Image
function Register-StepImage {
    param(
        [string]$StepId,
        [object]$ImageConfig,
        [string]$SolutionUniqueName
    )

    $imageName = $ImageConfig.name
    Write-Host "      Registering image: $imageName" -ForegroundColor Cyan

    # Map image type
    $imageTypeMap = @{
        "PreImage" = 0
        "PostImage" = 1
        "Both" = 2
    }
    $imageType = $imageTypeMap[$ImageConfig.type]
    if ($null -eq $imageType) { $imageType = 0 }

    $body = @{
        name = $imageName
        entityalias = $imageName
        imagetype = $imageType
        attributes = $ImageConfig.attributes
        "sdkmessageprocessingstepid@odata.bind" = "/sdkmessageprocessingsteps($StepId)"
    }

    $uri = "$ApiUrl/sdkmessageprocessingstepimages"
    $headers = @{ "MSCRM.SolutionUniqueName" = $SolutionUniqueName }
    $result = Invoke-DataverseApi -Method POST -Uri $uri -Body $body -Headers $headers

    Write-Host "        Created image: $($result.sdkmessageprocessingstepimageid)" -ForegroundColor Green
}

# ============= Main Script =============

Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Plugin Registration Script" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Environment: $EnvironmentUrl" -ForegroundColor White
Write-Host "Solution: $SolutionName" -ForegroundColor White
Write-Host "Assembly: $AssemblyPath" -ForegroundColor White
Write-Host ""

# Verify assembly exists
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$fullAssemblyPath = Join-Path $scriptDir $AssemblyPath

if (-not (Test-Path $fullAssemblyPath)) {
    Write-Error "Assembly not found: $fullAssemblyPath"
    Write-Host "Please build the project first: dotnet build" -ForegroundColor Yellow
    exit 1
}

# Load registration config
$configPath = Join-Path $scriptDir "PluginRegistration.json"
if (-not (Test-Path $configPath)) {
    Write-Error "PluginRegistration.json not found: $configPath"
    exit 1
}

$config = Get-Content $configPath | ConvertFrom-Json

# Authenticate
$script:Token = Get-DataverseToken -ResourceUrl $EnvironmentUrl

# Verify solution exists
Write-Host "Verifying solution exists..." -ForegroundColor Cyan
$solutionId = Get-SolutionId -UniqueName $SolutionName
Write-Host "  Solution ID: $solutionId" -ForegroundColor Green
Write-Host ""

# Register assembly
$assemblyId = Register-PluginAssembly -AssemblyPath $fullAssemblyPath -SolutionUniqueName $SolutionName
Write-Host ""

# Register each plugin and its steps
foreach ($plugin in $config.plugins) {
    $pluginTypeId = Register-PluginType `
        -AssemblyId $assemblyId `
        -TypeName $plugin.typeName `
        -FriendlyName $plugin.name `
        -Description $plugin.description `
        -SolutionUniqueName $SolutionName

    foreach ($step in $plugin.steps) {
        Register-PluginStep -PluginTypeId $pluginTypeId -StepConfig $step -SolutionUniqueName $SolutionName
    }

    Write-Host ""
}

Write-Host "=======================================" -ForegroundColor Green
Write-Host "Plugin registration complete!" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green
