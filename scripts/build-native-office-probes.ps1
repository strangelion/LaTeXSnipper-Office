[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\apps\native-office\OleActivationProbe\OleActivationProbe.vcxproj"
foreach ($platform in @("Win32", "x64")) {
    & msbuild $project /m /t:Build "/p:Configuration=$Configuration" "/p:Platform=$platform" /v:minimal
    if ($LASTEXITCODE -ne 0) {
        throw "OleActivationProbe build failed: platform=$platform configuration=$Configuration exitCode=$LASTEXITCODE"
    }
}

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$paths = @(
    (Join-Path $root "apps\native-office\OleActivationProbe\bin\x64\$Configuration\OleActivationProbe.exe"),
    (Join-Path $root "apps\native-office\OleActivationProbe\bin\Win32\$Configuration\OleActivationProbe.exe")
)
foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "OleActivationProbe build succeeded without expected output: $path"
    }
    Write-Host "OleActivationProbe ready: $path"
}
