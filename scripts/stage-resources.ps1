# Copy platform add-ins to Tauri resources.
# OfficeJS and WPS are bundled on every desktop target; VSTO is required only on Windows.

param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$NativeOfficeStaging = "",
    [string]$WpsStaging = "",
    [string]$OfficeJsStaging = "",
    [string]$ObsidianStaging = "",
    [string]$NativeOfficeSourceName = "",
    [string]$WpsSourceName = "",
    [string]$OfficeJsSourceName = "",
    [string]$ObsidianSourceName = ""
)

$ErrorActionPreference = "Stop"
$runningOnWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
)

$runningOnMacOS = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::OSX
)

$runningOnLinux = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Linux
)

function Join-PathParts {
    param([Parameter(Mandatory = $true)][string[]]$Parts)
    $path = $Parts[0]
    for ($i = 1; $i -lt $Parts.Count; $i++) {
        $path = Join-Path $path $Parts[$i]
    }
    $path
}

function Resolve-RelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$Base,
        [Parameter(Mandatory = $true)][string]$Relative
    )
    $path = $Base
    foreach ($part in ($Relative -split '[\\/]+' | Where-Object { $_ })) {
        $path = Join-Path $path $part
    }
    $path
}

$resourcesDir = Join-PathParts @($ProjectRoot, "src-tauri", "resources")

function Require-File {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label missing: $Path"
    }
}

function Require-Dir {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label missing: $Path"
    }
}

# PE Machine type constants
$PE_MACHINE_X86  = 0x14c
$PE_MACHINE_X64  = 0x8664

function Get-PeMachineType {
    param([string]$DllPath)
    $stream = [System.IO.File]::OpenRead($DllPath)
    try {
        $binaryReader = [System.IO.BinaryReader]::new($stream)
        # Read DOS header -> e_lfanew at offset 0x3C
        $stream.Seek(0x3C, [System.IO.SeekOrigin]::Begin) | Out-Null
        $peOffset = $binaryReader.ReadInt32()
        # PE Signature at peOffset, Machine at peOffset + 4
        $stream.Seek($peOffset + 4, [System.IO.SeekOrigin]::Begin) | Out-Null
        return $binaryReader.ReadUInt16()
    } finally {
        $stream.Dispose()
    }
}

function Assert-OleDllBitness {
    param(
        [string]$DllPath,
        [string]$ExpectedLabel,
        [uint16]$ExpectedMachine
    )
    if (-not (Test-Path -LiteralPath $DllPath -PathType Leaf)) {
        throw "OLE DLL missing: $DllPath"
    }
    $actual = Get-PeMachineType -DllPath $DllPath
    $expectedHex = "0x{0:X4}" -f $ExpectedMachine
    $actualHex   = "0x{0:X4}" -f $actual
    if ($actual -ne $ExpectedMachine) {
        throw "$ExpectedLabel PE Machine mismatch: expected $expectedHex ($ExpectedLabel), found $actualHex"
    }
}

function Copy-CleanDir {
    param([string]$Source, [string]$Destination)
    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Get-LatestWpsBuild {
    $distRoot = Join-PathParts @($ProjectRoot, "apps", "wps", "dist")
    if (-not (Test-Path -LiteralPath $distRoot -PathType Container)) {
        return $null
    }
    Get-ChildItem -LiteralPath $distRoot -Directory -Filter "latexsnipper-wps_*" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

Write-Host "=== Staging resources for Tauri bundle ===" -ForegroundColor Green
Write-Host "  Project root: $ProjectRoot"
Write-Host "  Resources: $resourcesDir"
Write-Host "  Host platform: $(if ($runningOnWindows) { 'Windows' } else { 'non-Windows' })"
New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null

# Office.js is produced by scripts/stage-office-addin.mjs before this script runs.
$officeJsDir = Join-Path $resourcesDir "OfficeJS"
if (-not [string]::IsNullOrWhiteSpace($OfficeJsStaging)) {
    $officeJsSource = (Resolve-Path -LiteralPath $OfficeJsStaging -ErrorAction Stop).Path
    Require-Dir $officeJsSource "Explicit Office.js staging directory"
    if (-not $officeJsSource.Equals([System.IO.Path]::GetFullPath($officeJsDir), [System.StringComparison]::OrdinalIgnoreCase)) {
        Copy-CleanDir $officeJsSource $officeJsDir
    }
}
Require-Dir (Join-Path $officeJsDir "site") "Office.js site directory"
Require-Dir (Join-Path $officeJsDir "manifest") "Office.js manifest directory"
Require-File (Join-PathParts @($officeJsDir, "site", "taskpane.html")) "Office.js taskpane"
foreach ($officeHost in @("word", "excel", "powerpoint")) {
    Require-File (Join-PathParts @($officeJsDir, "manifest", "$officeHost.xml")) "Office.js $officeHost manifest"
}
Write-Host "  OfficeJS: ready" -ForegroundColor Green

# WPS JSAddIn. It is JavaScript-only and is staged from its build output on all hosts.
$wpsSource = if (-not [string]::IsNullOrWhiteSpace($WpsStaging)) {
    $resolvedWps = (Resolve-Path -LiteralPath $WpsStaging -ErrorAction Stop).Path
    Require-Dir $resolvedWps "Explicit WPS staging directory"
    $resolvedWps
} else {
    $wpsBuild = Get-LatestWpsBuild
    if (-not $wpsBuild) {
        throw "WPS build output missing. Run npm run build:wps before packaging."
    }
    Write-Warning "Using local-development WPS fallback: $($wpsBuild.FullName)"
    $wpsBuild.FullName
}
$wpsDest = Join-Path $resourcesDir "WPS"
foreach ($file in @(
    "index.html",
    "main.js",
    "manifest.json",
    "manifest.xml",
    "ribbon.xml",
    "js/command-layer.js",
    "js/host-detect.js",
    "js/bridge-client.js",
    "js/adapters.js",
    "js/ribbon.js",
    "js/util.js",
    "ui/taskpane.html",
    "ui/taskpane.js"
)) {
    Require-File (Resolve-RelativePath $wpsSource $file) "WPS payload"
}
Copy-CleanDir $wpsSource $wpsDest
$wpsProductionText = Get-ChildItem -LiteralPath $wpsDest -Recurse -File |
    Where-Object { $_.Extension -in @(".js", ".html", ".xml", ".json") } |
    ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName } |
    Out-String
foreach ($forbidden in @(
    "http://127.0.0.1:8080",
    "127.0.0.1:28765",
    "127.0.0.1:28766",
    "http://127.0.0.1:19876",
    "/convert/latex",
    "Date.now() % 1000",
    'addonType="wps"'
)) {
    if ($wpsProductionText.Contains($forbidden)) {
        throw "WPS production payload contains forbidden legacy value: $forbidden"
    }
}

function Get-PackageVersion {
    param(
        [Parameter(Mandatory = $true)][string]$PackageJson,
        [Parameter(Mandatory = $true)][string]$Label
    )
    Require-File $PackageJson "$Label package metadata"
    $metadata = Get-Content -Raw -LiteralPath $PackageJson | ConvertFrom-Json
    $version = [string]$metadata.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
        throw "$Label package version is invalid: $version"
    }
    return $version
}
$wpsCount = (Get-ChildItem -LiteralPath $wpsDest -Recurse -File).Count
Write-Host "  WPS: $wpsCount files staged from $wpsSource" -ForegroundColor Green

# NativeOffice VSTO. It is a Windows-only payload.
$vstoDest = Join-Path $resourcesDir "NativeOffice"
if ($runningOnWindows) {
    $vstoStaging = if ([string]::IsNullOrWhiteSpace($NativeOfficeStaging)) {
        Join-PathParts @($ProjectRoot, "apps", "native-office", "Installer", "output", "staging")
    } else {
        (Resolve-Path -LiteralPath $NativeOfficeStaging -ErrorAction Stop).Path
    }
    foreach ($nativeHost in @("Word", "Excel", "PowerPoint", "Visio")) {
        Require-File (Join-Path $vstoStaging "$nativeHost\LaTeXSnipper.$nativeHost.vsto") "NativeOffice $nativeHost VSTO manifest"
        Require-File (Join-Path $vstoStaging "$nativeHost\LaTeXSnipper.$nativeHost.dll.manifest") "NativeOffice $nativeHost DLL manifest"
        Require-File (Join-Path $vstoStaging "$nativeHost\LaTeXSnipper.$nativeHost.dll") "NativeOffice $nativeHost DLL"
    }
    Require-Dir (Join-Path $vstoStaging "Shared") "NativeOffice shared directory"
    Require-File (Join-Path $vstoStaging "Shared\LaTeXSnipper.NativeOffice.Shared.dll") "NativeOffice shared DLL"

    # OLE component: require both x86 and x64 DLLs for dual-arch Office support
    $oleX86 = Join-Path $vstoStaging "OleFormulaObject.x86.dll"
    $oleX64 = Join-Path $vstoStaging "OleFormulaObject.x64.dll"
    Require-File $oleX86 "NativeOffice OLE x86 DLL"
    Require-File $oleX64 "NativeOffice OLE x64 DLL"
    # Verify PE Machine type matches the expected architecture
    Assert-OleDllBitness -DllPath $oleX86 -ExpectedLabel "x86" -ExpectedMachine $PE_MACHINE_X86
    Assert-OleDllBitness -DllPath $oleX64 -ExpectedLabel "x64" -ExpectedMachine $PE_MACHINE_X64

    # Certificate and signing metadata required for VSTO trust verification
    Require-File (Join-Path $vstoStaging "certificates\LaTeXSnipperOffice.cer") "NativeOffice signing certificate"
    Require-File (Join-Path $vstoStaging "certificates\native-office-signing.json") "NativeOffice signing metadata"

    Copy-CleanDir $vstoStaging $vstoDest

    # Copy operations must never leave a deployment manifest paired with a
    # different application manifest. Validate the final Tauri resource tree,
    # not only the build staging source.
    & (Join-Path $PSScriptRoot "verify-vsto-manifests.ps1") `
        -PayloadRoot (Resolve-Path -LiteralPath $vstoDest).Path

    $nativeCount = (Get-ChildItem -LiteralPath $vstoDest -Recurse -File).Count
    Write-Host "  NativeOffice: $nativeCount files staged" -ForegroundColor Green
} else {
    if (Test-Path -LiteralPath $vstoDest) {
        Remove-Item -LiteralPath $vstoDest -Recurse -Force
    }
    New-Item -ItemType Directory -Path $vstoDest -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $vstoDest "UNSUPPORTED.txt") `
        -Value "Native Office VSTO is bundled only in Windows packages." -Encoding ASCII
    Write-Host "  NativeOffice: intentionally excluded (Windows-only)" -ForegroundColor Yellow
}

# Obsidian is optional for local builds. CI should provide an exact artifact directory.
$obsidianSource = if (-not [string]::IsNullOrWhiteSpace($ObsidianStaging)) {
    (Resolve-Path -LiteralPath $ObsidianStaging -ErrorAction Stop).Path
} else {
    Join-PathParts @($ProjectRoot, "apps", "obsidian-plugin")
}
$obsidianDest = Join-Path $resourcesDir "Obsidian"
if (Test-Path -LiteralPath $obsidianDest) {
    Remove-Item -LiteralPath $obsidianDest -Recurse -Force
}
New-Item -ItemType Directory -Path $obsidianDest -Force | Out-Null
$obsidianFound = $false
foreach ($file in @("main.js", "manifest.json", "styles.css")) {
    $src = Join-Path $obsidianSource $file
    if (Test-Path -LiteralPath $src -PathType Leaf) {
        Copy-Item -LiteralPath $src -Destination $obsidianDest -Force
        $obsidianFound = $true
    }
}
if ($obsidianFound) {
    $obsidianCount = (Get-ChildItem -LiteralPath $obsidianDest -Recurse -File).Count
    Write-Host "  Obsidian: $obsidianCount files staged" -ForegroundColor Green
} else {
    Set-Content -Path (Join-Path $obsidianDest "README.txt") -Value "Obsidian plugin was not built for this package." -Encoding ASCII
    Write-Host "  Obsidian: optional payload not built" -ForegroundColor Yellow
}

Write-Host "=== Resource staging complete ===" -ForegroundColor Green
foreach ($dir in @("OfficeJS", "WPS", "NativeOffice", "Obsidian")) {
    $path = Join-Path $resourcesDir $dir
    $count = (Get-ChildItem -LiteralPath $path -Recurse -File).Count
    Write-Host "  $dir : $count files" -ForegroundColor Gray
}

$officeJsBundles = @(
    Get-ChildItem -LiteralPath (Join-Path $officeJsDir "site\assets") `
        -File `
        -Filter "taskpane-*.js"
)
if ($officeJsBundles.Count -ne 1) {
    throw "Expected exactly one Office.js taskpane bundle, found $($officeJsBundles.Count)."
}
$officeJsBundle = $officeJsBundles[0].FullName

$provenance = [ordered]@{
    schemaVersion = 1
    workflowRunId = $env:GITHUB_RUN_ID
    sourceCommitSha = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { (& git -C $ProjectRoot rev-parse HEAD) }
    packageVersion = if ($env:VERSION) {
        $env:VERSION
    } else {
        (Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json).version
    }
    officeJsVersion = "hosted/1"
    officeJsSource = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
    officeJsSha256 = $null
    officeJsTypingsVersion = Get-PackageVersion `
        (Join-Path $ProjectRoot "apps/office-addin/node_modules/@types/office-js/package.json") `
        "Office.js typings"
    officeJsBundleSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $officeJsBundle).Hash
    mathJaxVersion = Get-PackageVersion `
        (Join-Path $ProjectRoot "node_modules/mathjax/package.json") `
        "MathJax"
    buildPlatform = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    manifestVersion = if ($env:VERSION) { "$($env:VERSION).0" } else { "$((Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json).version).0" }
    sources = [ordered]@{
        officeJs = [ordered]@{
            name = if ($OfficeJsSourceName) { $OfficeJsSourceName } elseif ($OfficeJsStaging) { "explicit-path" } else { "local-build" }
            path = if ($OfficeJsStaging) { $OfficeJsStaging } else { $officeJsDir }
        }
        wps = [ordered]@{
            name = if ($WpsSourceName) { $WpsSourceName } elseif ($WpsStaging) { "explicit-path" } else { "local-build-fallback" }
            path = $wpsSource
        }
        nativeOffice = [ordered]@{
            name = if (-not $runningOnWindows) { "excluded" } elseif ($NativeOfficeSourceName) { $NativeOfficeSourceName } elseif ($NativeOfficeStaging) { "explicit-path" } else { "local-build" }
            path = if (-not $runningOnWindows) { "" } elseif ($NativeOfficeStaging) { $NativeOfficeStaging } else { $vstoDest }
        }
        obsidian = [ordered]@{
            name = if ($ObsidianSourceName) { $ObsidianSourceName } elseif ($ObsidianStaging) { "explicit-path" } else { "local-build" }
            path = $obsidianSource
        }
    }
    resourceHashes = [ordered]@{}
    wpsHashes = [ordered]@{}
    nativeOfficeHashes = [ordered]@{}
}
foreach ($resourceName in @("OfficeJS", "WPS", "Obsidian", "Ecosystem")) {
    $resourcePath = Join-Path $resourcesDir $resourceName
    if (-not (Test-Path -LiteralPath $resourcePath -PathType Container)) { continue }
    $hashes = [ordered]@{}
    Get-ChildItem -LiteralPath $resourcePath -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            $relative = $_.FullName.Substring($resourcePath.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
            $hashes[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
        }
    $provenance.resourceHashes[$resourceName] = $hashes
}
foreach ($relative in @("manifest.xml", "main.js", "js/command-layer.js")) {
    $provenance.wpsHashes[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Resolve-RelativePath $wpsDest $relative)).Hash
}
if ($runningOnWindows) {
    foreach ($name in @("OleFormulaObject.x86.dll", "OleFormulaObject.x64.dll")) {
        $provenance.nativeOfficeHashes[$name] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $vstoDest $name)).Hash
    }
}
$provenance | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resourcesDir "provenance.json") -Encoding UTF8
