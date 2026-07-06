# Build script for LaTeXSnipper Native Office installer
# Run from: apps/native-office/Installer/

param(
    [string]$Configuration = "Release",
    [string]$OutputDir = ".\output",
    [string]$MsBuildPath = "",
    [string]$Version = "1.0.0",
    [switch]$SkipSigning
)

$ErrorActionPreference = "Stop"
$SolutionDir = Split-Path -Parent $PSScriptRoot

Write-Host "=== LaTeXSnipper Native Office Installer Build ===" -ForegroundColor Green
Write-Host "Configuration: $Configuration" -ForegroundColor Yellow

# Step 1: Build solution
Write-Host "`n[1/4] Building solution..." -ForegroundColor Cyan
if (-not $MsBuildPath) {
    # Try PATH first (e.g., GitHub Actions with setup-msbuild)
    $msbuild = Get-Command "MSBuild.exe" -ErrorAction SilentlyContinue
    if ($msbuild) {
        $MsBuildPath = $msbuild.Source
    } else {
        # Fallback to local dev machine path
        $MsBuildPath = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
    }
}
Write-Host "  MSBuild: $MsBuildPath" -ForegroundColor Gray
$buildArgs = @(
    "$SolutionDir\LaTeXSnipper.NativeOffice.sln"
    "/t:Build"
    "/p:Configuration=$Configuration"
    "/p:Platform=Any CPU"
    "/v:minimal"
)
if ($SkipSigning) {
    $buildArgs += "/p:SignManifests=false"
    $buildArgs += "/p:AssemblyOriginatorKeyFile="
    Write-Host "  Signing: DISABLED (SkipSigning)" -ForegroundColor Yellow
}
# Use pre-generated Office interop assemblies instead of COM references
# Must be separate from array splatting — semicolons confuse MSBuild arg parsing
$defineConstants = "/p:DefineConstants=VSTO40;useofficeinterop;TRACE"
& $MsBuildPath @buildArgs $defineConstants
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# Step 2: Collect binaries
Write-Host "`n[2/4] Collecting binaries..." -ForegroundColor Cyan
$staging = Join-Path $OutputDir "staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# Each project builds to its own bin\{Configuration} directory
$sharedSrc = Join-Path $SolutionDir "LaTeXSnipper.Shared\bin\$Configuration"
$sharedDst = Join-Path $staging "Shared"
Copy-Item "$sharedSrc\*" $sharedDst -Recurse -Force

$wordSrc = Join-Path $SolutionDir "LaTeXSnipper.Word\bin\$Configuration"
$wordDst = Join-Path $staging "Word"
Copy-Item "$wordSrc\*" $wordDst -Recurse -Force

$excelSrc = Join-Path $SolutionDir "LaTeXSnipper.Excel\bin\$Configuration"
$excelDst = Join-Path $staging "Excel"
Copy-Item "$excelSrc\*" $excelDst -Recurse -Force

$pptSrc = Join-Path $SolutionDir "LaTeXSnipper.PowerPoint\bin\$Configuration"
$pptDst = Join-Path $staging "PowerPoint"
Copy-Item "$pptSrc\*" $pptDst -Recurse -Force

Write-Host "  Staged files:" -ForegroundColor Gray
Get-ChildItem $staging -Recurse -File | ForEach-Object { Write-Host "    $($_.FullName.Replace($staging, ''))" -ForegroundColor Gray }

# Step 3: Build MSI with WiX
Write-Host "`n[3/4] Building MSI installer..." -ForegroundColor Cyan
$wixSrc = Join-Path $PSScriptRoot "WiX"
$msiOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.msi"

# Set WiX variables
$env:SharedBinDir = Join-Path $staging "Shared"
$env:WordBinDir = Join-Path $staging "Word"
$env:ExcelBinDir = Join-Path $staging "Excel"
$env:PowerPointBinDir = Join-Path $staging "PowerPoint"

# Build MSI
wix build "$wixSrc\LaTeXSnipper.NativeOffice.wxs" `
    -o $msiOutput `
    -d Version=$Version `
    -d SharedBinDir=$env:SharedBinDir `
    -d WordBinDir=$env:WordBinDir `
    -d ExcelBinDir=$env:ExcelBinDir `
    -d PowerPointBinDir=$env:PowerPointBinDir

if ($LASTEXITCODE -ne 0) { throw "WiX build failed" }

# Step 4: Build Bundle (Bootstrapper)
Write-Host "`n[4/4] Building Bootstrapper..." -ForegroundColor Cyan
$bundleOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.exe"

# Install WiX Bal extension if not present
$balExt = wix extension list 2>$null
if ($balExt -notmatch "WixToolset.Bal.wixext") {
    Write-Host "  Installing WiX Bal extension..." -ForegroundColor Gray
    wix extension add WixToolset.Bal.wixext
}

$env:NetFx48Url = "https://go.microsoft.com/fwlink/?LinkId=2085329"
$env:VstoRuntimeUrl = "https://go.microsoft.com/fwlink/?LinkId=261103"
$env:MsiDir = $OutputDir

wix build "$wixSrc\Bundle.wxs" `
    -o $bundleOutput `
    -d Version=$Version `
    -d NetFx48Url=$env:NetFx48Url `
    -d VstoRuntimeUrl=$env:VstoRuntimeUrl `
    -d MsiDir=$env:MsiDir

if ($LASTEXITCODE -ne 0) { throw "Bundle build failed" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "MSI: $msiOutput" -ForegroundColor Yellow
Write-Host "Bootstrapper: $bundleOutput" -ForegroundColor Yellow
