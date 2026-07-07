# Code signing script for LaTeXSnipper Native Office
# Requires: signtool.exe (from Windows SDK)
# Requires: Code signing certificate (EV recommended)

param(
    [string]$CertThumbprint,
    [string]$TimestampServer = "http://timestamp.digicert.com",
    [string]$OutputDir = ".\output"
)

$ErrorActionPreference = "Stop"

Write-Host "=== LaTeXSnipper Native Office Code Signing ===" -ForegroundColor Green

# Find signtool
$signtool = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
if (-not $signtool) {
    # Try Windows SDK path
    $sdkPaths = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe"
    )
    foreach ($path in $sdkPaths) {
        $found = Get-ChildItem $path -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $signtool = $found.FullName
            break
        }
    }
    if (-not $signtool) {
        throw "signtool.exe not found. Install Windows SDK."
    }
} else {
    $signtool = $signtool.Source
}

Write-Host "Using signtool: $signtool" -ForegroundColor Yellow

# Get certificate
if ($CertThumbprint) {
    $cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object { $_.Thumbprint -eq $CertThumbprint } | Select-Object -First 1
} else {
    # Use first available code signing certificate
    $cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert | Select-Object -First 1
}

if (-not $cert) {
    throw "No code signing certificate found. Specify -CertThumbprint or install a certificate."
}

Write-Host "Using certificate: $($cert.Subject)" -ForegroundColor Yellow

# Files to sign
$filesToSign = @(
    (Join-Path $OutputDir "LaTeXSnipper.NativeOffice.msi"),
    (Join-Path $OutputDir "LaTeXSnipper.NativeOffice.exe")
)

# Also sign DLLs in staging
$dlls = Get-ChildItem "$OutputDir\staging" -Recurse -Filter "*.dll" | ForEach-Object { $_.FullName }
$filesToSign += $dlls

foreach ($file in $filesToSign) {
    if (-not (Test-Path $file)) {
        Write-Host "  SKIP: $file (not found)" -ForegroundColor Gray
        continue
    }

    Write-Host "  Signing: $file" -ForegroundColor Cyan

    & $signtool sign `
        /fd SHA256 `
        /a `
        /sha1 $cert.Thumbprint `
        /tr $TimestampServer `
        /td SHA256 `
        /d "LaTeXSnipper Native Office" `
        $file

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  FAILED to sign: $file" -ForegroundColor Red
    } else {
        Write-Host "  OK" -ForegroundColor Green
    }
}

# Verify signatures
Write-Host "`nVerifying signatures..." -ForegroundColor Cyan
foreach ($file in $filesToSign) {
    if (-not (Test-Path $file)) { continue }

    & $signtool verify /pa /v $file 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  VERIFIED: $file" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: $file verification failed" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Signing Complete ===" -ForegroundColor Green
