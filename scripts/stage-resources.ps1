# scripts/stage-resources.ps1
# Copy WPS plugin, NativeOffice VSTO, and Obsidian plugin to Tauri resources.
# Run before `tauri build` to ensure all platform add-ins are included in the installer.

param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Continue"
$resourcesDir = Join-Path $ProjectRoot "src-tauri" "resources"

Write-Host "=== Staging resources for Tauri bundle ===" -ForegroundColor Green
Write-Host "  Project root: $ProjectRoot"
Write-Host "  Resources: $resourcesDir"

# --- WPS JSAddin ---
$wpsSource = Join-Path $ProjectRoot "apps" "wps" "installer"
$wpsDest = Join-Path $resourcesDir "WPS"
try {
    if (Test-Path $wpsSource) {
        if (Test-Path $wpsDest) { Remove-Item $wpsDest -Recurse -Force -ErrorAction SilentlyContinue }
        Copy-Item $wpsSource $wpsDest -Recurse -Force
        $fileCount = (Get-ChildItem $wpsDest -Recurse -File).Count
        Write-Host "  WPS: $fileCount files staged" -ForegroundColor Green
    } else {
        Write-Host "  WPS source not found at $wpsSource — creating placeholder" -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $wpsDest -Force | Out-Null
        Set-Content -Path (Join-Path $wpsDest "placeholder.txt") -Value "WPS plugin not available"
    }
} catch {
    Write-Host "  WPS staging failed: $_" -ForegroundColor Yellow
}

# --- NativeOffice VSTO ---
$vstoStaging = Join-Path $ProjectRoot "apps" "native-office" "Installer" "output" "staging"
$vstoDest = Join-Path $resourcesDir "NativeOffice"
try {
    if (Test-Path $vstoStaging) {
        $stagingFiles = Get-ChildItem $vstoStaging -Recurse -File
        if ($stagingFiles.Count -gt 0) {
            if (Test-Path $vstoDest) { Remove-Item $vstoDest -Recurse -Force -ErrorAction SilentlyContinue }
            Copy-Item $vstoStaging $vstoDest -Recurse -Force
            Write-Host "  NativeOffice: $($stagingFiles.Count) files staged" -ForegroundColor Green
        } else {
            Write-Host "  NativeOffice staging is empty — creating placeholder" -ForegroundColor Yellow
            New-Item -ItemType Directory -Path $vstoDest -Force | Out-Null
            Set-Content -Path (Join-Path $vstoDest "placeholder.txt") -Value "VSTO not available"
        }
    } else {
        Write-Host "  NativeOffice staging not found — creating placeholder" -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $vstoDest -Force | Out-Null
        Set-Content -Path (Join-Path $vstoDest "placeholder.txt") -Value "VSTO not available"
    }
} catch {
    Write-Host "  NativeOffice staging failed: $_" -ForegroundColor Yellow
}

# --- Obsidian Plugin ---
$obsidianSource = Join-Path $ProjectRoot "apps" "obsidian-plugin"
$obsidianDest = Join-Path $resourcesDir "Obsidian"
try {
    New-Item -ItemType Directory -Path $obsidianDest -Force | Out-Null
    $found = $false
    foreach ($file in @("main.js", "manifest.json", "styles.css")) {
        $src = Join-Path $obsidianSource $file
        if (Test-Path $src) {
            Copy-Item $src $obsidianDest -Force
            $found = $true
        }
    }
    if ($found) {
        $fileCount = (Get-ChildItem $obsidianDest -Recurse -File).Count
        Write-Host "  Obsidian: $fileCount files staged" -ForegroundColor Green
    } else {
        Write-Host "  Obsidian plugin not built yet — creating placeholder" -ForegroundColor Yellow
        Set-Content -Path (Join-Path $obsidianDest "placeholder.txt") -Value "Obsidian plugin not built"
    }
} catch {
    Write-Host "  Obsidian staging failed: $_" -ForegroundColor Yellow
}

Write-Host "=== Resource staging complete ===" -ForegroundColor Green

# Verify all resource dirs exist (required by Tauri glob patterns)
foreach ($dir in @("OfficeJS", "WPS", "NativeOffice", "Obsidian")) {
    $path = Join-Path $resourcesDir $dir
    if (-not (Test-Path $path)) {
        Write-Host "  Creating missing dir: $dir" -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Set-Content -Path (Join-Path $path "placeholder.txt") -Value "$dir not available"
    }
    $count = (Get-ChildItem $path -Recurse -File).Count
    Write-Host "  $dir : $count files" -ForegroundColor Gray
}
