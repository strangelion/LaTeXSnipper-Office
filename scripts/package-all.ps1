# Package all LaTeXSnipper components into a unified release directory
# Run AFTER individual builds complete.
# Usage: .\package-all.ps1 -Version "3.0.0" -ArtifactsDir ".\artifacts" -OutputDir ".\dist"

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$ArtifactsDir,
    [string]$OutputDir = ".\dist"
)

$ErrorActionPreference = "Stop"
$OutputDir = Resolve-Path $OutputDir -ErrorAction SilentlyContinue
if (-not $OutputDir) { $OutputDir = Join-Path (Get-Location) "dist" }

Write-Host "=== LaTeXSnipper All-in-One Package ===" -ForegroundColor Green
Write-Host "Version: $Version" -ForegroundColor Yellow
Write-Host "Artifacts: $ArtifactsDir" -ForegroundColor Yellow
Write-Host "Output: $OutputDir" -ForegroundColor Yellow

# Create output structure
$releaseDir = Join-Path $OutputDir "LaTeXSnipper-$Version"
if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
$null = New-Item -ItemType Directory -Path $releaseDir -Force

# Collect artifacts from parallel builds
$found = @{}

# 1. Tauri Desktop (Windows)
$tauriWindows = @(
    "src-tauri/target/release/bundle/msi/*.msi",
    "src-tauri/target/release/bundle/nsis/*.exe"
)
foreach ($pattern in $tauriWindows) {
    $files = Get-ChildItem (Join-Path $ArtifactsDir $pattern) -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        Copy-Item $f.FullName (Join-Path $releaseDir "windows") -Force
        $found["tauri-windows"] = $true
    }
}

# 2. VSTO Native Office
$vstoFiles = Get-ChildItem (Join-Path $ArtifactsDir "native-office-Release") -Include "*.msi", "*.exe" -Recurse -ErrorAction SilentlyContinue
if (-not $vstoFiles) {
    # Try flat artifact name
    $vstoFiles = Get-ChildItem $ArtifactsDir -Include "*NativeOffice*" -Recurse -ErrorAction SilentlyContinue
}
foreach ($f in $vstoFiles) {
    $dst = Join-Path $releaseDir "windows" "vsto"
    $null = New-Item -ItemType Directory -Path $dst -Force
    Copy-Item $f.FullName $dst -Force
    $found["vsto"] = $true
}

# 3. WPS Plugin
$wpsZips = Get-ChildItem $ArtifactsDir -Include "latexsnipper-wps_*.zip" -Recurse -ErrorAction SilentlyContinue
foreach ($f in $wpsZips) {
    Copy-Item $f.FullName (Join-Path $releaseDir "plugins") -Force
    $found["wps"] = $true
}

# 4. Obsidian Plugin
$obsidianZips = Get-ChildItem $ArtifactsDir -Include "latexsnipper-obsidian_*.zip" -Recurse -ErrorAction SilentlyContinue
foreach ($f in $obsidianZips) {
    Copy-Item $f.FullName (Join-Path $releaseDir "plugins") -Force
    $found["obsidian"] = $true
}

# 5. Tauri Desktop (macOS)
$macFiles = Get-ChildItem (Join-Path $ArtifactsDir "macos") -Include "*.dmg", "*.app" -Recurse -ErrorAction SilentlyContinue
foreach ($f in $macFiles) {
    Copy-Item $f.FullName (Join-Path $releaseDir "macos") -Force
    $found["tauri-macos"] = $true
}

# 6. Tauri Desktop (Linux)
$linuxFiles = Get-ChildItem (Join-Path $ArtifactsDir "linux") -Include "*.deb", "*.rpm" -Recurse -ErrorAction SilentlyContinue
foreach ($f in $linuxFiles) {
    Copy-Item $f.FullName (Join-Path $releaseDir "linux") -Force
    $found["tauri-linux"] = $true
}

# Report collected artifacts
Write-Host "`nCollected artifacts:" -ForegroundColor Cyan
$found.Keys | Sort-Object | ForEach-Object { Write-Host "  [$_] $($found[$_])" -ForegroundColor Gray }

# Create README
$readmePath = Join-Path $releaseDir "README.txt"
@"
LaTeXSnipper Office v$Version — All-in-One Release
===================================================

Contents:
$(if ($found["tauri-windows"]) { "- windows/  — Desktop application (MSI/NSIS installer)" })
$(if ($found["vsto"]) { "- windows/vsto/ — Native Office VSTO add-in (Word/Excel/PowerPoint)" })
$(if ($found["wps"]) { "- plugins/ — WPS Office plugin (zip)" })
$(if ($found["obsidian"]) { "- plugins/ — Obsidian plugin (zip)" })
$(if ($found["tauri-macos"]) { "- macos/ — Desktop application for macOS (DMG)" })
$(if ($found["tauri-linux"]) { "- linux/ — Desktop application for Linux (DEB/RPM)" })

Installation:
- Windows: Run windows/LaTeXSnipper*.exe (or .msi) for desktop app.
           Run windows/vsto/LaTeXSnipper.NativeOffice.exe for VSTO add-in.
- macOS:   Open macos/*.dmg and drag to Applications.
- Linux:   Install the .deb or .rpm package.

Plugins:
- WPS:      Extract plugins/latexsnipper-wps_*.zip, run install.bat
- Obsidian: Extract plugins/latexsnipper-obsidian_*.zip to .obsidian/plugins/
"@ | Out-File -FilePath $readmePath -Encoding ASCII

Write-Host "`nRelease directory:" -ForegroundColor Cyan
Get-ChildItem $releaseDir -Recurse -File | ForEach-Object {
    Write-Host "  $($_.FullName.Replace($releaseDir, '')) ($(($_.Length / 1KB).ToString('F1')) KB)" -ForegroundColor Gray
}

Write-Host "`n=== Package Complete ===" -ForegroundColor Green
Write-Host "Release: $releaseDir" -ForegroundColor Yellow
