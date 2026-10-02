<#
.SYNOPSIS
    Applies current-user certificate trust for the Native Office VSTO signing certificate.

.DESCRIPTION
    The MSI deliberately does not write the current-user root store: WiX certificate
    actions that target that store block indefinitely when msiexec runs without an
    interactive desktop session (see the CertificateComponent comment in
    apps/native-office/Installer/WiX/LaTeXSnipper.NativeOffice.wxs).

    This script owns that trust instead:

      * the public certificate is always added to CurrentUser\TrustedPublisher;
      * it is additionally added to CurrentUser\Root when native-office-signing.json
        reports selfSigned = true (a CA-issued release certificate relies on the
        operating system's normal root trust and is never copied there).

    The script is non-interactive: it uses X509Store.Add, which is equivalent to
    CertAddCertificateContextToStore and never raises a UI prompt, unlike the
    certificate-import cmdlet, which can prompt for the root store when no
    interactive session is available.

.PARAMETER CertificatePath
    Public .cer file exported by apps/native-office/Installer/build.ps1.

.PARAMETER SigningMetadataPath
    native-office-signing.json written next to the .cer file.

.PARAMETER StoreLocation
    Certificate store location to modify. Defaults to CurrentUser.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$CertificatePath,
    [string]$SigningMetadataPath,
    [System.Security.Cryptography.X509Certificates.StoreLocation]$StoreLocation =
        [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
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
    Write-Host "  selfSigned = true -> CurrentUser\Root trust is required for this certificate" -ForegroundColor Gray
    $stores += [System.Security.Cryptography.X509Certificates.StoreName]::Root
}
else {
    Write-Host "  selfSigned = false -> CA-issued certificate, root trust comes from the operating system" -ForegroundColor Gray
}

foreach ($storeName in $stores) {
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

Write-Host "Native Office certificate trust applied." -ForegroundColor Green
