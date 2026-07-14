[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$StagingRoot,
    [Parameter(Mandatory = $true)][string]$DiagnosticsDirectory,
    [ValidateSet("Debug", "Release")][string]$ProbeConfiguration = "Release"
)

$ErrorActionPreference = "Continue"
$diagnostics = if ([System.IO.Path]::IsPathRooted($DiagnosticsDirectory)) {
    [System.IO.Path]::GetFullPath($DiagnosticsDirectory)
} else {
    [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $DiagnosticsDirectory))
}
New-Item -ItemType Directory -Force -Path $diagnostics | Out-Null
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$probeRoot = Join-Path $root "apps\native-office\OleActivationProbe\bin"
Get-ChildItem -LiteralPath $probeRoot -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object FullName, Length, LastWriteTimeUtc |
    Format-List | Out-File (Join-Path $diagnostics "probe-files.txt") -Encoding utf8

foreach ($view in @("32", "64")) {
    $registryPath = Join-Path $diagnostics "registry-x$view.txt"
    if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
        & reg.exe query "HKCU\Software\Classes\CLSID\{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}" /s "/reg:$view" *>&1 |
            Out-File $registryPath -Encoding utf8
    }
}

$dumpbin = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
if (-not $dumpbin) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswhere) {
        $candidate = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -find "VC\Tools\MSVC\**\bin\Hostx64\x64\dumpbin.exe" | Select-Object -First 1
        if ($candidate) { $dumpbin = Get-Item -LiteralPath $candidate }
    }
}

foreach ($name in @("OleFormulaObject.x86.dll", "OleFormulaObject.x64.dll")) {
    $dll = Join-Path $StagingRoot $name
    if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) { continue }
    Get-FileHash -LiteralPath $dll -Algorithm SHA256 | Format-List |
        Out-File (Join-Path $diagnostics "$name.sha256.txt") -Encoding utf8
    [System.Diagnostics.FileVersionInfo]::GetVersionInfo($dll) | Format-List |
        Out-File (Join-Path $diagnostics "$name.version.txt") -Encoding utf8
    if ($dumpbin) {
        & $dumpbin.FullName /nologo /headers $dll *>&1 | Out-File (Join-Path $diagnostics "$name.headers.txt") -Encoding utf8
        & $dumpbin.FullName /nologo /exports $dll *>&1 | Out-File (Join-Path $diagnostics "$name.exports.txt") -Encoding utf8
        & $dumpbin.FullName /nologo /dependents $dll *>&1 | Out-File (Join-Path $diagnostics "$name.dependents.txt") -Encoding utf8
    }
}
