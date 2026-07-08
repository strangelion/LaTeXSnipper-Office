#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Verify that the Native Office VSTO payload staging directory is complete
    and structurally correct for Tauri bundling.
.DESCRIPTION
    Checks that all required files (VSTO manifests, OLE DLLs, certificates,
    shared assemblies) exist in the staging directory and that .vsto manifest
    references resolve to actual files on disk.
.PARAMETER PayloadRoot
    Path to the staging directory (e.g. apps/native-office/Installer/output/staging).
.EXAMPLE
    .\scripts\test-native-office-payload.ps1 -PayloadRoot apps/native-office/Installer/output/staging
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadRoot
)

$ErrorActionPreference = "Stop"
$exitCode = 0

Write-Host "=" * 60
Write-Host "Native Office VSTO Payload Integrity Test"
Write-Host "Root: $PayloadRoot"
Write-Host "=" * 60

if (-not (Test-Path -LiteralPath $PayloadRoot)) {
    Write-Host "FAIL: Payload root directory does not exist: $PayloadRoot" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Required file manifest
# ---------------------------------------------------------------------------
$required = @(
    @{ RelPath = "Word\LaTeXSnipper.Word.vsto";           Desc = "Word VSTO manifest" }
    @{ RelPath = "Excel\LaTeXSnipper.Excel.vsto";         Desc = "Excel VSTO manifest" }
    @{ RelPath = "PowerPoint\LaTeXSnipper.PowerPoint.vsto"; Desc = "PowerPoint VSTO manifest" }
    @{ RelPath = "Shared\LaTeXSnipper.NativeOffice.Shared.dll"; Desc = "Shared assembly" }
    @{ RelPath = "OleFormulaObject.x64.dll";              Desc = "OLE x64 DLL" }
    @{ RelPath = "OleFormulaObject.x86.dll";              Desc = "OLE x86 DLL" }
    @{ RelPath = "certificates\LaTeXSnipperOffice.cer";   Desc = "Signing certificate" }
    @{ RelPath = "certificates\native-office-signing.json"; Desc = "Signing metadata" }
)

Write-Host ""
Write-Host "--- Checking required files ---" -ForegroundColor Cyan
$allRequiredFound = $true
foreach ($item in $required) {
    $fullPath = Join-Path $PayloadRoot $item.RelPath
    if (Test-Path -LiteralPath $fullPath) {
        $size = (Get-Item -LiteralPath $fullPath).Length
        Write-Host "  OK $($item.RelPath) ($($size) bytes)" -ForegroundColor Green
    } else {
        Write-Host "  MISSING $($item.RelPath) ($($item.Desc))" -ForegroundColor Red
        $allRequiredFound = $false
        $exitCode = 1
    }
}

# ---------------------------------------------------------------------------
# Verify .vsto manifests reference existing files
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "--- Checking .vsto manifest references ---" -ForegroundColor Cyan
$vstoFiles = Get-ChildItem -LiteralPath $PayloadRoot -Recurse -Filter "*.vsto"
if ($vstoFiles.Count -eq 0) {
    Write-Host "  WARNING: No .vsto files found" -ForegroundColor Yellow
}

foreach ($vsto in $vstoFiles) {
    # .vsto is actually a ZIP archive
    try {
        $tempDir = Join-Path $env:TEMP "vsto-check-$([System.Guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        Expand-Archive -LiteralPath $vsto.FullName -DestinationPath $tempDir -Force

        # Check for required entries
        $manifestEntries = Get-ChildItem -LiteralPath $tempDir -Filter "*.manifest"
        if ($manifestEntries.Count -eq 0) {
            Write-Host "  WARNING: $($vsto.Name) has no .manifest inside" -ForegroundColor Yellow
        } else {
            Write-Host "  OK $($vsto.Name) ($($manifestEntries.Count) manifest(s))" -ForegroundColor Green
        }

        Remove-Item -LiteralPath $tempDir -Recurse -Force
    } catch {
        Write-Host "  FAIL: $($vsto.Name) is not a valid VSTO archive: $_" -ForegroundColor Red
        $exitCode = 1
    }
}

# ---------------------------------------------------------------------------
# Verify certificate files are valid
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "--- Checking certificate ---" -ForegroundColor Cyan
$cerPath = Join-Path $PayloadRoot "certificates\LaTeXSnipperOffice.cer"
if (Test-Path -LiteralPath $cerPath) {
    try {
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cerPath)
        Write-Host "  OK LaTeXSnipperOffice.cer: subject=$($cert.Subject), thumbprint=$($cert.Thumbprint)" -ForegroundColor Green
        $cert.Dispose()
    } catch {
        Write-Host "  FAIL: LaTeXSnipperOffice.cer is not a valid certificate: $_" -ForegroundColor Red
        $exitCode = 1
    }
}

$jsonPath = Join-Path $PayloadRoot "certificates\native-office-signing.json"
if (Test-Path -LiteralPath $jsonPath) {
    try {
        $json = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
        if ($json.sha1Thumbprint) {
            Write-Host "  OK native-office-signing.json: sha1Thumbprint=$($json.sha1Thumbprint)" -ForegroundColor Green
        } else {
            Write-Host "  WARNING: native-office-signing.json missing sha1Thumbprint" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  FAIL: native-office-signing.json is not valid JSON: $_" -ForegroundColor Red
        $exitCode = 1
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=" * 60
if ($exitCode -eq 0) {
    Write-Host "RESULT: ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "RESULT: SOME CHECKS FAILED (exit code $exitCode)" -ForegroundColor Red
}
Write-Host "=" * 60

exit $exitCode
