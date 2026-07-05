# Migration script for old LaTeXSnipper Office plugins
# Detects old Office.js WEF registration and COM/VSTO registration

param(
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "=== LaTeXSnipper Native Office Migration ===" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

$oldPlugins = @()

# Check for Office.js WEF registration
Write-Host "`n[1/3] Checking Office.js WEF registration..." -ForegroundColor Cyan
$wefKey = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
if (Test-Path $wefKey) {
    $wefProps = Get-ItemProperty -Path $wefKey -ErrorAction SilentlyContinue
    if ($wefProps) {
        foreach ($prop in $wefProps.PSObject.Properties) {
            if ($prop.Value -like "*LaTeXSnipper*") {
                $oldPlugins += @{
                    Type = "Office.js WEF"
                    Key = $wefKey
                    Property = $prop.Name
                    Value = $prop.Value
                }
                Write-Host "  Found: $($prop.Name) = $($prop.Value)" -ForegroundColor Yellow
            }
        }
    }
}

# Check for old COM/VSTO registration (LaTeXSnipperOffice)
Write-Host "`n[2/3] Checking COM/VSTO registration..." -ForegroundColor Cyan
$comKeys = @(
    "HKCU:\Software\Classes\CLSID\{71CE99BB-D608-45D7-B837-ABDE82B9B61A}",
    "HKCU:\Software\Microsoft\Office\Word\Addins\LaTeXSnipperOffice",
    "HKCU:\Software\Microsoft\Office\Excel\Addins\LaTeXSnipperOffice",
    "HKCU:\Software\Microsoft\Office\PowerPoint\Addins\LaTeXSnipperOffice"
)

foreach ($key in $comKeys) {
    if (Test-Path $key) {
        $oldPlugins += @{
            Type = "COM/VSTO"
            Key = $key
        }
        Write-Host "  Found: $key" -ForegroundColor Yellow
    }
}

# Check for old OfficePlugin DLL
Write-Host "`n[3/3] Checking for old DLL files..." -ForegroundColor Cyan
$appData = Join-Path $env:LOCALAPPDATA "LaTeXSnipper"
$oldDlls = @(
    (Join-Path $appData "LaTeXSnipper.OfficePlugin.dll"),
    (Join-Path $appData "OfficePlugin\LaTeXSnipper.OfficePlugin.dll")
)

foreach ($dll in $oldDlls) {
    if (Test-Path $dll) {
        $oldPlugins += @{
            Type = "DLL"
            Path = $dll
        }
        Write-Host "  Found: $dll" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

if ($oldPlugins.Count -eq 0) {
    Write-Host "`nNo old plugins found. Nothing to migrate." -ForegroundColor Green
    exit 0
}

Write-Host "`n=== Migration Summary ===" -ForegroundColor Cyan
Write-Host "Found $($oldPlugins.Count) old plugin(s):" -ForegroundColor Yellow

foreach ($plugin in $oldPlugins) {
    Write-Host "  - $($plugin.Type): $($plugin.Key ?? $plugin.Path)" -ForegroundColor Gray
}

if ($DryRun) {
    Write-Host "`n[DRY RUN] No changes made." -ForegroundColor Yellow
    exit 0
}

if (-not $Force) {
    $confirm = Read-Host "`nProceed with migration? (y/N)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Migration cancelled." -ForegroundColor Red
        exit 0
    }
}

# Perform migration
Write-Host "`nMigrating..." -ForegroundColor Cyan

# Remove Office.js WEF registrations
foreach ($plugin in $oldPlugins | Where-Object { $_.Type -eq "Office.js WEF" }) {
    try {
        Remove-ItemProperty -Path $plugin.Key -Name $plugin.Property -Force
        Write-Host "  Removed WEF property: $($plugin.Property)" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to remove: $($plugin.Property)" -ForegroundColor Red
    }
}

# Remove COM/VSTO registrations
foreach ($plugin in $oldPlugins | Where-Object { $_.Type -eq "COM/VSTO" }) {
    try {
        Remove-Item -Path $plugin.Key -Recurse -Force
        Write-Host "  Removed registry key: $($plugin.Key)" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to remove: $($plugin.Key)" -ForegroundColor Red
    }
}

# Move old DLLs to backup
foreach ($plugin in $oldPlugins | Where-Object { $_.Type -eq "DLL" }) {
    try {
        $backupPath = "$($plugin.Path).bak.$(Get-Date -Format 'yyyyMMdd')"
        Move-Item -Path $plugin.Path -Destination $backupPath -Force
        Write-Host "  Backed up DLL: $backupPath" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to backup: $($plugin.Path)" -ForegroundColor Red
    }
}

Write-Host "`n=== Migration Complete ===" -ForegroundColor Green
Write-Host "Please restart Word, Excel, and PowerPoint." -ForegroundColor Yellow
Write-Host "The new LaTeXSnipper Native Office VSTO add-in will be loaded on next launch." -ForegroundColor Yellow
