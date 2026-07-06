# Build script for LaTeXSnipper Native Office installer.
# Place this file at: apps/native-office/Installer/build.ps1
# Run from any working directory; all output and WiX source paths are resolved absolutely.

param(
    [string]$Configuration = "Release",
    [string]$OutputDir = ".\output",
    [string]$MsBuildPath = "",
    [string]$Version = "1.0.0",
    [string]$WixPath = "",
    [switch]$SkipSigning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Description not found: $Path"
    }
}

function Invoke-Wix {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $script:WixExe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "WiX command failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
}

function Stage-Directory {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Assert-PathExists -Path $Source -Description "$Label build output directory"

    $sourceFiles = @(Get-ChildItem -LiteralPath $Source -Recurse -File)
    if ($sourceFiles.Count -eq 0) {
        throw "$Label build output directory is empty: $Source"
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force

    $stagedFiles = @(Get-ChildItem -LiteralPath $Destination -Recurse -File)
    if ($stagedFiles.Count -eq 0) {
        throw "$Label staging directory is empty after copy: $Destination"
    }

    Write-Host "  Staged ${Label}: $($stagedFiles.Count) file(s)" -ForegroundColor Gray
}

function Assert-RequiredFiles {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [Parameter(Mandatory = $true)][string]$StageRoot
    )

    $missing = @($Paths | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($missing.Count -gt 0) {
        $relativeMissing = $missing | ForEach-Object {
            if ($_.StartsWith($StageRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                $_.Substring($StageRoot.Length).TrimStart('\\')
            } else {
                $_
            }
        }

        throw (
            "Staging is incomplete. Required VSTO package input(s) are missing:`n  - " +
            ($relativeMissing -join "`n  - ") +
            "`nDo not continue to WiX until the VSTO project emits .dll, .vsto and .dll.manifest files."
        )
    }
}

$InstallerDir = $PSScriptRoot
$SolutionDir = Split-Path -Parent $InstallerDir
$OutputDir = Resolve-AbsolutePath -Path $OutputDir -BasePath $InstallerDir
$WixSourceDir = Join-Path $InstallerDir "WiX"
$MsiSource = Join-Path $WixSourceDir "LaTeXSnipper.NativeOffice.wxs"
$BundleSource = Join-Path $WixSourceDir "Bundle.wxs"

Assert-PathExists -Path $SolutionDir -Description "Native Office solution directory"
Assert-PathExists -Path (Join-Path $SolutionDir "LaTeXSnipper.NativeOffice.sln") -Description "Native Office solution"
Assert-PathExists -Path $MsiSource -Description "WiX MSI source"
Assert-PathExists -Path $BundleSource -Description "WiX Bundle source"

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# Resolve pinned WiX executable.
if (-not $WixPath) {
    $resolvedWix = Get-Command "wix.exe" -ErrorAction SilentlyContinue
    if (-not $resolvedWix) {
        $resolvedWix = Get-Command "wix" -ErrorAction SilentlyContinue
    }
    if (-not $resolvedWix) {
        throw "WiX executable not found. Pass -WixPath explicitly."
    }
    $WixPath = $resolvedWix.Source
}

$script:WixExe = Resolve-AbsolutePath -Path $WixPath -BasePath $InstallerDir
Assert-PathExists -Path $script:WixExe -Description "WiX executable"

$wixVersion = (& $script:WixExe --version | Out-String).Trim()
if ($wixVersion -notmatch '^4\.0\.5') {
    throw "Native Office installer requires WiX 4.0.5. Resolved: $wixVersion"
}

Write-Host "=== LaTeXSnipper Native Office Installer Build ===" -ForegroundColor Green
Write-Host "Configuration: $Configuration" -ForegroundColor Yellow
Write-Host "OutputDir: $OutputDir" -ForegroundColor Gray
Write-Host "WiX: $script:WixExe ($wixVersion)" -ForegroundColor Gray

# Step 1: Build solution.
Write-Host "`n[1/4] Building solution..." -ForegroundColor Cyan
if (-not $MsBuildPath) {
    $msbuildCommand = Get-Command "MSBuild.exe" -ErrorAction SilentlyContinue
    if ($msbuildCommand) {
        $MsBuildPath = $msbuildCommand.Source
    } else {
        $MsBuildPath = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
    }
}

$MsBuildPath = Resolve-AbsolutePath -Path $MsBuildPath -BasePath $InstallerDir
Assert-PathExists -Path $MsBuildPath -Description "MSBuild executable"
Write-Host "  MSBuild: $MsBuildPath" -ForegroundColor Gray

$solutionPath = Join-Path $SolutionDir "LaTeXSnipper.NativeOffice.sln"
$buildArgs = @(
    $solutionPath,
    "/t:Build",
    "/p:Configuration=$Configuration",
    "/p:Platform=Any CPU",
    "/v:minimal"
)

if ($SkipSigning) {
    $buildArgs += "/p:SignManifests=false"
    $buildArgs += "/p:AssemblyOriginatorKeyFile="
    Write-Host "  Manifest signing: DISABLED (development/CI validation only)" -ForegroundColor Yellow
}

& $MsBuildPath @buildArgs
if ($LASTEXITCODE -ne 0) {
    throw "MSBuild failed with exit code $LASTEXITCODE"
}

# Step 2: Collect binaries into absolute staging directories.
Write-Host "`n[2/4] Collecting binaries..." -ForegroundColor Cyan
$staging = Join-Path $OutputDir "staging"
if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$sharedSrc = Join-Path $SolutionDir "LaTeXSnipper.Shared\bin\$Configuration"
$wordSrc = Join-Path $SolutionDir "LaTeXSnipper.Word\bin\$Configuration"
$excelSrc = Join-Path $SolutionDir "LaTeXSnipper.Excel\bin\$Configuration"
$pptSrc = Join-Path $SolutionDir "LaTeXSnipper.PowerPoint\bin\$Configuration"

$sharedDst = Join-Path $staging "Shared"
$wordDst = Join-Path $staging "Word"
$excelDst = Join-Path $staging "Excel"
$pptDst = Join-Path $staging "PowerPoint"

Stage-Directory -Source $sharedSrc -Destination $sharedDst -Label "Shared"
Stage-Directory -Source $wordSrc -Destination $wordDst -Label "Word"
Stage-Directory -Source $excelSrc -Destination $excelDst -Label "Excel"
Stage-Directory -Source $pptSrc -Destination $pptDst -Label "PowerPoint"

$requiredStageFiles = @(
    (Join-Path $sharedDst "LaTeXSnipper.NativeOffice.Shared.dll"),

    (Join-Path $wordDst "LaTeXSnipper.Word.dll"),
    (Join-Path $wordDst "LaTeXSnipper.Word.vsto"),
    (Join-Path $wordDst "LaTeXSnipper.Word.dll.manifest"),

    (Join-Path $excelDst "LaTeXSnipper.Excel.dll"),
    (Join-Path $excelDst "LaTeXSnipper.Excel.vsto"),
    (Join-Path $excelDst "LaTeXSnipper.Excel.dll.manifest"),

    (Join-Path $pptDst "LaTeXSnipper.PowerPoint.dll"),
    (Join-Path $pptDst "LaTeXSnipper.PowerPoint.vsto"),
    (Join-Path $pptDst "LaTeXSnipper.PowerPoint.dll.manifest")
)
Assert-RequiredFiles -Paths $requiredStageFiles -StageRoot $staging

Write-Host "  Staging root: $staging" -ForegroundColor Gray
Get-ChildItem -LiteralPath $staging -Recurse -File |
    ForEach-Object {
        $relative = $_.FullName.Substring($staging.Length).TrimStart('\\')
        Write-Host "    $relative" -ForegroundColor DarkGray
    }

# Step 3: Build MSI with WiX. All bind variables are absolute paths.
Write-Host "`n[3/4] Building MSI installer..." -ForegroundColor Cyan
$msiOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.msi"

Write-Host "  Restoring WiX UI extension..." -ForegroundColor Gray
Invoke-Wix -Arguments @("extension", "add", "-g", "WixToolset.UI.wixext/4.0.5")

$msiArgs = @(
    "build",
    $MsiSource,
    "-o", $msiOutput,
    "-d", "Version=$Version",
    "-d", "SharedBinDir=$sharedDst",
    "-d", "WordBinDir=$wordDst",
    "-d", "ExcelBinDir=$excelDst",
    "-d", "PowerPointBinDir=$pptDst",
    "-ext", "WixToolset.UI.wixext"
)

Write-Host "  SharedBinDir: $sharedDst" -ForegroundColor Gray
Write-Host "  WordBinDir: $wordDst" -ForegroundColor Gray
Write-Host "  ExcelBinDir: $excelDst" -ForegroundColor Gray
Write-Host "  PowerPointBinDir: $pptDst" -ForegroundColor Gray
Invoke-Wix -Arguments $msiArgs
Assert-PathExists -Path $msiOutput -Description "MSI output"

# Step 4: Build Bundle (Bootstrapper).
Write-Host "`n[4/4] Building Bootstrapper..." -ForegroundColor Cyan
$bundleOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.exe"

Write-Host "  Restoring WiX Bal extension..." -ForegroundColor Gray
Invoke-Wix -Arguments @("extension", "add", "-g", "WixToolset.Bal.wixext/4.0.5")

$netFx48Url = "https://go.microsoft.com/fwlink/?LinkId=2085329"
$vstoRuntimeUrl = "https://go.microsoft.com/fwlink/?LinkId=261103"

$bundleArgs = @(
    "build",
    $BundleSource,
    "-o", $bundleOutput,
    "-d", "Version=$Version",
    "-d", "NetFx48Url=$netFx48Url",
    "-d", "VstoRuntimeUrl=$vstoRuntimeUrl",
    "-d", "MsiDir=$OutputDir",
    "-ext", "WixToolset.Bal.wixext"
)

Invoke-Wix -Arguments $bundleArgs
Assert-PathExists -Path $bundleOutput -Description "Bootstrapper output"

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "MSI: $msiOutput" -ForegroundColor Yellow
Write-Host "Bootstrapper: $bundleOutput" -ForegroundColor Yellow
