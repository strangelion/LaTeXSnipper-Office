# Generate a self-signed development certificate for VSTO manifest signing.
# Usage: .\generate-dev-cert.ps1
#
# This creates a self-signed code signing cert and stores it in the
# current user's certificate store. The build.ps1 -SkipSigning flag
# will skip signing entirely; this cert is for local dev/testing only.

param(
    [string]$Subject = "CN=LaTeXSnipper Development",
    [string]$ExportPath = ".\dev-signing.pfx",
    [string]$Password = "dev123"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Generate Self-Signed Dev Certificate ===" -ForegroundColor Green

# Check if cert already exists
$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object { $_.Subject -like "*LaTeXSnipper*" } |
    Select-Object -First 1

if ($existing) {
    Write-Host "Certificate already exists: $($existing.Subject)" -ForegroundColor Yellow
    Write-Host "Thumbprint: $($existing.Thumbprint)" -ForegroundColor Gray
    exit 0
}

# Create self-signed cert
Write-Host "Creating self-signed code signing certificate..." -ForegroundColor Cyan
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -NotAfter (Get-Date).AddYears(2) `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -FriendlyName "LaTeXSnipper Dev Signing"

Write-Host "Certificate created!" -ForegroundColor Green
Write-Host "  Subject: $($cert.Subject)" -ForegroundColor Gray
Write-Host "  Thumbprint: $($cert.Thumbprint)" -ForegroundColor Gray
Write-Host "  Expires: $($cert.NotAfter)" -ForegroundColor Gray

# Export to .pfx file
$pfxPassword = ConvertTo-SecureString $Password -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $ExportPath -Password $pfxPassword
Write-Host "  Exported to: $ExportPath" -ForegroundColor Gray

Write-Host "`nTo use in CI: upload $ExportPath as secret, or add the thumbprint to CI." -ForegroundColor Yellow
