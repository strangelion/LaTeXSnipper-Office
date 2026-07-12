[CmdletBinding()]
param(
    [string]$Tag = "v1.2.1",
    [string]$Destination = "prior-version.msi",
    [string]$DiagnosticsDirectory = "package-diagnostics"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DiagnosticsDirectory | Out-Null
if ($env:NATIVE_OFFICE_WIX_ROOT) {
    $env:PATH = "$env:NATIVE_OFFICE_WIX_ROOT;$env:PATH"
}
$destinationPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Destination))
$repository = if ($env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY } else { "strangelion/LaTeXSnipper-Office" }
$resolutionLog = Join-Path $DiagnosticsDirectory "prior-native-office-resolution.txt"
"repository=$repository`ntag=$Tag" | Set-Content -LiteralPath $resolutionLog -Encoding UTF8

& git rev-parse --verify "$Tag^{commit}" *> $null
if ($LASTEXITCODE -ne 0) {
    "tagLookup=missing; fetching exact tag" | Add-Content -LiteralPath $resolutionLog -Encoding UTF8
    & git fetch --force origin "refs/tags/${Tag}:refs/tags/${Tag}"
    if ($LASTEXITCODE -ne 0) { throw "Unable to fetch prior tag $Tag from origin." }
}
$tagCommit = (& git rev-parse --verify "$Tag^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($tagCommit)) {
    throw "Prior tag does not resolve to a commit after fetch: $Tag"
}
"tagCommit=$tagCommit" | Add-Content -LiteralPath $resolutionLog -Encoding UTF8

function Get-MsiProductVersion([string]$Path) {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $installer, @($Path, 0))
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, @("SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ProductVersion'"))
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null) | Out-Null
    $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
    return $record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, 1)
}

$release = $null
try {
    $releaseJson = & gh api "repos/$repository/releases/tags/$Tag" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "gh api exited with code $LASTEXITCODE" }
    $release = $releaseJson | ConvertFrom-Json
    "releaseLookup=found" | Add-Content -LiteralPath $resolutionLog -Encoding UTF8
} catch {
    "releaseLookup=failed; error=$($_.Exception.Message)" | Add-Content -LiteralPath $resolutionLog -Encoding UTF8
    Write-Warning "Release lookup failed for $Tag; using an isolated worktree."
}

$asset = $release.assets | Where-Object {
    $_.name -match '(?i)NativeOffice.*\.msi$|LaTeXSnipper\.NativeOffice\.msi$'
} | Select-Object -First 1
if ($asset) {
    if ([string]::IsNullOrWhiteSpace($asset.digest) -or $asset.digest -notmatch '^sha256:[0-9a-fA-F]{64}$') {
        "releaseAsset=$($asset.name); digest=untrusted; chosenSource=worktree" | Add-Content -LiteralPath $resolutionLog -Encoding UTF8
        $asset = $null
    }
}
if ($asset) {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $destinationPath
    $actual = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = $asset.digest.Substring(7).ToLowerInvariant()
    if ($actual -ne $expected) { throw "Prior MSI SHA256 mismatch: expected=$expected actual=$actual" }
    $productVersion = Get-MsiProductVersion $destinationPath
    if ($productVersion -ne $Tag.TrimStart('v')) { throw "Prior release MSI ProductVersion mismatch: $productVersion" }
    "source=release`ntag=$Tag`nasset=$($asset.name)`nsha256=$actual`nProductVersion=$productVersion" |
        Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "prior-native-office-source.txt") -Encoding UTF8
    "chosenSource=release; msiSha256=$actual; ProductVersion=$productVersion" | Add-Content -LiteralPath $resolutionLog -Encoding UTF8
    return
}

$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$worktree = Join-Path $tempRoot "lso-wt-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$output = Join-Path $tempRoot "lso-out-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
try {
    & git -c core.longpaths=true worktree add --detach $worktree $Tag
    if ($LASTEXITCODE -ne 0) { throw "git worktree add failed for $Tag." }
    $priorPackage = Get-Content -Raw -LiteralPath (Join-Path $worktree "package.json") | ConvertFrom-Json
    $expectedVersion = $Tag.TrimStart('v')
    $worktreeCommit = (& git -C $worktree rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $worktreeCommit -ne $tagCommit) {
        throw "Prior worktree does not match the requested tag: tag=$Tag tagCommit=$tagCommit worktreeCommit=$worktreeCommit"
    }
    & nuget restore (Join-Path $worktree "apps\native-office\LaTeXSnipper.NativeOffice.sln")
    if ($LASTEXITCODE -ne 0) { throw "Prior Native Office NuGet restore failed with exit code $LASTEXITCODE." }

    # Historical tags such as v1.2.2 used a C++ PreBuildEvent to
    # generate OleVersion.h. Under solution-level parallel MSBuild,
    # ResourceCompile can run before that event, causing RC1015.
    $priorVersionScript = Join-Path $worktree "scripts\build-ole-version.ps1"
    $priorVersionHeader = Join-Path $worktree (
        "apps\native-office\" +
        "LaTeXSnipper.OleFormulaObjectNative\" +
        "res\OleVersion.h"
    )

    if (Test-Path -LiteralPath $priorVersionScript -PathType Leaf) {
        & powershell `
            -NoProfile `
            -ExecutionPolicy Bypass `
            -File $priorVersionScript `
            -Version $expectedVersion

        if ($LASTEXITCODE -ne 0) {
            throw (
                "Prior OLE version-header generation failed " +
                "with exit code $LASTEXITCODE."
            )
        }
    }

    if (-not (Test-Path -LiteralPath $priorVersionHeader -PathType Leaf)) {
        $versionMatch = [regex]::Match(
            $expectedVersion,
            '^(\d+)\.(\d+)\.(\d+)$'
        )
        if (-not $versionMatch.Success) {
            throw "Cannot synthesize prior OleVersion.h from version: $expectedVersion"
        }
        $major = $versionMatch.Groups[1].Value
        $minor = $versionMatch.Groups[2].Value
        $patch = $versionMatch.Groups[3].Value
        $headerDir = Split-Path -Parent $priorVersionHeader
        New-Item -ItemType Directory -Path $headerDir -Force | Out-Null
        $headerContent = @"
// Generated by resolve-prior-native-office-msi.ps1
#ifndef OLE_VERSION_H
#define OLE_VERSION_H
#define OLE_VERSION_MAJOR $major
#define OLE_VERSION_MINOR $minor
#define OLE_VERSION_PATCH $patch
#define OLE_VERSION_BUILD 0
#define OLE_FILEVERSION_RAW OLE_VERSION_MAJOR,OLE_VERSION_MINOR,OLE_VERSION_PATCH,OLE_VERSION_BUILD
#define OLE_PRODUCTVERSION_RAW OLE_VERSION_MAJOR,OLE_VERSION_MINOR,OLE_VERSION_PATCH,OLE_VERSION_BUILD
#define OLE_STRINGIZE_IMPL(x) #x
#define OLE_STRINGIZE(x) OLE_STRINGIZE_IMPL(x)
#define OLE_VERSION_STRING \
    OLE_STRINGIZE(OLE_VERSION_MAJOR) "." \
    OLE_STRINGIZE(OLE_VERSION_MINOR) "." \
    OLE_STRINGIZE(OLE_VERSION_PATCH) "." \
    OLE_STRINGIZE(OLE_VERSION_BUILD)
#endif
"@
        [System.IO.File]::WriteAllText(
            $priorVersionHeader,
            $headerContent,
            [System.Text.UTF8Encoding]::new($true)
        )
    }

    if (-not (Test-Path -LiteralPath $priorVersionHeader -PathType Leaf)) {
        throw "Prior OleVersion.h was not generated: $priorVersionHeader"
    }

    $headerHash = (Get-FileHash -LiteralPath $priorVersionHeader -Algorithm SHA256).Hash.ToLowerInvariant()
    "priorOleVersionHeader=$priorVersionHeader`npriorOleVersionHeaderSha256=$headerHash" |
        Add-Content -LiteralPath $resolutionLog -Encoding UTF8

    $priorBuildScript = Join-Path $worktree "apps\native-office\Installer\build.ps1"
    # Windows PowerShell 5 treats UTF-8 without BOM as ANSI. Preserve the tagged
    # source while adding an encoding marker inside the disposable worktree.
    $priorBuildText = [System.IO.File]::ReadAllText($priorBuildScript, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($priorBuildScript, $priorBuildText, [System.Text.UTF8Encoding]::new($true))
    & powershell -NoProfile -ExecutionPolicy Bypass -File $priorBuildScript `
        -Configuration Release -Version $expectedVersion -OutputDir $output
    if ($LASTEXITCODE -ne 0) { throw "Prior Native Office MSI build failed with exit code $LASTEXITCODE." }
    $msi = Join-Path $output "LaTeXSnipper.NativeOffice.msi"
    if (-not (Test-Path -LiteralPath $msi -PathType Leaf)) { throw "Prior worktree did not produce Native Office MSI." }
    Copy-Item -LiteralPath $msi -Destination $destinationPath -Force
    $sha = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $productVersion = Get-MsiProductVersion $destinationPath
    if ($productVersion -ne $expectedVersion) { throw "Prior worktree MSI ProductVersion mismatch: expected=$expectedVersion actual=$productVersion" }
    "source=worktree`ntag=$Tag`ntagCommit=$tagCommit`nworktreeCommit=$worktreeCommit`nsourcePackageVersion=$($priorPackage.version)`nmsiVersion=$expectedVersion`nsha256=$sha`nProductVersion=$productVersion" |
        Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "prior-native-office-source.txt") -Encoding UTF8
    "worktreeCommit=$worktreeCommit; chosenSource=worktree; msiSha256=$sha; ProductVersion=$productVersion" | Add-Content -LiteralPath $resolutionLog -Encoding UTF8
}
finally {
    if (Test-Path -LiteralPath $worktree) {
        & git -c core.longpaths=true worktree remove --force $worktree
    }
    $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $resolvedOutput = [System.IO.Path]::GetFullPath($output)
    if ($resolvedOutput.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedOutput)) {
        Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
    }
}
