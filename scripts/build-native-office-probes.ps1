[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$MsBuildPath = ""
)

$ErrorActionPreference = "Stop"
$resolvedMsBuild = $null
if ($MsBuildPath) {
    if (-not (Test-Path -LiteralPath $MsBuildPath -PathType Leaf)) {
        throw "Specified MSBuild path does not exist: $MsBuildPath"
    }
    $resolvedMsBuild = (Resolve-Path -LiteralPath $MsBuildPath).Path
}
if (-not $resolvedMsBuild) {
    $fromPath = Get-Command msbuild.exe -ErrorAction SilentlyContinue
    if ($fromPath) { $resolvedMsBuild = $fromPath.Source }
}
if (-not $resolvedMsBuild) {
    $vswhereCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"),
        (Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    foreach ($vswhere in $vswhereCandidates) {
        $candidate = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild `
            -find "MSBuild\Current\Bin\MSBuild.exe" | Select-Object -First 1
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $resolvedMsBuild = $candidate
            break
        }
    }
}
if (-not $resolvedMsBuild) {
    foreach ($major in @("18", "17")) {
        foreach ($edition in @("Community", "Professional", "Enterprise", "BuildTools")) {
            $candidate = Join-Path $env:ProgramFiles `
                "Microsoft Visual Studio\$major\$edition\MSBuild\Current\Bin\MSBuild.exe"
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $resolvedMsBuild = $candidate
                break
            }
        }
        if ($resolvedMsBuild) { break }
    }
}
if (-not $resolvedMsBuild) {
    throw "MSBuild.exe was not found. Install Visual Studio Build Tools with C++ support."
}

$project = Join-Path $PSScriptRoot "..\apps\native-office\OleActivationProbe\OleActivationProbe.vcxproj"
foreach ($platform in @("Win32", "x64")) {
    & $resolvedMsBuild $project /m /t:Build "/p:Configuration=$Configuration" "/p:Platform=$platform" /v:minimal
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
