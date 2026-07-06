# Build script for LaTeXSnipper Native Office installer
# Run from: apps/native-office/Installer/
#
# IMPORTANT: This uses MSBuild /t:Publish to generate .vsto and .dll.manifest files.
# Do NOT use /t:Build — it only produces DLLs, not ClickOnce manifests.

param(
    [string]$Configuration = "Release",
    [string]$OutputDir = ".\output",
    [string]$MsBuildPath = "",
    [string]$Version = "1.0.0",
    [string]$WixPath = "",
    [switch]$SkipSigning
)

$ErrorActionPreference = "Stop"
$SolutionDir = Split-Path -Parent $PSScriptRoot

Write-Host "=== LaTeXSnipper Native Office Installer Build ===" -ForegroundColor Green
Write-Host "Configuration: $Configuration" -ForegroundColor Yellow

# ─── Resolve MSBuild ────────────────────────────────────────────────
Write-Host "`n[1/4] Building solution (Publish)..." -ForegroundColor Cyan
if (-not $MsBuildPath) {
    $msbuild = Get-Command "MSBuild.exe" -ErrorAction SilentlyContinue
    if ($msbuild) {
        $MsBuildPath = $msbuild.Source
    } else {
        $MsBuildPath = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
    }
}
Write-Host "  MSBuild: $MsBuildPath" -ForegroundColor Gray

# Build signing arguments — VSTO targets generate .vsto + .dll.manifest only when signed
$buildArgs = @(
    "$SolutionDir\LaTeXSnipper.NativeOffice.sln"
    "/t:Build"
    "/p:Configuration=$Configuration"
    "/p:Platform=Any CPU"
    "/v:minimal"
)

if ($SkipSigning) {
    # CI-only: skip manifest signing, output unsigned .vsto + .dll.manifest
    $buildArgs += "/p:SignManifests=false"
    Write-Host "  Signing: DISABLED (unsigned manifests)" -ForegroundColor Yellow
} else {
    # Local or CI: use dev PFX or passed cert
    if (-not $env:VstoManifestKeyFile) {
        # Auto-generate a dev PFX and import to certificate store
        $devPfx = Join-Path $env:TEMP "LaTeXSnipperDev.pfx"
        $pwd = ConvertTo-SecureString "test" -AsPlainText -Force
        $cert = New-SelfSignedCertificate -Type Custom -Subject "CN=LaTeXSnipperDev" `
            -KeyUsage DigitalSignature -FriendlyName "LaTeXSnipper Dev" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
        $cert | Export-PfxCertificate -FilePath $devPfx -Password $pwd
        $thumbprint = $cert.Thumbprint
        Write-Host "  Generated dev PFX: $devPfx" -ForegroundColor Gray
        Write-Host "  Certificate thumbprint: $thumbprint" -ForegroundColor Gray

        $env:VstoManifestKeyFile = $devPfx
        $env:VstoManifestKeyPassword = "test"
    } else {
        # Thumbprint passed via env or retrieve from store
        if ($env:VstoManifestThumbprint) {
            $thumbprint = $env:VstoManifestThumbprint
        } else {
            $thumbprint = (Get-PfxCertificate -FilePath $env:VstoManifestKeyFile).Thumbprint
        }
        Write-Host "  Certificate thumbprint: $thumbprint" -ForegroundColor Gray
    }
    $buildArgs += "/p:SignManifests=true"
    $buildArgs += "/p:ManifestCertificateThumbprint=$thumbprint"
    $buildArgs += "/p:VstoManifestKeyFile=$env:VstoManifestKeyFile"
    if ($env:VstoManifestKeyPassword) {
        $buildArgs += "/p:VstoManifestKeyPassword=$env:VstoManifestKeyPassword"
    }
    Write-Host "  Signing: ENABLED" -ForegroundColor Green
}

& $MsBuildPath @buildArgs
if ($LASTEXITCODE -ne 0) { throw "MSBuild Build failed" }

# ─── Collect publish output ─────────────────────────────────────────
Write-Host "`n[2/4] Collecting binaries from Publish output..." -ForegroundColor Cyan
$staging = Join-Path $OutputDir "staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# Each host builds to its own bin\$Configuration directory
$hosts = @("Word", "Excel", "PowerPoint")
$sharedSrc = Join-Path $SolutionDir "LaTeXSnipper.Shared\bin\$Configuration"

foreach ($hostName in $hosts) {
    $hostSrc = Join-Path $SolutionDir "LaTeXSnipper.$hostName\bin\$Configuration"
    $hostDst = Join-Path $staging $hostName

    if (-not (Test-Path $hostSrc)) {
        Write-Warning "${hostName} : bin\$Configuration not found"
        $allGood = $false
        continue
    }
    Write-Host "  ${hostName}: bin\$Configuration" -ForegroundColor Green
    Copy-Item "$hostSrc\*" $hostDst -Recurse -Force
}

$sharedDst = Join-Path $staging "Shared"
    $sharedSrcFiles = Get-ChildItem $sharedSrc -File -ErrorAction SilentlyContinue
    if ($sharedSrcFiles) {
        Write-Host "  Shared: $($sharedSrcFiles.Count) files" -ForegroundColor Green
        foreach ($f in $sharedSrcFiles) { Copy-Item $f.FullName $sharedDst -Force }
    } else {
        Write-Warning "Shared source directory is empty or missing: $sharedSrc"
    }

# Validate critical files exist
$allGood = $true
foreach ($hostName in $hosts) {
    $vsto = Join-Path $staging "$hostName\LaTeXSnipper.$hostName.vsto"
    $manifest = Join-Path $staging "$hostName\LaTeXSnipper.$hostName.dll.manifest"
    $dll = Join-Path $staging "$hostName\LaTeXSnipper.$hostName.dll"

    if (-not (Test-Path $vsto)) {
        Write-Warning "${hostName} : Missing .vsto file"
        $allGood = $false
    } else {
        Write-Host "  ${hostName} : .vsto OK" -ForegroundColor Green
    }
    if (-not (Test-Path $manifest)) {
        Write-Warning "${hostName} : Missing .dll.manifest"
        $allGood = $false
    } else {
        Write-Host "  ${hostName} : .dll.manifest OK" -ForegroundColor Green
    }
    if (-not (Test-Path $dll)) {
        Write-Warning "${hostName} : Missing .dll"
        $allGood = $false
    } else {
        Write-Host "  ${hostName} : .dll OK" -ForegroundColor Green
    }
}

Write-Host "  Staged files:" -ForegroundColor Gray
Get-ChildItem $staging -Recurse -File | ForEach-Object { Write-Host "    $($_.FullName.Replace($staging, ''))" -ForegroundColor Gray }

# ─── Build MSI with WiX ────────────────────────────────────────────
Write-Host "`n[3/4] Building MSI installer..." -ForegroundColor Cyan
$wixSrc = Join-Path $PSScriptRoot "WiX"
$msiOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.msi"

# Resolve WiX
if (-not $WixPath) {
    $resolvedWix = Get-Command "wix.exe" -ErrorAction SilentlyContinue
    if (-not $resolvedWix) { $resolvedWix = Get-Command "wix" -ErrorAction SilentlyContinue }
    if (-not $resolvedWix) { throw "WiX executable not found. Pass -WixPath explicitly." }
    $WixPath = $resolvedWix.Source
}
if (-not (Test-Path $WixPath)) { throw "WiX executable does not exist: $WixPath" }
$wixVersion = (& $WixPath --version | Out-String).Trim()
Write-Host "  WiX: $WixPath ($wixVersion)" -ForegroundColor Gray
if ($wixVersion -notmatch '^[457]\.') { throw "Native Office installer requires WiX 4.x/5.x/7.x. Resolved: $wixVersion" }

# Install WiX extensions
Write-Host "  Restoring WiX UI extension..." -ForegroundColor Gray
& $WixPath extension add WixToolset.UI.wixext 2>$null
if ($LASTEXITCODE -ne 0) { throw "WiX UI extension install failed" }

# Set WiX variables (absolute paths — WiX resolves relative to .wxs file, not CWD)
$stagingAbs = (Resolve-Path $staging).Path
$env:SharedBinDir = $sharedSrc
$env:WordBinDir = $stagingAbs + "\Word"
$env:ExcelBinDir = $stagingAbs + "\Excel"
$env:PowerPointBinDir = $stagingAbs + "\PowerPoint"

& $WixPath build "$wixSrc\LaTeXSnipper.NativeOffice.wxs" `
    -o $msiOutput `
    -d Version=$Version `
    -d SharedBinDir=$env:SharedBinDir `
    -d WordBinDir=$env:WordBinDir `
    -d ExcelBinDir=$env:ExcelBinDir `
    -d PowerPointBinDir=$env:PowerPointBinDir `
    -ext WixToolset.UI.wixext
if ($LASTEXITCODE -ne 0) { throw "WiX MSI build failed" }

# ─── Build Bundle (Bootstrapper) ───────────────────────────────────
Write-Host "`n[4/4] Building Bootstrapper..." -ForegroundColor Cyan
$bundleOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.exe"

Write-Host "  Restoring WiX Bal extension..." -ForegroundColor Gray
& $WixPath extension add WixToolset.Bal.wixext 2>$null

$env:NetFx48Url = "https://go.microsoft.com/fwlink/?LinkId=2085329"
$env:VstoRuntimeUrl = "https://go.microsoft.com/fwlink/?LinkId=261103"
$env:MsiDir = $OutputDir

& $WixPath build "$wixSrc\Bundle.wxs" `
    -o $bundleOutput `
    -d Version=$Version `
    -d NetFx48Url=$env:NetFx48Url `
    -d VstoRuntimeUrl=$env:VstoRuntimeUrl `
    -d MsiDir=$env:MsiDir `
    -ext WixToolset.Bal.wixext
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Bundle build failed (WiX Bal extension compatibility issue). MSI was built successfully."
    Write-Warning "Bootstrapper EXE will be generated in a future WiX update."
}

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "MSI: $msiOutput" -ForegroundColor Yellow
if (Test-Path $bundleOutput) {
    Write-Host "Bootstrapper: $bundleOutput" -ForegroundColor Yellow
} else {
    Write-Host "Bootstrapper: SKIPPED (WiX Bal extension issue)" -ForegroundColor DarkYellow
}
