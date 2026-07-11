[CmdletBinding()]
param(
    [string]$StagingRoot = "",
    [string[]]$WindowsPackageRoots = @(),
    [string[]]$NonWindowsPackageRoots = @()
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

if ($WindowsPackageRoots.Count -gt 0) {
    if ([string]::IsNullOrWhiteSpace($StagingRoot)) { throw "StagingRoot is required for Windows package verification" }
    $staging = (Resolve-Path -LiteralPath $StagingRoot).Path
    $expected = @{
        "OleFormulaObject.x86.dll" = @{ Hash = (Get-FileHash -LiteralPath (Join-Path $staging "OleFormulaObject.x86.dll") -Algorithm SHA256).Hash; Machine = 0x014c }
        "OleFormulaObject.x64.dll" = @{ Hash = (Get-FileHash -LiteralPath (Join-Path $staging "OleFormulaObject.x64.dll") -Algorithm SHA256).Hash; Machine = 0x8664 }
    }
    $dumpbin = Resolve-Dumpbin
    if ([string]::IsNullOrWhiteSpace($dumpbin)) { throw "dumpbin.exe is required for export and dependency verification" }
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

foreach ($rootValue in $WindowsPackageRoots) {
    $root = (Resolve-Path -LiteralPath $rootValue).Path
    $forbidden = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
        $_.Extension -match '^\.(pfx|p12|pem|key|pdb)$'
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
            if ([string]::IsNullOrWhiteSpace($version)) { throw "DLL file version is missing: $($file.FullName)" }
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

Write-Host "Package content hashes, versions, PE machine values, and forbidden-file rules verified."
