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
$release = $null
try {
    $release = (& gh api "repos/$repository/releases/tags/$Tag" | ConvertFrom-Json)
} catch {
    Write-Warning "Release lookup failed for $Tag; using an isolated worktree."
}

$asset = $release.assets | Where-Object {
    $_.name -match '(?i)NativeOffice.*\.msi$|LaTeXSnipper\.NativeOffice\.msi$'
} | Select-Object -First 1
if ($asset) {
    if ([string]::IsNullOrWhiteSpace($asset.digest) -or $asset.digest -notmatch '^sha256:[0-9a-fA-F]{64}$') {
        throw "Release asset has no trustworthy SHA256 digest: $($asset.name)"
    }
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $destinationPath
    $actual = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = $asset.digest.Substring(7).ToLowerInvariant()
    if ($actual -ne $expected) { throw "Prior MSI SHA256 mismatch: expected=$expected actual=$actual" }
    "source=release`ntag=$Tag`nasset=$($asset.name)`nsha256=$actual" |
        Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "prior-native-office-source.txt") -Encoding UTF8
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
    $tagCommit = (& git rev-list -n 1 $Tag).Trim()
    $worktreeCommit = (& git -C $worktree rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $worktreeCommit -ne $tagCommit) {
        throw "Prior worktree does not match the requested tag: tag=$Tag tagCommit=$tagCommit worktreeCommit=$worktreeCommit"
    }
    & nuget restore (Join-Path $worktree "apps\native-office\LaTeXSnipper.NativeOffice.sln")
    if ($LASTEXITCODE -ne 0) { throw "Prior Native Office NuGet restore failed with exit code $LASTEXITCODE." }
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
    "source=worktree`ntag=$Tag`ncommit=$worktreeCommit`nsourcePackageVersion=$($priorPackage.version)`nmsiVersion=$expectedVersion`nsha256=$sha" |
        Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "prior-native-office-source.txt") -Encoding UTF8
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
