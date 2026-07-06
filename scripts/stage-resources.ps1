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

Write-Host "=== Resource staging complete ===" -ForegroundColor Green
