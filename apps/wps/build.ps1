# Build script for LaTeXSnipper WPS Plugin
# Run from: apps/wps/
# Usage: .\build.ps1 [-Version "1.0.0"] [-OutputDir ".\dist"]

param(
    [string]$Version = "1.0.0",
    [string]$OutputDir = ".\dist"
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$PluginName = "LaTeXSnipper"
$FullVersion = "latexsnipper-wps_$Version"

Write-Host "=== LaTeXSnipper WPS Plugin Build ===" -ForegroundColor Green
Write-Host "Version: $Version" -ForegroundColor Yellow
Write-Host "Output: $OutputDir" -ForegroundColor Yellow

# Clean output
$DistDir = Join-Path $OutputDir $FullVersion
if (Test-Path $DistDir) { Remove-Item $DistDir -Recurse -Force }
$null = New-Item -ItemType Directory -Path $DistDir -Force

# Copy plugin files
Write-Host "`nCopying plugin files..." -ForegroundColor Cyan

$files = @(
    "index.html",
    "main.js",
    "manifest.xml",
    "manifest.json",
    "ribbon.xml",
    "package.json",
    "proxy.js",
    "server.js"
)

foreach ($file in $files) {
    Copy-Item (Join-Path $ScriptDir $file) (Join-Path $DistDir $file) -Force
    Write-Host "  $file" -ForegroundColor Gray
}

# Subdirectories
$subdirs = @(
    @{Src="js"; Files=@("command-layer.js", "ribbon.js", "util.js")},
    @{Src="ui"; Files=@("taskpane.html")},
    @{Src="images"; Files=(Get-ChildItem (Join-Path $ScriptDir "images") -Filter "*.svg" | Select-Object -ExpandProperty Name)}
)

foreach ($dir in $subdirs) {
    $dstDir = Join-Path $DistDir $dir.Src
    $null = New-Item -ItemType Directory -Path $dstDir -Force
    foreach ($file in $dir.Files) {
        $src = Join-Path (Join-Path $ScriptDir $dir.Src) $file
        if (Test-Path $src) {
            Copy-Item $src (Join-Path $dstDir $file) -Force
            Write-Host "  $($dir.Src)/$file" -ForegroundColor Gray
        }
    }
}

# Copy installer scripts (install.bat, uninstall.bat)
$installerFiles = @("install.bat", "uninstall.bat")
foreach ($file in $installerFiles) {
    $src = Join-Path (Join-Path $ScriptDir "installer") $file
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $DistDir $file) -Force
        Write-Host "  installer/$file" -ForegroundColor Gray
    }
}

# Create zip archive
Write-Host "`nCreating zip archive..." -ForegroundColor Cyan
$zipPath = Join-Path $OutputDir "$FullVersion.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$DistDir\*" -DestinationPath $zipPath

Write-Host "  $zipPath" -ForegroundColor Gray

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Plugin directory: $DistDir" -ForegroundColor Yellow
Write-Host "Zip archive: $zipPath" -ForegroundColor Yellow
