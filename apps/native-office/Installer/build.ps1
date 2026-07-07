# Build script for LaTeXSnipper Native Office installer
# Run from: apps/native-office/Installer/
#
# IMPORTANT: The VSTO Office targets run from MSBuild /t:Build via PrepareForRun
# and generate the .vsto and .dll.manifest files in each host's bin directory.

param(
    [string]$Configuration = "Release",
    [string]$OutputDir = ".\output",
    [string]$MsBuildPath = "",
    [string]$Version = "1.0.0",
    [string]$WixPath = "",
    [switch]$SkipSigning,
    [switch]$StageOnly
)

$ErrorActionPreference = "Stop"
$SolutionDir = Split-Path -Parent $PSScriptRoot

Write-Host "=== LaTeXSnipper Native Office Installer Build ===" -ForegroundColor Green
Write-Host "Configuration: $Configuration" -ForegroundColor Yellow

# ─── Resolve MSBuild ────────────────────────────────────────────────
function Resolve-MsBuildPath {
    param(
        [string]$RequestedPath
    )

    if ($RequestedPath) {
        if (-not (Test-Path -LiteralPath $RequestedPath)) {
            throw "Specified MSBuild path does not exist: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    # 1. Developer command prompt / setup-msbuild may have added it to PATH.
    $fromPath = Get-Command "MSBuild.exe" -ErrorAction SilentlyContinue
    if ($fromPath) {
        return $fromPath.Source
    }

    # 2. Normal Visual Studio installation discovery.
    $programFilesX86 = ${env:ProgramFiles(x86)}
    $vswhereCandidates = @()

    if ($programFilesX86) {
        $vswhereCandidates += Join-Path $programFilesX86 `
            "Microsoft Visual Studio\Installer\vswhere.exe"
    }

    if ($env:ProgramFiles) {
        $vswhereCandidates += Join-Path $env:ProgramFiles `
            "Microsoft Visual Studio\Installer\vswhere.exe"
    }

    foreach ($vswhere in $vswhereCandidates) {
        if (-not (Test-Path -LiteralPath $vswhere)) {
            continue
        }

        $installPath = & $vswhere `
            -latest `
            -products * `
            -requires Microsoft.Component.MSBuild `
            -property installationPath 2>$null |
            Select-Object -First 1

        if (-not $installPath) {
            continue
        }

        foreach ($relativePath in @(
            "MSBuild\Current\Bin\MSBuild.exe",
            "MSBuild\Current\Bin\amd64\MSBuild.exe"
        )) {
            $candidate = Join-Path $installPath $relativePath
            if (Test-Path -LiteralPath $candidate) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }

    # 3. Last-resort fallback for hosted runners and local installations.
    foreach ($majorVersion in @("18", "17")) {
        foreach ($edition in @("Community", "Professional", "Enterprise", "BuildTools")) {
            $candidate = Join-Path $env:ProgramFiles `
                "Microsoft Visual Studio\$majorVersion\$edition\MSBuild\Current\Bin\MSBuild.exe"

            if (Test-Path -LiteralPath $candidate) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }

    return $null
}

Write-Host "`n[1/4] Building solution..." -ForegroundColor Cyan

$MsBuildPath = Resolve-MsBuildPath -RequestedPath $MsBuildPath

if (-not $MsBuildPath) {
    throw "MSBuild not found. Checked PATH, vswhere, and Visual Studio 17/18 installation paths."
}

Write-Host "  MSBuild: $MsBuildPath" -ForegroundColor Gray

# The Office targets invoke a task that requires the VSTO runtime hosting assembly.
# Visual Studio build tools alone do not guarantee that it is installed on hosted CI runners.
$vstoHostingGacRoots = @(
    (Join-Path $env:WINDIR "Microsoft.NET\assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Hosting"),
    (Join-Path $env:WINDIR "assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Hosting")
)

$vstoHostingAssembly = $null
foreach ($vstoHostingGac in $vstoHostingGacRoots) {
    $vstoHostingAssembly = Get-ChildItem -LiteralPath $vstoHostingGac -Recurse `
        -Filter "Microsoft.VisualStudio.Tools.Applications.Hosting.dll" `
        -File -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($vstoHostingAssembly) {
        break
    }
}

if (-not $vstoHostingAssembly) {
    throw (
        "VSTO runtime hosting assembly is missing. " +
        "Run scripts\ensure-vsto-runtime.ps1 before invoking build.ps1."
    )
}

# FindRibbons is an AppDomain-isolated VSTO task. It does not reliably resolve
# modern PackageReference dependency graphs under hosted MSBuild. All hosts in
# this solution use Ribbon XML via CreateRibbonExtensibilityObject(), not
# VSTO Ribbon Designer classes, so the design-time RibbonBase scan is unused.
#
# Create a per-build overlay of OfficeTools and remove only that task block.
# The overlay preserves the OfficeTools directory layout, so relative UsingTask
# and import paths continue to resolve. The installed Visual Studio targets are
# never modified.
function New-XmlRibbonOfficeToolsOverlay {
    param(
        [string]$MsBuildExecutable,
        [string]$DestinationDirectory
    )

    $msbuildBin = Split-Path -Parent $MsBuildExecutable
    $msbuildCurrent = Split-Path -Parent $msbuildBin
    $msbuildRoot = Split-Path -Parent $msbuildCurrent
    $vsInstallRoot = Split-Path -Parent $msbuildRoot

    $sourceTargets = Get-ChildItem `
        -Path (Join-Path $vsInstallRoot "MSBuild\Microsoft\VisualStudio") `
        -Filter "Microsoft.VisualStudio.Tools.Office.targets" `
        -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1

    if (-not $sourceTargets) {
        throw "Microsoft.VisualStudio.Tools.Office.targets was not found under $vsInstallRoot."
    }

    $sourceOfficeTools = Split-Path -Parent $sourceTargets.FullName
    $overlayVSToolsPath = Join-Path $DestinationDirectory "VSTools"
    $overlayOfficeTools = Join-Path $overlayVSToolsPath "OfficeTools"

    if (Test-Path -LiteralPath $overlayOfficeTools) {
        Remove-Item -LiteralPath $overlayOfficeTools -Recurse -Force
    }

    New-Item -ItemType Directory -Path $overlayOfficeTools -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceOfficeTools "*") `
        -Destination $overlayOfficeTools -Recurse -Force

    $overlayTargets = Join-Path $overlayOfficeTools "Microsoft.VisualStudio.Tools.Office.targets"
    $sourceText = Get-Content -LiteralPath $overlayTargets -Raw
    $findRibbonsPattern = '(?s)\s*<FindRibbons\b.*?</FindRibbons>'

    if (-not [regex]::IsMatch($sourceText, $findRibbonsPattern)) {
        throw "Could not locate the FindRibbons task block in $overlayTargets."
    }

    $patchedText = [regex]::Replace($sourceText, $findRibbonsPattern, '')
    Set-Content -LiteralPath $overlayTargets -Value $patchedText -Encoding UTF8

    Write-Host "  Office targets: XML-Ribbon-safe overlay created" -ForegroundColor Gray
    Write-Host "    Source:  $sourceOfficeTools" -ForegroundColor DarkGray
    Write-Host "    Overlay: $overlayOfficeTools" -ForegroundColor DarkGray
    return (Resolve-Path -LiteralPath $overlayVSToolsPath).Path
}

# VSToolsPath is passed to MSBuild and must be absolute.
# Otherwise every host .csproj resolves it relative to its own directory.
$absoluteOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$officeToolsOverlayDir = Join-Path $absoluteOutputDir "obj"

$officeToolsOverlayVSToolsPath = New-XmlRibbonOfficeToolsOverlay `
    -MsBuildExecutable $MsBuildPath `
    -DestinationDirectory $officeToolsOverlayDir

$officeToolsOverlayVSToolsPath = (
    Resolve-Path -LiteralPath $officeToolsOverlayVSToolsPath
).Path

# Build signing arguments — VSTO targets generate .vsto + .dll.manifest only when signed
$publishDir = Join-Path $OutputDir "publish"
New-Item -ItemType Directory -Path $publishDir -Force | Out-Null
$publishUrl = (Resolve-Path $publishDir).Path.TrimEnd('\') + "\"
$buildArgs = @(
    "$SolutionDir\LaTeXSnipper.NativeOffice.sln"
    "/t:Build"
    "/p:Configuration=$Configuration"
    "/p:Platform=Any CPU"
    "/p:VSToolsPath=$officeToolsOverlayVSToolsPath"
    "/p:PublishUrl=$publishUrl"
    "/p:InstallUrl=$publishUrl"
    "/v:minimal"
)

if ($SkipSigning) {
    throw (
        "-SkipSigning is not supported for VSTO staging. " +
        "Setting SignManifests=false prevents the Office targets from producing the required " +
        ".vsto and .dll.manifest files."
    )
} else {
    # Local or CI: use dev PFX or passed cert
    if (-not $env:VstoManifestKeyFile) {
        # Auto-generate a dev PFX and import to certificate store
        $tempPath = $env:TEMP

        if (-not $tempPath) {
           $tempPath = [System.IO.Path]::GetTempPath()
        }

        $devPfx = Join-Path $tempPath "LaTeXSnipperDev.pfx"
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
$allGood = $true

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
    New-Item -ItemType Directory -Path $hostDst -Force | Out-Null
    Get-ChildItem $hostSrc -File | ForEach-Object {
        Copy-Item $_.FullName $hostDst -Force
    }
}

$sharedDst = Join-Path $staging "Shared"
New-Item -ItemType Directory -Path $sharedDst -Force | Out-Null
$sharedSrcFiles = Get-ChildItem $sharedSrc -File -ErrorAction SilentlyContinue
if ($sharedSrcFiles) {
    Write-Host "  Shared: $($sharedSrcFiles.Count) files" -ForegroundColor Green
    foreach ($f in $sharedSrcFiles) { Copy-Item $f.FullName $sharedDst -Force }
} else {
    Write-Warning "Shared source directory is empty or missing: $sharedSrc"
    $allGood = $false
}

# Validate critical files exist
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

if (-not $allGood) {
    throw "Native Office staging is incomplete."
}

# Stage OLE Formula Object DLL (build x86 and x64 explicitly)
$oleProjPath = Join-Path $SolutionDir "LaTeXSnipper.OleFormulaObjectNative"
$oleVcxproj = Join-Path $oleProjPath "LaTeXSnipper.OfficePlugin.OleFormulaObjectHandler.vcxproj"

Write-Host "  Building OLE x86..." -ForegroundColor Gray
& $MsBuildPath $oleVcxproj "/t:Build" "/p:Configuration=$Configuration" "/p:Platform=Win32" "/v:minimal"
if ($LASTEXITCODE -ne 0) { throw "OLE x86 build failed" }

Write-Host "  Building OLE x64..." -ForegroundColor Gray
& $MsBuildPath $oleVcxproj "/t:Build" "/p:Configuration=$Configuration" "/p:Platform=x64" "/v:minimal"
if ($LASTEXITCODE -ne 0) { throw "OLE x64 build failed" }

$oleDllX86 = Join-Path $oleProjPath "bin\Win32\$Configuration\LaTeXSnipper.OfficePlugin.OleFormulaObject.Handler.x86.dll"
$oleDllX64 = Join-Path $oleProjPath "bin\x64\$Configuration\LaTeXSnipper.OfficePlugin.OleFormulaObject.Handler.x64.dll"
if (Test-Path $oleDllX86) {
    Copy-Item $oleDllX86 (Join-Path $staging "OleFormulaObject.x86.dll") -Force
    Write-Host "  OLE x86 : OK (SHA256: $((Get-FileHash $oleDllX86 -Algorithm SHA256).Hash))" -ForegroundColor Green
} else {
    throw "OLE x86 DLL not found after build at $oleDllX86 — OLE will not be available on 32-bit Office"
}
if (Test-Path $oleDllX64) {
    Copy-Item $oleDllX64 (Join-Path $staging "OleFormulaObject.x64.dll") -Force
    Write-Host "  OLE x64 : OK (SHA256: $((Get-FileHash $oleDllX64 -Algorithm SHA256).Hash))" -ForegroundColor Green
} else {
    throw "OLE x64 DLL not found after build at $oleDllX64 — OLE will not be available on 64-bit Office"
}
$env:OleBinDir = $stagingAbs

# A VSTO deployment manifest hashes its application manifest and the application
# manifest hashes every payload dependency. Verify the copied staging tree before
# it becomes an artifact or an installer input; a later byte mismatch is rejected
# by Word/Excel/PowerPoint as InvalidDeploymentException.
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$verifyVstoManifests = Join-Path $repoRoot "scripts\verify-vsto-manifests.ps1"
& $verifyVstoManifests -PayloadRoot (Resolve-Path -LiteralPath $staging).Path

if ($StageOnly) {
    Write-Host "`n=== VSTO staging complete ===" -ForegroundColor Green
    Write-Host "Staging: $staging" -ForegroundColor Yellow
    return
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
$env:SharedBinDir = $sharedDst
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
    -d OleBinDir=$env:OleBinDir `
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
