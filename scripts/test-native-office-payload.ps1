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
    [string]$PayloadRoot,
    [string]$ExpectedSourceCommit = ""
)

$ErrorActionPreference = "Stop"
$exitCode = 0

Write-Host ("=" * 60)
Write-Host "Native Office VSTO Payload Integrity Test"
Write-Host "Root: $PayloadRoot"
Write-Host ("=" * 60)

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
    @{ RelPath = "Visio\LaTeXSnipper.Visio.vsto";         Desc = "Visio VSTO manifest" }
    @{ RelPath = "Shared\LaTeXSnipper.NativeOffice.Shared.dll"; Desc = "Shared assembly" }
    @{ RelPath = "OleFormulaObject.x64.dll";              Desc = "OLE x64 DLL" }
    @{ RelPath = "OleFormulaObject.x86.dll";              Desc = "OLE x86 DLL" }
    @{ RelPath = "certificates\LaTeXSnipperOffice.cer";   Desc = "Signing certificate" }
    @{ RelPath = "certificates\native-office-signing.json"; Desc = "Signing metadata" }
    @{ RelPath = "build-provenance.json";              Desc = "Build provenance" }
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
    try {
        [xml]$deployment = Get-Content -LiteralPath $vsto.FullName -Raw
        $dependencies = $deployment.SelectNodes("//*[local-name()='dependentAssembly' and @codebase]")
        if ($null -eq $dependencies -or $dependencies.Count -eq 0) {
            Write-Host "  FAIL: $($vsto.Name) has no dependentAssembly codebase entries" -ForegroundColor Red
            $exitCode = 1
            continue
        }

        $baseDir = Split-Path -Parent $vsto.FullName
        foreach ($dependency in $dependencies) {
            $codebase = $dependency.GetAttribute("codebase")
            if ([string]::IsNullOrWhiteSpace($codebase)) {
                continue
            }
            $targetPath = Join-Path $baseDir $codebase
            if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
                Write-Host "  FAIL: $($vsto.Name) references missing file: $codebase" -ForegroundColor Red
                $exitCode = 1
            } else {
                Write-Host "  OK $($vsto.Name) references $codebase" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "  FAIL: $($vsto.Name) is not a valid XML VSTO manifest: $_" -ForegroundColor Red
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
# Verify commit binding and exact staged payload hashes
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "--- Checking build provenance ---" -ForegroundColor Cyan
$provenancePath = Join-Path $PayloadRoot "build-provenance.json"
if (Test-Path -LiteralPath $provenancePath -PathType Leaf) {
    try {
        $provenance = Get-Content -Raw -LiteralPath $provenancePath | ConvertFrom-Json
        if ($provenance.schemaVersion -ne 1 -or
            [string]::IsNullOrWhiteSpace([string]$provenance.sourceCommitSha) -or
            [string]::IsNullOrWhiteSpace([string]$provenance.coreCommitSha)) {
            throw "Required provenance fields are missing."
        }
        if ($ExpectedSourceCommit -and
            [string]$provenance.sourceCommitSha -ne $ExpectedSourceCommit.ToLowerInvariant()) {
            throw "Source commit mismatch: expected=$ExpectedSourceCommit actual=$($provenance.sourceCommitSha)"
        }
        $hashEntries = @($provenance.payloadHashes.PSObject.Properties)
        if ($hashEntries.Count -eq 0) {
            throw "Payload hash ledger is empty."
        }
        foreach ($entry in $hashEntries) {
            $relative = [string]$entry.Name
            if ($relative -notmatch '^[^\\/:*?"<>|]+(?:/[^\\/:*?"<>|]+)*$' -or
                $relative -match '(^|/)\.\.?(?:/|$)') {
                throw "Unsafe provenance path: $relative"
            }
            $file = Join-Path $PayloadRoot ($relative -replace '/', [System.IO.Path]::DirectorySeparatorChar)
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
                throw "Provenance payload file is missing: $relative"
            }
            $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne [string]$entry.Value) {
                throw "Provenance hash mismatch: $relative expected=$($entry.Value) actual=$actual"
            }
        }
        Write-Host "  OK source=$($provenance.sourceCommitSha) core=$($provenance.coreCommitSha) files=$($hashEntries.Count)" -ForegroundColor Green
    } catch {
        Write-Host "  FAIL: build provenance is invalid: $_" -ForegroundColor Red
        $exitCode = 1
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host ("=" * 60)
if ($exitCode -eq 0) {
    Write-Host "RESULT: ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "RESULT: SOME CHECKS FAILED (exit code $exitCode)" -ForegroundColor Red
}
Write-Host ("=" * 60)

exit $exitCode
