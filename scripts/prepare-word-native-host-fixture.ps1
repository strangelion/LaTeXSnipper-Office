[CmdletBinding()]
param(
    [string]$FixtureContract = "",
    [string]$OutputFixture = "",
    [string]$CoreRoot = "",
    [string]$CoreCli = "",
    [switch]$SkipCoreBuild
)

$ErrorActionPreference = "Stop"
$arguments = @(
    (Join-Path $PSScriptRoot "prepare-word-native-host-fixture.mjs")
)
if (-not [string]::IsNullOrWhiteSpace($FixtureContract)) {
    $arguments += @("--fixture", $FixtureContract)
}
if (-not [string]::IsNullOrWhiteSpace($OutputFixture)) {
    $arguments += @("--output", $OutputFixture)
}
if (-not [string]::IsNullOrWhiteSpace($CoreRoot)) {
    $arguments += @("--core-root", $CoreRoot)
}
if (-not [string]::IsNullOrWhiteSpace($CoreCli)) {
    $arguments += @("--core-cli", $CoreCli)
}
if ($SkipCoreBuild) {
    $arguments += "--skip-core-build"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Word native fixture preparation failed with exit code $LASTEXITCODE."
}
