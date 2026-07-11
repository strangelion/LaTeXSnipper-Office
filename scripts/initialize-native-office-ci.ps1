[CmdletBinding()]
param(
    [string]$DiagnosticsDirectory = "package-diagnostics",
    [string]$WixVersion = "5.0.2",
    [string]$NuGetSolution = "apps\native-office\LaTeXSnipper.NativeOffice.sln"
)

$ErrorActionPreference = "Stop"
$diagnostics = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $DiagnosticsDirectory))
New-Item -ItemType Directory -Force -Path $diagnostics | Out-Null

@(
    "RUNNER_OS=$env:RUNNER_OS"
    "RUNNER_ARCH=$env:RUNNER_ARCH"
    "ImageOS=$env:ImageOS"
    "ImageVersion=$env:ImageVersion"
    "RUNNER_NAME=$env:RUNNER_NAME"
) | Set-Content -LiteralPath (Join-Path $diagnostics "windows-runner-version.txt") -Encoding UTF8

& msbuild -version -nologo *>&1 |
    Tee-Object -FilePath (Join-Path $diagnostics "msbuild-version.txt")
if ($LASTEXITCODE -ne 0) { throw "MSBuild version query failed with exit code $LASTEXITCODE." }

& nuget help *>&1 | Select-Object -First 4 |
    Tee-Object -FilePath (Join-Path $diagnostics "nuget-version.txt")
if ($LASTEXITCODE -ne 0) { throw "NuGet version query failed with exit code $LASTEXITCODE." }

$toolTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$wixRoot = Join-Path $toolTemp "latexsnipper-wix-$WixVersion"
$wixExe = Join-Path $wixRoot "wix.exe"
if (-not (Test-Path -LiteralPath $wixExe -PathType Leaf)) {
    New-Item -ItemType Directory -Force -Path $wixRoot | Out-Null
    & dotnet tool install wix --tool-path $wixRoot --version $WixVersion
    if ($LASTEXITCODE -ne 0) { throw "Pinned WiX installation failed with exit code $LASTEXITCODE." }
}
if ($env:GITHUB_PATH) {
    $wixRoot | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8
} else {
    $env:PATH = "$wixRoot;$env:PATH"
}
$env:NATIVE_OFFICE_WIX_ROOT = $wixRoot
if ($env:GITHUB_ENV) {
    "NATIVE_OFFICE_WIX_ROOT=$wixRoot" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}
& $wixExe --version *>&1 | Tee-Object -FilePath (Join-Path $diagnostics "wix-version.txt")
if ($LASTEXITCODE -ne 0) { throw "WiX version query failed with exit code $LASTEXITCODE." }

& (Join-Path $PSScriptRoot "ensure-vsto-runtime.ps1") *>&1 |
    Tee-Object -FilePath (Join-Path $diagnostics "vsto-gac-status.log")
if ($LASTEXITCODE -ne 0) { throw "VSTO runtime preparation failed with exit code $LASTEXITCODE." }

& nuget restore $NuGetSolution *>&1 |
    Tee-Object -FilePath (Join-Path $diagnostics "nuget-restore.log")
if ($LASTEXITCODE -ne 0) { throw "Native Office NuGet restore failed with exit code $LASTEXITCODE." }
