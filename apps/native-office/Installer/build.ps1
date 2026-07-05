# Build script for LaTeXSnipper Native Office installer
# Run from: apps/native-office/Installer/

param(
    [string]$Configuration = "Release",
    [string]$OutputDir = ".\output"
)

$ErrorActionPreference = "Stop"
$SolutionDir = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $SolutionDir "bin"

Write-Host "=== LaTeXSnipper Native Office Installer Build ===" -ForegroundColor Green
Write-Host "Configuration: $Configuration" -ForegroundColor Yellow

# Step 1: Build solution
Write-Host "`n[1/4] Building solution..." -ForegroundColor Cyan
dotnet build "$SolutionDir\LaTeXSnipper.NativeOffice.sln" -c $Configuration
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# Step 2: Collect binaries
Write-Host "`n[2/4] Collecting binaries..." -ForegroundColor Cyan
$staging = Join-Path $OutputDir "staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$framework = "net48"

# Shared
$sharedSrc = Join-Path $BinDir "Shared\$Configuration\$framework"
$sharedDst = Join-Path $staging "Shared"
Copy-Item "$sharedSrc\*" $sharedDst -Recurse -Force

# Word
$wordSrc = Join-Path $BinDir "WordAddin\$Configuration\$framework"
$wordDst = Join-Path $staging "Word"
Copy-Item "$wordSrc\*" $wordDst -Recurse -Force

# Excel
$excelSrc = Join-Path $BinDir "ExcelAddin\$Configuration\$framework"
$excelDst = Join-Path $staging "Excel"
Copy-Item "$excelSrc\*" $excelDst -Recurse -Force

# PowerPoint
$pptSrc = Join-Path $BinDir "PowerPointAddin\$Configuration\$framework"
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
$env:IconsDir = Join-Path $PSScriptRoot "icons"

# Build MSI
wix build "$wixSrc\LaTeXSnipper.NativeOffice.wxs" `
    -o $msiOutput `
    -d SharedBinDir=$env:SharedBinDir `
    -d WordBinDir=$env:WordBinDir `
    -d ExcelBinDir=$env:ExcelBinDir `
    -d PowerPointBinDir=$env:PowerPointBinDir `
    -d IconsDir=$env:IconsDir

if ($LASTEXITCODE -ne 0) { throw "WiX build failed" }

# Step 4: Build Bundle (Bootstrapper)
Write-Host "`n[4/4] Building Bootstrapper..." -ForegroundColor Cyan
$bundleOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.exe"

$env:NetFx48Url = "https://go.microsoft.com/fwlink/?LinkId=2085329"
$env:VstoRuntimeUrl = "https://go.microsoft.com/fwlink/?LinkId=261103"
$env:MsiDir = $OutputDir

wix build "$wixSrc\Bundle.wxs" `
    -o $bundleOutput `
    -d NetFx48Url=$env:NetFx48Url `
    -d VstoRuntimeUrl=$env:VstoRuntimeUrl `
    -d MsiDir=$env:MsiDir

if ($LASTEXITCODE -ne 0) { throw "Bundle build failed" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "MSI: $msiOutput" -ForegroundColor Yellow
Write-Host "Bootstrapper: $bundleOutput" -ForegroundColor Yellow
