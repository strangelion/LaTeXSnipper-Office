<#
.SYNOPSIS
Verifies the ClickOnce/VSTO hash chain for a staged Native Office payload.

.DESCRIPTION
A .vsto deployment manifest hashes its corresponding .dll.manifest. The
application manifest then hashes every install-time dependency. Any byte
change after manifest generation makes Office reject the add-in.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$PayloadRoot
)

$ErrorActionPreference = "Stop"
$PayloadRoot = (Resolve-Path -LiteralPath $PayloadRoot).Path

function Get-Sha256Base64 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [Convert]::ToBase64String($sha256.ComputeHash($stream))
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Assert-ManifestDependency {
    param(
        [Parameter(Mandatory = $true)]$Dependency,
        [Parameter(Mandatory = $true)][string]$BaseDirectory,
        [Parameter(Mandatory = $true)][string]$ManifestLabel
    )

    $codebase = $Dependency.GetAttribute("codebase")
    if ([string]::IsNullOrWhiteSpace($codebase)) {
        return
    }

    $targetPath = Join-Path $BaseDirectory $codebase
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
        throw "$ManifestLabel references a missing file: $codebase"
    }

    $sizeText = $Dependency.GetAttribute("size")
    if (-not [string]::IsNullOrWhiteSpace($sizeText)) {
        [Int64]$expectedSize = 0
        if (-not [Int64]::TryParse($sizeText, [ref]$expectedSize)) {
            throw "$ManifestLabel has an invalid size for $codebase: $sizeText"
        }

        $actualSize = (Get-Item -LiteralPath $targetPath).Length
        if ($actualSize -ne $expectedSize) {
            throw "$ManifestLabel size mismatch for $codebase. Expected $expectedSize bytes, found $actualSize bytes."
        }
    }

    $digestNode = $Dependency.SelectSingleNode("./*[local-name()='hash']/*[local-name()='DigestValue']")
    if ($null -eq $digestNode -or [string]::IsNullOrWhiteSpace($digestNode.InnerText)) {
        throw "$ManifestLabel has no SHA-256 digest for $codebase"
    }

    $expectedHash = $digestNode.InnerText.Trim()
    $actualHash = Get-Sha256Base64 -Path $targetPath
    if ($actualHash -ne $expectedHash) {
        throw "$ManifestLabel hash mismatch for $codebase. Expected $expectedHash, found $actualHash."
    }
}

function Assert-ClickOnceManifest {
    param(
        [Parameter(Mandatory = $true)][string]$ManifestPath,
        [Parameter(Mandatory = $true)][string]$BaseDirectory,
        [Parameter(Mandatory = $true)][string]$Label
    )

    [xml]$manifest = Get-Content -LiteralPath $ManifestPath -Raw
    $dependencies = $manifest.SelectNodes("//*[local-name()='dependentAssembly' and @codebase]")
    if ($null -eq $dependencies -or $dependencies.Count -eq 0) {
        throw "$Label does not contain any hashed codebase dependencies."
    }

    foreach ($dependency in $dependencies) {
        Assert-ManifestDependency -Dependency $dependency -BaseDirectory $BaseDirectory -ManifestLabel $Label
    }
}

$hosts = @("Word", "Excel", "PowerPoint")
foreach ($host in $hosts) {
    $hostDirectory = Join-Path $PayloadRoot $host
    if (-not (Test-Path -LiteralPath $hostDirectory -PathType Container)) {
        throw "VSTO host directory missing: $hostDirectory"
    }

    $vstoPath = Join-Path $hostDirectory "LaTeXSnipper.$host.vsto"
    $applicationManifestPath = Join-Path $hostDirectory "LaTeXSnipper.$host.dll.manifest"

    if (-not (Test-Path -LiteralPath $vstoPath -PathType Leaf)) {
        throw "VSTO deployment manifest missing: $vstoPath"
    }
    if (-not (Test-Path -LiteralPath $applicationManifestPath -PathType Leaf)) {
        throw "VSTO application manifest missing: $applicationManifestPath"
    }

    Assert-ClickOnceManifest -ManifestPath $vstoPath -BaseDirectory $hostDirectory -Label "$host .vsto"
    Assert-ClickOnceManifest -ManifestPath $applicationManifestPath -BaseDirectory $hostDirectory -Label "$host .dll.manifest"

    Write-Host "  $host: VSTO manifest hash chain verified" -ForegroundColor Green
}

Write-Host "VSTO payload integrity verified: $PayloadRoot" -ForegroundColor Green
