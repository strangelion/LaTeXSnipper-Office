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
if ($OutputDir -eq ".\output") {
    $OutputDir = Join-Path $PSScriptRoot "output"
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)

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
    "/p:GenerateManifests=true"
    "/p:LaTeXSnipperVersion=$Version"
    "/v:minimal"
)

if ($SkipSigning) {
    throw (
        "-SkipSigning is not supported for VSTO staging. " +
        "Setting SignManifests=false prevents the Office targets from producing the required " +
        ".vsto and .dll.manifest files."
    )
} else {
    # VSTO/ClickOnce signing must use a certificate already present in
    # Cert:\CurrentUser\My. Passing a password-protected PFX directly to
    # MSBuild is unreliable in CI because MSBuild may try an interactive import.
    #
    # Supported release flow:
    #   env:VstoManifestKeyFile      = path to PFX
    #   env:VstoManifestKeyPassword  = PFX password
    #   env:VstoManifestThumbprint   = optional expected thumbprint
    #
    # After importing the PFX, invoke MSBuild with the thumbprint only and
    # explicitly clear ManifestKeyFile/VstoManifestKeyFile so project-level
    # env properties cannot make MSBuild import the PFX again.

    $providedPfxPath = $env:VstoManifestKeyFile
    $providedPfxPassword = $env:VstoManifestKeyPassword
    $expectedThumbprint = $env:VstoManifestThumbprint
    $is_dev_cert = $false

    function Import-VstoSigningPfx {
        param(
            [Parameter(Mandatory = $true)][string]$PfxPath,
            [string]$Password,
            [string]$ExpectedThumbprint
        )

        if (-not (Test-Path -LiteralPath $PfxPath)) {
            throw "VstoManifestKeyFile not found: $PfxPath"
        }

        $importParams = @{
            FilePath          = (Resolve-Path -LiteralPath $PfxPath).Path
            CertStoreLocation = "Cert:\CurrentUser\My"
            Exportable        = $true
        }

        if ($Password) {
            $importParams.Password = ConvertTo-SecureString $Password -AsPlainText -Force
        }

        try {
            $imported = @(Import-PfxCertificate @importParams)
        } catch {
            throw "Failed to import VSTO signing PFX into Cert:\CurrentUser\My. Check VstoManifestKeyPassword. $($_.Exception.Message)"
        }

        if (-not $imported -or $imported.Count -eq 0) {
            throw "PFX import returned no certificate: $PfxPath"
        }

        if ($ExpectedThumbprint) {
            $normalized = $ExpectedThumbprint.Replace(" ", "").ToUpperInvariant()
            $cert = $imported | Where-Object { $_.Thumbprint.ToUpperInvariant() -eq $normalized } | Select-Object -First 1
            if (-not $cert) {
                $cert = Get-ChildItem "Cert:\CurrentUser\My" |
                    Where-Object { $_.Thumbprint.ToUpperInvariant() -eq $normalized } |
                    Select-Object -First 1
            }
            if (-not $cert) {
                throw "Imported PFX, but expected thumbprint was not found in CurrentUser\My: $ExpectedThumbprint"
            }
            return $cert
        }

        $certWithKey = $imported | Where-Object { $_.HasPrivateKey } | Select-Object -First 1
        if ($certWithKey) { return $certWithKey }

        throw "Imported PFX does not contain a certificate with a private key: $PfxPath"
    }

    if ($providedPfxPath) {
        $storeCert = Import-VstoSigningPfx `
            -PfxPath $providedPfxPath `
            -Password $providedPfxPassword `
            -ExpectedThumbprint $expectedThumbprint
        $thumbprint = $storeCert.Thumbprint
        Write-Host "  Signing: imported PFX into CurrentUser\My ($thumbprint)" -ForegroundColor Green
    } elseif ($expectedThumbprint) {
        $thumbprint = $expectedThumbprint.Replace(" ", "").ToUpperInvariant()
        $storeCert = Get-ChildItem "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
        if (-not $storeCert) {
            throw "VSTO signing certificate not found in Cert:\CurrentUser\My: $thumbprint"
        }
        Write-Host "  Signing: using store certificate ($thumbprint)" -ForegroundColor Green
    } else {
        # Dev fallback — generate temp cert directly in CurrentUser\My.
        $is_dev_cert = $true
        $tempPath = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
        $devPfx = Join-Path $tempPath "LaTeXSnipper-Office.pfx"
        $pwd = ConvertTo-SecureString "test" -AsPlainText -Force
        $storeCert = New-SelfSignedCertificate -Type Custom -Subject "CN=LaTeXSnipper-Office, O=strangelion" `
            -KeyUsage DigitalSignature -FriendlyName "LaTeXSnipper Office Dev" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -NotAfter (Get-Date).AddYears(30) `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
        $storeCert | Export-PfxCertificate -FilePath $devPfx -Password $pwd | Out-Null
        $thumbprint = $storeCert.Thumbprint
        Write-Host "  [DEV] Auto-generated self-signed certificate (not for release!)" -ForegroundColor Yellow
        Write-Host "  [DEV] Thumbprint: $thumbprint" -ForegroundColor Yellow
    }

    $storeCert = Get-ChildItem "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
    if (-not $storeCert) {
        throw "Signing certificate is not in Cert:\CurrentUser\My after import: $thumbprint"
    }
    if (-not $storeCert.HasPrivateKey) {
        throw "Signing certificate does not have a private key: $thumbprint"
    }

    # Prevent MSBuild/project files from seeing env:VstoManifestKeyFile and trying
    # to import a password-protected PFX interactively during Build/Publish.
    Remove-Item Env:VstoManifestKeyFile -ErrorAction SilentlyContinue
    Remove-Item Env:VstoManifestKeyPassword -ErrorAction SilentlyContinue
    $env:VstoManifestThumbprint = $thumbprint

    # Export .cer (public key only) for user distribution/trust checks.
    $certDir = Join-Path $absoluteOutputDir "certificates"
    New-Item -ItemType Directory -Path $certDir -Force | Out-Null
    $cerPath = Join-Path $certDir "LaTeXSnipperOffice.cer"
    $certBytes = $storeCert.Export("Cert")
    [System.IO.File]::WriteAllBytes($cerPath, $certBytes)
    Write-Host "  Certificate .cer exported: $cerPath" -ForegroundColor Gray

    $sha256Algo = [System.Security.Cryptography.SHA256]::Create()
    $sha256Bytes = $sha256Algo.ComputeHash($storeCert.RawData)
    $sha256Hex = ($sha256Bytes | ForEach-Object { $_.ToString("X2") }) -join ""
    $signingJson = @{
        schemaVersion     = 1
        subject           = $storeCert.Subject
        sha1Thumbprint    = $thumbprint.ToUpper()
        sha256Thumbprint  = $sha256Hex
        certificateFile   = "LaTeXSnipperOffice.cer"
    } | ConvertTo-Json -Compress
    $signingPath = Join-Path $certDir "native-office-signing.json"
    Set-Content -Path $signingPath -Value $signingJson -Encoding UTF8
    Write-Host "  Signing metadata: $signingPath" -ForegroundColor Gray

    $buildArgs += "/p:SignManifests=true"
    $buildArgs += "/p:ManifestCertificateThumbprint=$thumbprint"
    $buildArgs += "/p:ManifestKeyFile="
    $buildArgs += "/p:ManifestKeyPassword="
    $buildArgs += "/p:VstoManifestKeyFile="
    $buildArgs += "/p:VstoManifestKeyPassword="
    $buildArgs += "/p:VstoManifestThumbprint=$thumbprint"
    Write-Host "  Signing: ENABLED" -ForegroundColor Green
}

& $MsBuildPath @buildArgs
if ($LASTEXITCODE -ne 0) { throw "MSBuild Build failed" }

# ─── Publish each VSTO host to generate .vsto + .dll.manifest ─────
$hosts = @("Word", "Excel", "PowerPoint", "Visio")
Write-Host "`n  Publishing VSTO hosts for manifest generation..." -ForegroundColor Cyan

foreach ($hostName in $hosts) {
    $proj = Join-Path $SolutionDir "LaTeXSnipper.$hostName\LaTeXSnipper.$hostName.csproj"
    $hostPublishDir = Join-Path $publishDir $hostName
    New-Item -ItemType Directory -Path $hostPublishDir -Force | Out-Null
    $hostPublishUrl = (Resolve-Path -LiteralPath $hostPublishDir).Path.TrimEnd('\') + "\"

    Write-Host "  Publishing VSTO $hostName -> $hostPublishUrl" -ForegroundColor Gray

    $publishArgs = @(
        $proj,
        "/t:Clean;Build;Publish",
        "/p:Configuration=$Configuration",
        "/p:Platform=AnyCPU",
        "/p:VSToolsPath=$officeToolsOverlayVSToolsPath",
        "/p:GenerateManifests=true",
        "/p:SignManifests=true",
        "/p:ManifestCertificateThumbprint=$thumbprint",
        "/p:ManifestKeyFile=",
        "/p:ManifestKeyPassword=",
        "/p:VstoManifestKeyFile=",
        "/p:VstoManifestKeyPassword=",
        "/p:VstoManifestThumbprint=$thumbprint",
        "/p:PublishUrl=$hostPublishUrl",
        "/p:PublishDir=$hostPublishUrl",
        "/p:InstallUrl=$hostPublishUrl",
        "/p:ApplicationVersion=$Version.0",
        "/p:ApplicationRevision=1",
        "/p:BootstrapperEnabled=false",
        "/p:GenerateBootstrapper=false",
        "/p:CreateWebPageOnPublish=false",
        "/v:normal"
    )

    & $MsBuildPath @publishArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "VSTO Publish failed for $hostName (non-fatal, will try bin\Release fallback)"
    }

    # Diagnostic: list what was actually produced
    $produced = Get-ChildItem -LiteralPath $hostPublishDir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in '.vsto', '.manifest', '.dll' } |
        Select-Object -ExpandProperty FullName
    if ($produced) {
        Write-Host "  $hostName published files:" -ForegroundColor DarkGreen
        $produced | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGreen }
    } else {
        Write-Warning "  ${hostName}: Publish produced no .vsto/.manifest/.dll in $hostPublishDir"
    }
}

# ─── Collect publish output ─────────────────────────────────────────
Write-Host "`n[2/4] Collecting binaries from Publish output..." -ForegroundColor Cyan
$staging = Join-Path $OutputDir "staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
$stagingAbs = (Resolve-Path -LiteralPath $staging).Path

# Copy certificates into staging so stage-resources.ps1 can find them
$certSrc = Join-Path $OutputDir "certificates"
$certDst = Join-Path $staging "certificates"
if (Test-Path $certSrc) {
    Copy-Item -LiteralPath $certSrc -Destination $certDst -Recurse -Force
    Write-Host "  Certificates copied to staging\certificates" -ForegroundColor Gray
}
$allGood = $true

# Each host: search multiple candidate directories for .vsto files
$sharedSrc = Join-Path $SolutionDir "LaTeXSnipper.Shared\bin\$Configuration"

foreach ($hostName in $hosts) {
    $projectDir = Join-Path $SolutionDir "LaTeXSnipper.$hostName"

    # Search order: publish dir > bin\Release\app.publish > bin\Release
    $candidates = @(
        (Join-Path $publishDir $hostName),
        (Join-Path $projectDir "bin\$Configuration\app.publish"),
        (Join-Path $projectDir "bin\$Configuration")
    )

    $hostSrc = $null
    foreach ($dir in $candidates) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $vsto = Join-Path $dir "LaTeXSnipper.$hostName.vsto"
        $manifest = Join-Path $dir "LaTeXSnipper.$hostName.dll.manifest"
        $dll = Join-Path $dir "LaTeXSnipper.$hostName.dll"
        if ((Test-Path $vsto) -and (Test-Path $manifest) -and (Test-Path $dll)) {
            $hostSrc = (Resolve-Path -LiteralPath $dir).Path
            break
        }
    }

    if (-not $hostSrc) {
        # Diagnostic: list what's in each candidate
        Write-Host "  ${hostName}: .vsto/.dll.manifest not found, listing candidate dirs:" -ForegroundColor Yellow
        foreach ($dir in $candidates) {
            if (Test-Path -LiteralPath $dir) {
                Write-Host "    $dir :" -ForegroundColor DarkYellow
                Get-ChildItem -LiteralPath $dir -File | Select-Object -First 15 |
                    ForEach-Object { Write-Host "      $($_.Name)" -ForegroundColor DarkGray }
            } else {
                Write-Host "    $dir (does not exist)" -ForegroundColor DarkGray
            }
        }
        # Fallback: use bin\Release even if .vsto missing
        $hostSrc = Join-Path $projectDir "bin\$Configuration"
        $allGood = $false
    }

    $hostDst = Join-Path $staging $hostName

    if (-not (Test-Path $hostSrc)) {
        Write-Warning "${hostName} : no output directory found"
        $allGood = $false
        continue
    }
    Write-Host "  ${hostName}: $hostSrc" -ForegroundColor Green
    New-Item -ItemType Directory -Path $hostDst -Force | Out-Null
    Get-ChildItem $hostSrc -File | Where-Object { $_.Extension -ne ".pdb" } | ForEach-Object {
        Copy-Item $_.FullName $hostDst -Force
    }
}

$sharedDst = Join-Path $staging "Shared"
New-Item -ItemType Directory -Path $sharedDst -Force | Out-Null
$sharedSrcFiles = Get-ChildItem $sharedSrc -File -ErrorAction SilentlyContinue
if ($sharedSrcFiles) {
    Write-Host "  Shared: $($sharedSrcFiles.Count) files" -ForegroundColor Green
    foreach ($f in $sharedSrcFiles) { if ($f.Extension -ne ".pdb") { Copy-Item $f.FullName $sharedDst -Force } }
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

    # Also copy .cer to staging for Tauri bundling
    $certStaging = Join-Path $staging "certificates"
    $certSrc = Join-Path $absoluteOutputDir "certificates\LaTeXSnipperOffice.cer"
    if (Test-Path $certSrc) {
        New-Item -ItemType Directory -Path $certStaging -Force | Out-Null
        Copy-Item $certSrc (Join-Path $certStaging "LaTeXSnipperOffice.cer") -Force
        Write-Host "  .cer copied to staging" -ForegroundColor Gray
    }
} else {
    throw "OLE x86 DLL not found after build at $oleDllX86; OLE will not be available on 32-bit Office"
}
if (Test-Path $oleDllX64) {
    Copy-Item $oleDllX64 (Join-Path $staging "OleFormulaObject.x64.dll") -Force
    Write-Host "  OLE x64 : OK (SHA256: $((Get-FileHash $oleDllX64 -Algorithm SHA256).Hash))" -ForegroundColor Green
} else {
    throw "OLE x64 DLL not found after build at $oleDllX64; OLE will not be available on 64-bit Office"
}
$env:OleBinDir = $stagingAbs
$oleDllX86Sha256 = (Get-FileHash -LiteralPath (Join-Path $env:OleBinDir "OleFormulaObject.x86.dll") -Algorithm SHA256).Hash
$oleDllX64Sha256 = (Get-FileHash -LiteralPath (Join-Path $env:OleBinDir "OleFormulaObject.x64.dll") -Algorithm SHA256).Hash

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

# Remove stale external cabinets so the post-build self-containment gate
# evaluates only artifacts produced by this invocation.
Get-ChildItem -LiteralPath $OutputDir -Filter '*.cab' -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

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
$wixPackageVersion = ($wixVersion -split '[+-]')[0]
$wixMajor = [int](($wixPackageVersion -split '\.')[0])
if ($wixMajor -lt 5 -or $wixMajor -gt 7) {
    throw "Native Office installer requires a tested WiX major version from 5 through 7. Resolved: $wixVersion"
}
$uiExtension = "WixToolset.UI.wixext/$wixPackageVersion"
$iisExtension = "WixToolset.Iis.wixext/$wixPackageVersion"
$bootstrapperExtension = "WixToolset.BootstrapperApplications.wixext/$wixPackageVersion"
$utilExtension = "WixToolset.Util.wixext/$wixPackageVersion"

# Install WiX extensions
Write-Host "  Restoring WiX UI extension..." -ForegroundColor Gray
& $WixPath extension add -g $uiExtension 2>$null
if ($LASTEXITCODE -ne 0) { throw "WiX UI extension install failed" }
Write-Host "  Restoring WiX IIS extension for certificate deployment..." -ForegroundColor Gray
& $WixPath extension add -g $iisExtension 2>$null
if ($LASTEXITCODE -ne 0) { throw "WiX IIS extension install failed" }

# Set WiX variables (absolute paths — WiX resolves relative to .wxs file, not CWD)
$env:SharedBinDir = $sharedDst
$env:WordBinDir = $stagingAbs + "\Word"
$env:ExcelBinDir = $stagingAbs + "\Excel"
$env:PowerPointBinDir = $stagingAbs + "\PowerPoint"
$env:VisioBinDir = $stagingAbs + "\Visio"
$env:CertificateDir = $stagingAbs + "\certificates"

& $WixPath build "$wixSrc\LaTeXSnipper.NativeOffice.wxs" `
    -arch x64 `
    -o $msiOutput `
    -d Version=$Version `
    -d SharedBinDir=$env:SharedBinDir `
    -d WordBinDir=$env:WordBinDir `
    -d ExcelBinDir=$env:ExcelBinDir `
    -d PowerPointBinDir=$env:PowerPointBinDir `
    -d VisioBinDir=$env:VisioBinDir `
    -d OleBinDir=$env:OleBinDir `
    -d OleDllX86Sha256=$oleDllX86Sha256 `
    -d OleDllX64Sha256=$oleDllX64Sha256 `
    -d CertificateDir=$env:CertificateDir `
    -ext $uiExtension `
    -ext $iisExtension
if ($LASTEXITCODE -ne 0) { throw "WiX MSI build failed" }

if (-not (Test-Path -LiteralPath $msiOutput -PathType Leaf)) {
    throw "NativeOffice MSI was not generated: $msiOutput"
}

$externalCabinets = @(
    Get-ChildItem `
        -LiteralPath (Split-Path -Parent $msiOutput) `
        -Filter '*.cab' `
        -File `
        -ErrorAction SilentlyContinue
)

if ($externalCabinets.Count -gt 0) {
    throw (
        "NativeOffice MSI is not self-contained. " +
        "Unexpected external cabinet files: " +
        ($externalCabinets.Name -join ', ')
    )
}

Write-Host "  MSI is self-contained; no external cabinet files were generated." -ForegroundColor Green

# ─── Build Bundle (Bootstrapper) ───────────────────────────────────
Write-Host "`n[4/4] Building Bootstrapper..." -ForegroundColor Cyan
$bundleOutput = Join-Path $OutputDir "LaTeXSnipper.NativeOffice.exe"

Write-Host "  Restoring WiX Bootstrapper Applications and Util extensions..." -ForegroundColor Gray
& $WixPath extension add -g $bootstrapperExtension 2>$null
if ($LASTEXITCODE -ne 0) { throw "WiX Bootstrapper Applications extension install failed" }
& $WixPath extension add -g $utilExtension 2>$null
if ($LASTEXITCODE -ne 0) { throw "WiX Util extension install failed" }

$env:NetFx48Url = "https://go.microsoft.com/fwlink/?linkid=2088631"
$env:VstoRuntimeUrl = "https://download.microsoft.com/download/c/0/e/c0e39fdf-68c9-4332-b745-5268ed69cb54/vstor_redist.exe"
$env:MsiDir = $OutputDir
$prerequisiteDir = Join-Path $OutputDir "prerequisites"
New-Item -ItemType Directory -Path $prerequisiteDir -Force | Out-Null
$netFx48Exe = Join-Path $prerequisiteDir "NetFx48.exe"
$vstoRuntimeExe = Join-Path $prerequisiteDir "VstoRuntime.exe"

function Test-PrerequisiteExecutable {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    $file = Get-Item -LiteralPath $Path
    if ($file.Length -lt 65536) {
        return $false
    }

    $stream = $null
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        if ($stream.ReadByte() -ne 0x4D -or $stream.ReadByte() -ne 0x5A) {
            return $false
        }
    }
    finally {
        if ($stream) { $stream.Dispose() }
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    return $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid -and
        $signature.SignerCertificate.Subject -match 'Microsoft'
}

function Get-PrerequisiteExecutable {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Path
    )

    if (Test-PrerequisiteExecutable -Path $Path) {
        return
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $temporaryPath = "$Path.download"
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        try {
            Write-Host "  Downloading $Name prerequisite (attempt $attempt/3)..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $Url -OutFile $temporaryPath -UseBasicParsing
            if (-not (Test-PrerequisiteExecutable -Path $temporaryPath)) {
                throw "$Name download is not a valid Microsoft-signed executable."
            }
            Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
            return
        }
        catch {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
            if ($attempt -eq 3) {
                throw "$Name prerequisite download failed after 3 attempts: $($_.Exception.Message)"
            }
            Start-Sleep -Seconds 2
        }
    }
}

foreach ($download in @(
    @{ Name = ".NET Framework 4.8"; Url = $env:NetFx48Url; Path = $netFx48Exe },
    @{ Name = "VSTO Runtime"; Url = $env:VstoRuntimeUrl; Path = $vstoRuntimeExe }
)) {
    Get-PrerequisiteExecutable -Name $download.Name -Url $download.Url -Path $download.Path
}

& $WixPath build "$wixSrc\Bundle.wxs" `
    -arch x64 `
    -o $bundleOutput `
    -d Version=$Version `
    -d NetFx48Exe=$netFx48Exe `
    -d VstoRuntimeExe=$vstoRuntimeExe `
    -d MsiDir=$env:MsiDir `
    -ext $bootstrapperExtension `
    -ext $utilExtension
if ($LASTEXITCODE -ne 0) { throw "WiX Bootstrapper build failed" }

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "MSI: $msiOutput" -ForegroundColor Yellow
if (-not (Test-Path -LiteralPath $bundleOutput -PathType Leaf)) {
    throw "Bootstrapper output is missing: $bundleOutput"
}
Write-Host "Bootstrapper: $bundleOutput" -ForegroundColor Yellow
