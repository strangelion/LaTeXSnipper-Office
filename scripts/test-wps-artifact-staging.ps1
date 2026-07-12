$ErrorActionPreference = "Stop"
$version = "ci-contract"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "latexsnipper-wps-test-$([guid]::NewGuid().ToString('N'))"
$source = Join-Path $tempRoot "source"
$invalidSource = Join-Path $tempRoot "invalid"
$diagnostics = Join-Path $tempRoot "diagnostics"
$destination = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "apps\wps\dist\latexsnipper-wps_$version"
$required = @(
    "index.html", "main.js", "manifest.xml", "ribbon.xml", "proxy.js", "server.js",
    "js/command-layer.js", "js/ribbon.js", "js/util.js", "ui/taskpane.html"
)
try {
    foreach ($root in @($source, $invalidSource)) {
        foreach ($relative in $required) {
            if ($root -eq $invalidSource -and $relative -eq "ui/taskpane.html") { continue }
            $path = Join-Path $root ($relative -replace '/', [System.IO.Path]::DirectorySeparatorChar)
            New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
            $content = if ($relative -eq "manifest.xml") { "<Version>$version</Version>" } else { $relative }
            Set-Content -LiteralPath $path -Value $content -Encoding UTF8
        }
    }
    $validZip = Join-Path $tempRoot "latexsnipper-wps_$version.zip"
    Compress-Archive -Path (Join-Path $source "*") -DestinationPath $validZip
    & (Join-Path $PSScriptRoot "stage-release-artifacts.ps1") `
        -WpsZip $validZip -Version $version -Destination $destination -DiagnosticsDirectory $diagnostics | Out-Null
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $destination ($relative -replace '/', [System.IO.Path]::DirectorySeparatorChar)))) {
            throw "Valid WPS artifact staging lost required file: $relative"
        }
    }

    $invalidZip = Join-Path $tempRoot "invalid.zip"
    Compress-Archive -Path (Join-Path $invalidSource "*") -DestinationPath $invalidZip
    Copy-Item $invalidZip $validZip -Force
    $failedAsExpected = $false
    try {
        & (Join-Path $PSScriptRoot "stage-release-artifacts.ps1") `
            -WpsZip $validZip -Version $version -Destination $destination -DiagnosticsDirectory $diagnostics | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch "WPS artifact missing required file: ui/taskpane.html") { throw }
        $failedAsExpected = $true
    }
    if (-not $failedAsExpected) { throw "Incomplete WPS artifact unexpectedly passed validation" }

    $resourceStaging = Join-Path $tempRoot "resource-staging"
    $packageRoots = @(
        (Join-Path $tempRoot "package-msi"),
        (Join-Path $tempRoot "package-nsis")
    )
    foreach ($name in @("OfficeJS", "WPS", "Obsidian", "Ecosystem")) {
        $sourceFile = Join-Path $resourceStaging "$name\payload.txt"
        New-Item -ItemType Directory -Force (Split-Path -Parent $sourceFile) | Out-Null
        Set-Content -LiteralPath $sourceFile -Value "$name-current-run" -Encoding UTF8
        foreach ($packageRoot in $packageRoots) {
            $target = Join-Path $packageRoot "app\resources\$name"
            New-Item -ItemType Directory -Force $target | Out-Null
            Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $target "payload.txt")
        }
    }
    $nestedWps = Join-Path $resourceStaging "Ecosystem\wps\plugin.txt"
    New-Item -ItemType Directory -Force (Split-Path -Parent $nestedWps) | Out-Null
    Set-Content -LiteralPath $nestedWps -Value "ecosystem-wps" -Encoding UTF8
    foreach ($packageRoot in $packageRoots) {
        $target = Join-Path $packageRoot "app\resources\Ecosystem\wps"
        New-Item -ItemType Directory -Force $target | Out-Null
        Copy-Item -LiteralPath $nestedWps -Destination (Join-Path $target "plugin.txt")
    }
    Set-Content -LiteralPath (Join-Path $resourceStaging "provenance.json") -Value '{"schemaVersion":1}' -Encoding UTF8
    foreach ($packageRoot in $packageRoots) {
        Copy-Item -LiteralPath (Join-Path $resourceStaging "provenance.json") -Destination (Join-Path $packageRoot "app\resources\provenance.json")
    }
    & (Join-Path $PSScriptRoot "verify-package-contents.ps1") -ResourceStagingRoot $resourceStaging -ResourcePackageRoots $packageRoots

    Set-Content -LiteralPath (Join-Path $packageRoots[1] "app\resources\WPS\payload.txt") -Value "stale-wps" -Encoding UTF8
    $hashFailedAsExpected = $false
    try {
        & (Join-Path $PSScriptRoot "verify-package-contents.ps1") -ResourceStagingRoot $resourceStaging -ResourcePackageRoots $packageRoots
    } catch {
        if ($_.Exception.Message -notmatch "Resource hash mismatch: resource=WPS relative=payload.txt") { throw }
        $hashFailedAsExpected = $true
    }
    if (-not $hashFailedAsExpected) { throw "Stale packaged WPS unexpectedly passed the resource hash chain" }
    Write-Host "WPS artifact staging contract tests passed."
}
finally {
    $repoDist = [System.IO.Path]::GetFullPath((Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "apps\wps\dist"))
    $resolvedDestination = [System.IO.Path]::GetFullPath($destination)
    if ($resolvedDestination.StartsWith($repoDist + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path $resolvedDestination)) {
        Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
    }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
