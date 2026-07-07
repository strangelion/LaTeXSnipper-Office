# scripts/stage-resources.ps1
# Copy platform add-ins to Tauri resources and fail when required payloads are missing.

param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
function Join-PathParts {
    param([Parameter(Mandatory = $true)][string[]]$Parts)
    $path = $Parts[0]
    for ($i = 1; $i -lt $Parts.Count; $i++) {
        $path = Join-Path $path $Parts[$i]
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
New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null

# Office.js is produced by scripts/stage-office-addin.mjs before this script runs.
$officeJsDir = Join-Path $resourcesDir "OfficeJS"
Require-Dir (Join-Path $officeJsDir "site") "Office.js site directory"
Require-Dir (Join-Path $officeJsDir "manifest") "Office.js manifest directory"
Require-File (Join-PathParts @($officeJsDir, "site", "taskpane.html")) "Office.js taskpane"
foreach ($officeHost in @("word", "excel", "powerpoint")) {
    Require-File (Join-PathParts @($officeJsDir, "manifest", "$officeHost.xml")) "Office.js $officeHost manifest"
}
Write-Host "  OfficeJS: ready" -ForegroundColor Green

# WPS JSAddin. Prefer the built package because it includes proxy/server files.
$wpsBuild = Get-LatestWpsBuild
if (-not $wpsBuild) {
    throw "WPS build output missing. Run npm run build:wps before packaging."
}
$wpsSource = $wpsBuild.FullName
$wpsDest = Join-Path $resourcesDir "WPS"
foreach ($file in @(
    "index.html",
    "main.js",
    "manifest.xml",
    "ribbon.xml",
    "proxy.js",
    "server.js",
    "js\command-layer.js",
    "js\ribbon.js",
    "js\util.js",
    "ui\taskpane.html"
)) {
    Require-File (Join-Path $wpsSource $file) "WPS payload"
}
Copy-CleanDir $wpsSource $wpsDest
$wpsCount = (Get-ChildItem -LiteralPath $wpsDest -Recurse -File).Count
Write-Host "  WPS: $wpsCount files staged from $wpsSource" -ForegroundColor Green

# NativeOffice VSTO.
$vstoStaging = Join-PathParts @($ProjectRoot, "apps", "native-office", "Installer", "output", "staging")
$vstoDest = Join-Path $resourcesDir "NativeOffice"
foreach ($nativeHost in @("Word", "Excel", "PowerPoint")) {
    Require-File (Join-Path $vstoStaging "$nativeHost\LaTeXSnipper.$nativeHost.vsto") "NativeOffice $nativeHost VSTO manifest"
    Require-File (Join-Path $vstoStaging "$nativeHost\LaTeXSnipper.$nativeHost.dll.manifest") "NativeOffice $nativeHost DLL manifest"
    Require-File (Join-Path $vstoStaging "$nativeHost\LaTeXSnipper.$nativeHost.dll") "NativeOffice $nativeHost DLL"
}
Require-Dir (Join-Path $vstoStaging "Shared") "NativeOffice shared directory"
Require-File (Join-Path $vstoStaging "Shared\LaTeXSnipper.NativeOffice.Shared.dll") "NativeOffice shared DLL"
Copy-CleanDir $vstoStaging $vstoDest
$nativeCount = (Get-ChildItem -LiteralPath $vstoDest -Recurse -File).Count
Write-Host "  NativeOffice: $nativeCount files staged" -ForegroundColor Green

# Obsidian is optional for Office packaging, but keep resources valid when it is built.
$obsidianSource = Join-PathParts @($ProjectRoot, "apps", "obsidian-plugin")
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
