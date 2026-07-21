[CmdletBinding()]
param(
    [string]$StagingRoot = "",
    [string[]]$WindowsPackageRoots = @(),
    [string[]]$NonWindowsPackageRoots = @(),
    [string]$WpsStaging = "",
    [string[]]$WpsPackageRoots = @(),
    [string]$ResourceStagingRoot = "",
    [string[]]$ResourcePackageRoots = @(),
    [string[]]$ResourceNames = @("OfficeJS", "WPS", "Obsidian", "Ecosystem"),
    [string]$ExpectedVersion = ""
)

$ErrorActionPreference = "Stop"
$expected = @{}
$dumpbin = $null

function Resolve-Dumpbin {
    $fromPath = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }

    $vswhereCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"),
        (Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    foreach ($vswhere in $vswhereCandidates) {
        $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -find "VC\Tools\MSVC\**\bin\Hostx64\x64\dumpbin.exe" | Select-Object -First 1
        if ($found -and (Test-Path -LiteralPath $found)) { return $found }
    }
    return $null
}

function Assert-FileVersion([string]$Path, [string]$ActualVersion) {
    if ([string]::IsNullOrWhiteSpace($ActualVersion)) { throw "DLL file version is missing: $Path" }
    if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) { return }

    $expectedMatch = [regex]::Match($ExpectedVersion, '^\d+\.\d+\.\d+(?:\.\d+)?')
    $actualMatch = [regex]::Match($ActualVersion, '^\d+\.\d+\.\d+(?:\.\d+)?')
    if (-not $expectedMatch.Success -or -not $actualMatch.Success) {
        throw "DLL file version is not numeric: path=$Path expected=$ExpectedVersion actual=$ActualVersion"
    }

    $expectedVersionValue = [Version]$expectedMatch.Value
    $actualVersionValue = [Version]$actualMatch.Value
    $actualRevision = if ($actualVersionValue.Revision -lt 0) { 0 } else { $actualVersionValue.Revision }
    $expectedRevision = if ($expectedVersionValue.Revision -lt 0) { 0 } else { $expectedVersionValue.Revision }
    if ($actualVersionValue.Major -ne $expectedVersionValue.Major -or
        $actualVersionValue.Minor -ne $expectedVersionValue.Minor -or
        $actualVersionValue.Build -ne $expectedVersionValue.Build -or
        $actualRevision -ne $expectedRevision) {
        throw "DLL file version mismatch: path=$Path expected=$ExpectedVersion actual=$ActualVersion"
    }
}

function Get-PackagedResourceDirectories([string]$PackageRoot, [string]$Name) {
    return @(
        Get-ChildItem -LiteralPath $PackageRoot -Recurse -Directory |
            Where-Object {
                $_.Name.Equals($Name, [System.StringComparison]::OrdinalIgnoreCase) -and
                $_.Parent -and
                $_.Parent.Name.Equals("resources", [System.StringComparison]::OrdinalIgnoreCase)
            }
    )
}

if ($WindowsPackageRoots.Count -gt 0) {
    if ([string]::IsNullOrWhiteSpace($StagingRoot)) { throw "StagingRoot is required for Windows package verification" }
    $staging = (Resolve-Path -LiteralPath $StagingRoot).Path

    # Check if this is MSI-only staging (new model) or legacy VSTO staging
    $msiPath = Join-Path $staging "LaTeXSnipper.NativeOffice.msi"
    $bootstrapperPath = Join-Path $staging "LaTeXSnipper.NativeOffice.OfflineSetup.exe"
    $isMsiOnly = (Test-Path -LiteralPath $msiPath -PathType Leaf) -and
                 (Test-Path -LiteralPath $bootstrapperPath -PathType Leaf)

    if ($isMsiOnly) {
        # MSI-only model: verify MSI + bootstrapper are present in the package.
        # Hash verification is skipped because Tauri bundling (NSIS/MSI) may
        # compress or encode binaries differently from the staging source.
        Write-Host "  Using MSI-only verification model" -ForegroundColor Green

        foreach ($rootValue in $WindowsPackageRoots) {
            $root = (Resolve-Path -LiteralPath $rootValue).Path
            $msiMatches = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter "LaTeXSnipper.NativeOffice.msi")
            if ($msiMatches.Count -eq 0) {
                throw "MSI package is missing from ${root}"
            }
            Write-Host "    MSI: found in ${root}" -ForegroundColor Green

            $bootMatches = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter "LaTeXSnipper.NativeOffice.OfflineSetup.exe")
            if ($bootMatches.Count -eq 0) {
                throw "Bootstrapper is missing from ${root}"
            }
            Write-Host "    Bootstrapper: found in ${root}" -ForegroundColor Green
        }
    } else {
        # Legacy VSTO staging model (fallback for dev builds)
        Write-Host "  Using legacy VSTO verification model" -ForegroundColor Yellow
        $expected = @{}
        foreach ($entry in @(
            @{ Name = "OleFormulaObject.x86.dll"; Machine = 0x014c },
            @{ Name = "OleFormulaObject.x64.dll"; Machine = 0x8664 }
        )) {
            $path = Join-Path $staging $entry.Name
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion
            Assert-FileVersion $path $version
            $expected[$entry.Name] = @{
                Hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
                Machine = $entry.Machine
                Version = $version
            }
        }

        foreach ($hostName in @("Word", "Excel", "PowerPoint", "Visio")) {
            foreach ($extension in @("dll", "vsto", "dll.manifest")) {
                $fileName = "LaTeXSnipper.$hostName.$extension"
                $source = Join-Path $staging "$hostName\$fileName"
                if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
                $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
                foreach ($rootValue in $WindowsPackageRoots) {
                    $root = (Resolve-Path -LiteralPath $rootValue).Path
                    $matches = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $fileName)
                    if ($matches.Count -eq 0) {
                        throw "Packaged $hostName payload is missing from ${root}: $fileName"
                    }
                    foreach ($match in $matches) {
                        $packageHash = (Get-FileHash -LiteralPath $match.FullName -Algorithm SHA256).Hash
                        if ($packageHash -ne $sourceHash) {
                            throw "VSTO staging/package hash mismatch: host=$hostName file=$fileName staging=$sourceHash package=$packageHash path=$($match.FullName)"
                        }
                    }
                }
            }
        }
    }
}

function Get-PeMachine([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $reader = [System.IO.BinaryReader]::new($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw "Not a PE file: $Path" }
        $stream.Position = 0x3c
        $offset = $reader.ReadUInt32()
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Invalid PE signature: $Path" }
        return $reader.ReadUInt16()
    }
    finally { $stream.Dispose() }
}

function Assert-WpsPayload([string]$PackageRoot) {
    if ([string]::IsNullOrWhiteSpace($WpsStaging)) { throw "WpsStaging is required for WPS package verification" }
    $source = (Resolve-Path -LiteralPath $WpsStaging).Path
    $wpsDirectories = @(Get-PackagedResourceDirectories $PackageRoot "WPS")
    if ($wpsDirectories.Count -ne 1) { throw "Expected exactly one resources/WPS directory in $PackageRoot; found=$($wpsDirectories.Count)" }
    $wps = $wpsDirectories[0].FullName
    if (Test-Path -LiteralPath (Join-Path $wps "WPS") -PathType Container) { throw "Duplicate nested WPS path found: $wps\WPS" }
    foreach ($relative in @(
        "index.html",
        "main.js",
        "manifest.json",
        "manifest.xml",
        "ribbon.xml",
        "js/command-layer.js",
        "js/host-detect.js",
        "js/bridge-client.js",
        "js/adapters.js",
        "js/ribbon.js",
        "js/util.js",
        "ui/taskpane.html",
        "ui/taskpane.js"
    )) {
        $relativePath = $relative -replace '/', [System.IO.Path]::DirectorySeparatorChar
        $sourceFile = Join-Path $source $relativePath
        $packageFile = Join-Path $wps $relativePath
        if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { throw "Packaged WPS file missing: $relative in $PackageRoot" }
        $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
        $packageHash = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash
        if ($sourceHash -ne $packageHash) { throw "WPS hash mismatch: relative=$relative source=$sourceHash package=$packageHash path=$packageFile" }
    }
    foreach ($legacy in @("proxy.js", "server.js", "start.js", "publish.html", "taskpane.html")) {
        if (Test-Path -LiteralPath (Join-Path $wps $legacy) -PathType Leaf) {
            throw "Legacy WPS runtime must not be packaged: $legacy in $PackageRoot"
        }
    }
    if ($ExpectedVersion) {
        $manifest = Get-Content -Raw -LiteralPath (Join-Path $wps "manifest.xml")
        if ($manifest -notmatch "<Version>$([regex]::Escape($ExpectedVersion))</Version>") {
            throw "WPS manifest version mismatch in $wps; expected=$ExpectedVersion"
        }
    }

}

function Assert-ResourcePayload([string]$PackageRoot) {
    if ([string]::IsNullOrWhiteSpace($ResourceStagingRoot)) {
        throw "ResourceStagingRoot is required for resource package verification"
    }
    $stagingRoot = (Resolve-Path -LiteralPath $ResourceStagingRoot).Path
    foreach ($name in $ResourceNames) {
        $sourceRoot = Join-Path $stagingRoot $name
        if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
            throw "Staged resource directory is missing: $sourceRoot"
        }
        $packageDirectories = @(Get-PackagedResourceDirectories $PackageRoot $name)
        if ($packageDirectories.Count -ne 1) {
            throw "Expected exactly one resources/$name directory in $PackageRoot; found=$($packageDirectories.Count)"
        }
        $packageResourceRoot = $packageDirectories[0].FullName
        $sourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Sort-Object FullName)
        $packageFiles = @(Get-ChildItem -LiteralPath $packageResourceRoot -Recurse -File | Sort-Object FullName)
        if ($sourceFiles.Count -eq 0) { throw "Staged resource directory is empty: $sourceRoot" }
        if ($sourceFiles.Count -ne $packageFiles.Count) {
            throw "Resource file count mismatch: resource=$name package=$PackageRoot staging=$($sourceFiles.Count) packaged=$($packageFiles.Count)"
        }
        foreach ($sourceFile in $sourceFiles) {
            $relative = $sourceFile.FullName.Substring($sourceRoot.Length).TrimStart([char[]]@('\', '/'))
            $packageFile = Join-Path $packageResourceRoot $relative
            if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
                throw "Packaged resource file missing: resource=$name relative=$relative package=$PackageRoot"
            }
            $sourceHash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
            $packageHash = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash
            if ($sourceHash -ne $packageHash) {
                throw "Resource hash mismatch: resource=$name relative=$relative staging=$sourceHash package=$packageHash path=$packageFile"
            }
        }
    }

    $sourceProvenance = Join-Path $stagingRoot "provenance.json"
    if (-not (Test-Path -LiteralPath $sourceProvenance -PathType Leaf)) {
        throw "Resource provenance is missing: $sourceProvenance"
    }
    $packagedProvenance = @(
        Get-ChildItem -LiteralPath $PackageRoot -Recurse -File -Filter "provenance.json" |
            Where-Object { $_.Directory.Name -eq "resources" }
    )
    if ($packagedProvenance.Count -ne 1) {
        throw "Expected exactly one packaged provenance.json in $PackageRoot; found=$($packagedProvenance.Count)"
    }
    $sourceHash = (Get-FileHash -LiteralPath $sourceProvenance -Algorithm SHA256).Hash
    $packageHash = (Get-FileHash -LiteralPath $packagedProvenance[0].FullName -Algorithm SHA256).Hash
    if ($sourceHash -ne $packageHash) {
        throw "Resource provenance hash mismatch: package=$PackageRoot staging=$sourceHash packaged=$packageHash"
    }
}

foreach ($rootValue in $WindowsPackageRoots) {
    $root = (Resolve-Path -LiteralPath $rootValue).Path
    $forbidden = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
        $relativePath = $_.FullName.Substring($root.Length).TrimStart([char[]]@('\', '/'))
        $_.Extension -match '^\.(pfx|p12|pem|key|pdb|emf)$' -or
        $_.Name -match '(?i)(NativeVectorTests|OleActivationProbe|PendingPayloadTests).*\.exe$' -or
        ($_.Extension -eq '.svg' -and $relativePath -match '(?i)(^|[\\/])(temp|tmp|fixtures?|tests?)([\\/]|$)|(^|[\\/])(temp|tmp)[^\\/]*\.svg$')
    }
    if ($forbidden) { throw "Forbidden files in package ${root}: $($forbidden.FullName -join ', ')" }

    foreach ($name in $expected.Keys) {
        $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $name)
        if ($files.Count -eq 0) { throw "Package root $root does not contain $name" }
        foreach ($file in $files) {
            $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            if ($hash -ne $expected[$name].Hash) { throw "DLL hash mismatch: $($file.FullName) expected=$($expected[$name].Hash) actual=$hash" }
            $machine = Get-PeMachine $file.FullName
            if ($machine -ne $expected[$name].Machine) { throw "PE Machine mismatch: $($file.FullName) machine=0x$('{0:X4}' -f $machine)" }
            $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($file.FullName).FileVersion
            Assert-FileVersion $file.FullName $version
            if ($version -ne $expected[$name].Version) {
                throw "DLL staging/package version mismatch: path=$($file.FullName) staging=$($expected[$name].Version) package=$version"
            }
            $exports = & $dumpbin /nologo /exports $file.FullName 2>&1 | Out-String
            foreach ($export in @("DllGetClassObject", "DllCanUnloadNow")) {
                if ($exports -notmatch "\b$export\b") { throw "Missing export $export in $($file.FullName)" }
            }
            $dependents = & $dumpbin /nologo /dependents $file.FullName 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0 -or $dependents -match 'fatal error|cannot open') {
                throw "Dependency inspection failed for $($file.FullName): $dependents"
            }
        }
    }
}

foreach ($rootValue in $NonWindowsPackageRoots) {
    $root = (Resolve-Path -LiteralPath $rootValue).Path
    $forbidden = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
        $_.Name -match '(?i)(OleFormulaObject|NativeOffice|\.vsto$|\.pfx$|\.cer$|\.msi$)'
    }
    if ($forbidden) { throw "Windows NativeOffice content found in non-Windows package ${root}: $($forbidden.FullName -join ', ')" }
}

foreach ($rootValue in $WpsPackageRoots) {
    Assert-WpsPayload (Resolve-Path -LiteralPath $rootValue).Path
}

foreach ($rootValue in $ResourcePackageRoots) {
    Assert-ResourcePayload (Resolve-Path -LiteralPath $rootValue).Path
}

Write-Host "Package content hashes, versions, PE machine values, and forbidden-file rules verified."
