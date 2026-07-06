# scripts/stage-resources.ps1
# Copy WPS plugin and NativeOffice VSTO files to Tauri resources for bundling.
# Run before `tauri build` to ensure all platform add-ins are included in the installer.

param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$resourcesDir = Join-Path $ProjectRoot "src-tauri\resources"

Write-Host "=== Staging resources for Tauri bundle ===" -ForegroundColor Green

# --- WPS JSAddin ---
$wpsSource = Join-Path $ProjectRoot "apps\wps\installer"
$wpsDest = Join-Path $resourcesDir "WPS"
if (Test-Path $wpsSource) {
    if (Test-Path $wpsDest) { Remove-Item $wpsDest -Recurse -Force }
    Copy-Item $wpsSource $wpsDest -Recurse -Force
    $fileCount = (Get-ChildItem $wpsDest -Recurse -File).Count
    Write-Host "  WPS: $fileCount files staged" -ForegroundColor Green
} else {
    Write-Warning "  WPS source not found at $wpsSource — skipping"
}

# --- NativeOffice VSTO ---
$vstoStaging = Join-Path $ProjectRoot "apps\native-office\Installer\output\staging"
$vstoDest = Join-Path $resourcesDir "NativeOffice"
if (Test-Path $vstoStaging) {
    if (Test-Path $vstoDest) { Remove-Item $vstoDest -Recurse -Force }
    Copy-Item $vstoStaging $vstoDest -Recurse -Force
    $fileCount = (Get-ChildItem $vstoDest -Recurse -File).Count
    Write-Host "  NativeOffice: $fileCount files staged" -ForegroundColor Green
} else {
    Write-Warning "  NativeOffice staging not found at $vstoStaging — skipping (run build.ps1 first)"
}

# --- Obsidian Plugin ---
$obsidianSource = Join-Path $ProjectRoot "apps\obsidian-plugin"
$obsidianDest = Join-Path $resourcesDir "Obsidian"
if ((Test-Path "$obsidianSource\main.js") -and (Test-Path "$obsidianSource\manifest.json")) {
    if (Test-Path $obsidianDest) { Remove-Item $obsidianDest -Recurse -Force }
    New-Item -ItemType Directory -Path $obsidianDest -Force | Out-Null
    Copy-Item "$obsidianSource\main.js" $obsidianDest
    Copy-Item "$obsidianSource\manifest.json" $obsidianDest
    if (Test-Path "$obsidianSource\styles.css") { Copy-Item "$obsidianSource\styles.css" $obsidianDest }
    $fileCount = (Get-ChildItem $obsidianDest -Recurse -File).Count
    Write-Host "  Obsidian: $fileCount files staged" -ForegroundColor Green
} else {
    Write-Warning "  Obsidian plugin not found at $obsidianSource — skipping (build apps/obsidian-plugin first)"
}

Write-Host "=== Resource staging complete ===" -ForegroundColor Green
