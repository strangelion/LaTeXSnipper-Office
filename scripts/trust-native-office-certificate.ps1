<#
.SYNOPSIS
    Applies certificate trust for the Native Office VSTO signing certificate.

.DESCRIPTION
    The MSI deliberately does not write the current-user root store: WiX certificate
    actions that target that store block indefinitely when msiexec runs without an
    interactive desktop session (see the CertificateComponent comment in
    apps/native-office/Installer/WiX/LaTeXSnipper.NativeOffice.wxs).

    This script owns that trust instead:

      * the public certificate is added to the selected TrustedPublisher store;
      * it is additionally added to the selected Root store when native-office-signing.json
        reports selfSigned = true (a CA-issued release certificate relies on the
        operating system's normal root trust and is never copied there).

    CurrentUser root writes can still prompt even with certutil -f. Unattended
    CI must explicitly select -StoreLocation LocalMachine on its elevated,
    disposable runner. Each certutil child has a bounded wait and its result is
    verified in the selected store. Interactive use defaults to CurrentUser.

.PARAMETER CertificatePath
    Public .cer file exported by apps/native-office/Installer/build.ps1.

.PARAMETER SigningMetadataPath
    native-office-signing.json written next to the .cer file.

.PARAMETER StoreLocation
    Certificate store location to modify. Defaults to CurrentUser.

.PARAMETER NonInteractive
    Uses bounded certutil.exe writes. Self-signed roots require LocalMachine
    and an elevated process in this mode; CurrentUser root writes are refused.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$CertificatePath,
    [string]$SigningMetadataPath,
    [System.Security.Cryptography.X509Certificates.StoreLocation]$StoreLocation =
        [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser,
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'

if (-not $CertificatePath) {
    $CertificatePath = Join-Path $PSScriptRoot '..\apps\native-office\Installer\output\certificates\LaTeXSnipperOffice.cer'
}
if (-not $SigningMetadataPath) {
    $SigningMetadataPath = Join-Path (Split-Path -Parent $CertificatePath) 'native-office-signing.json'
}

$resolvedCertificate = (Resolve-Path -LiteralPath $CertificatePath).ProviderPath
$resolvedMetadata = (Resolve-Path -LiteralPath $SigningMetadataPath).ProviderPath

Write-Host "Trusting Native Office signing certificate: $resolvedCertificate" -ForegroundColor Cyan

$metadata = Get-Content -LiteralPath $resolvedMetadata -Raw | ConvertFrom-Json
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedCertificate)

if ($metadata.sha256Thumbprint) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $computed = ($sha256.ComputeHash($certificate.RawData) | ForEach-Object { $_.ToString('X2') }) -join ''
    }
    finally {
        $sha256.Dispose()
    }

    if ($computed -ne $metadata.sha256Thumbprint.ToUpperInvariant()) {
        throw "Certificate does not match native-office-signing.json: expected $($metadata.sha256Thumbprint), got $computed"
    }
    Write-Host "  SHA-256 verified: $computed" -ForegroundColor Gray
}
else {
    Write-Host "  native-office-signing.json has no sha256Thumbprint; skipping verification" -ForegroundColor Yellow
}

Write-Host "  Subject:  $($certificate.Subject)" -ForegroundColor Gray
Write-Host "  Thumbprint: $($certificate.Thumbprint)" -ForegroundColor Gray

$stores = @(
    [System.Security.Cryptography.X509Certificates.StoreName]::TrustedPublisher
)
if ([bool]$metadata.selfSigned) {
    Write-Host "  selfSigned = true -> $StoreLocation\Root trust is required for this certificate" -ForegroundColor Gray
    $stores += [System.Security.Cryptography.X509Certificates.StoreName]::Root
}
else {
    Write-Host "  selfSigned = false -> CA-issued certificate, root trust comes from the operating system" -ForegroundColor Gray
}

if ($NonInteractive -and [bool]$metadata.selfSigned -and
    $StoreLocation -eq [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser) {
    throw 'Unattended CurrentUser root import can require a confirmation dialog. Use -StoreLocation LocalMachine on an elevated disposable CI runner, or use interactive installation.'
}
if ($NonInteractive -and -not $WhatIfPreference -and
    $StoreLocation -eq [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine) {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
        if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'LocalMachine certificate trust requires an elevated process.'
        }
    }
    finally { $identity.Dispose() }
}

foreach ($storeName in $stores) {
    if ($NonInteractive) {
        if ($PSCmdlet.ShouldProcess("$StoreLocation\$storeName", 'Add signing certificate with certutil')) {
            $arguments = @('-f', '-addstore', $storeName.ToString(), ('"' + $resolvedCertificate + '"'))
            if ($StoreLocation -eq [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser) {
                $arguments = @('-user') + $arguments
            }
            $process = Start-Process -FilePath "$env:SystemRoot\System32\certutil.exe" -ArgumentList $arguments -WindowStyle Hidden -PassThru
            try {
                if (-not $process.WaitForExit(45000)) {
                    $process.Kill()
                    throw "certutil timed out after 45 seconds adding to $StoreLocation\$storeName"
                }
                if ($process.ExitCode -ne 0) {
                    throw "certutil failed to add to $StoreLocation\$storeName (exit code $($process.ExitCode))"
                }
            }
            finally { $process.Dispose() }
            $verificationStore = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, $StoreLocation)
            try {
                $verificationStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
                $matches = @($verificationStore.Certificates | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint })
                if ($matches.Count -eq 0) {
                    throw "Certificate import returned success but read-back failed in $StoreLocation\$storeName"
                }
            }
            finally { $verificationStore.Close() }
            Write-Host "  Trusted in $StoreLocation\$storeName" -ForegroundColor Green
        }
        continue
    }

    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, $StoreLocation)
    try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)

        $existing = @($store.Certificates | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint })
        if ($existing.Count -gt 0) {
            Write-Host "  Already trusted in $StoreLocation\$storeName" -ForegroundColor Gray
            continue
        }

        if ($PSCmdlet.ShouldProcess("$StoreLocation\$storeName", "Add signing certificate")) {
            $store.Add($certificate)
            Write-Host "  Trusted in $StoreLocation\$storeName" -ForegroundColor Green
        }
    }
    finally {
        $store.Close()
    }
}

if ($WhatIfPreference) {
    Write-Host "Native Office certificate trust preview complete; no certificate was added." -ForegroundColor Gray
}
else {
    Write-Host "Native Office certificate trust applied." -ForegroundColor Green
}
