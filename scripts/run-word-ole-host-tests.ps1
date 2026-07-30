[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$StagingRoot,
    [string]$FixtureContract = "",
    [string]$EvidenceDirectory = "",
    [string]$SvgDirectory = "",
    [string]$HostTestExecutable = ""
)

$ErrorActionPreference = "Stop"
$clsid = "{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}"
$progId = "LaTeXSnipper.Formula.1"
$versionIndependentProgId = "LaTeXSnipper.Formula"
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$staging = (Resolve-Path -LiteralPath $StagingRoot).Path
$dll = Join-Path $staging "OleFormulaObject.x64.dll"

if ([string]::IsNullOrWhiteSpace($FixtureContract)) {
    $FixtureContract = Join-Path $repositoryRoot `
        "apps\native-office\LaTeXSnipper.Word.HostTests\fixtures\word-ole-acceptance-v1.json"
}
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    $EvidenceDirectory = Join-Path $repositoryRoot "src-tauri\target\word-ole-host-evidence"
}
if ([string]::IsNullOrWhiteSpace($SvgDirectory)) {
    $SvgDirectory = Join-Path $repositoryRoot "apps\native-office\fixtures\mathjax-svg"
}
if ([string]::IsNullOrWhiteSpace($HostTestExecutable)) {
    $HostTestExecutable = Join-Path $repositoryRoot `
        "apps\native-office\LaTeXSnipper.Word.HostTests\bin\x64\Release\LaTeXSnipper.Word.HostTests.exe"
}

foreach ($requiredFile in @($dll, $FixtureContract, $HostTestExecutable)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Word OLE host-test file is missing: $requiredFile"
    }
}
if (-not (Test-Path -LiteralPath $SvgDirectory -PathType Container)) {
    throw "MathJax SVG fixture directory is missing: $SvgDirectory"
}
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null

$registryBackups = @()
$registryKeys = @(
    "HKCU\Software\Classes\CLSID\$clsid",
    "HKCU\Software\Classes\$progId",
    "HKCU\Software\Classes\$versionIndependentProgId"
)

function Invoke-Reg([string[]]$Arguments) {
    & reg.exe @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "reg.exe failed: $($Arguments -join ' ')"
    }
}

function Backup-Registration {
    foreach ($key in $registryKeys) {
        & reg.exe query $key "/reg:64" 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            continue
        }
        $backup = Join-Path $env:TEMP `
            "latexsnipper-word-ole-reg-$([guid]::NewGuid().ToString('N')).reg"
        & reg.exe export $key $backup /y "/reg:64" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Cannot back up existing 64-bit registry key: $key"
        }
        $script:registryBackups += $backup
    }
    $global:LASTEXITCODE = 0
}

function Remove-Registration {
    $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::Registry64
    )
    try {
        foreach ($subkey in @(
            "Software\Classes\CLSID\$clsid",
            "Software\Classes\$progId",
            "Software\Classes\$versionIndependentProgId"
        )) {
            $existing = $root.OpenSubKey($subkey, $false)
            if ($null -eq $existing) {
                continue
            }
            $existing.Dispose()
            $root.DeleteSubKeyTree($subkey, $false)
        }
    }
    finally {
        $root.Dispose()
        $global:LASTEXITCODE = 0
    }
}

function Register-TestHandler {
    $base = "HKCU\Software\Classes"
    Invoke-Reg @("add", "$base\$progId", "/ve", "/t", "REG_SZ", "/d",
        "LaTeXSnipper Formula Object", "/f", "/reg:64")
    Invoke-Reg @("add", "$base\$progId\CLSID", "/ve", "/t", "REG_SZ", "/d",
        $clsid, "/f", "/reg:64")
    Invoke-Reg @("add", "$base\$versionIndependentProgId\CLSID", "/ve", "/t",
        "REG_SZ", "/d", $clsid, "/f", "/reg:64")
    Invoke-Reg @("add", "$base\$versionIndependentProgId\CurVer", "/ve", "/t",
        "REG_SZ", "/d", $progId, "/f", "/reg:64")
    Invoke-Reg @("add", "$base\CLSID\$clsid", "/ve", "/t", "REG_SZ", "/d",
        "LaTeXSnipper Formula Object", "/f", "/reg:64")
    Invoke-Reg @("add", "$base\CLSID\$clsid\InprocServer32", "/ve", "/t",
        "REG_SZ", "/d", $dll, "/f", "/reg:64")
    Invoke-Reg @("add", "$base\CLSID\$clsid\InprocServer32", "/v",
        "ThreadingModel", "/t", "REG_SZ", "/d", "Apartment", "/f", "/reg:64")
    Invoke-Reg @("add", "$base\CLSID\$clsid\Insertable", "/ve", "/t", "REG_SZ",
        "/d", "", "/f", "/reg:64")
    Invoke-Reg @("add", "$base\CLSID\$clsid\Verb\0", "/ve", "/t", "REG_SZ",
        "/d", "Edit Formula, 0, 2", "/f", "/reg:64")
}

function Restore-Registration {
    Remove-Registration
    foreach ($backup in $registryBackups) {
        try {
            & reg.exe import $backup "/reg:64" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Cannot restore registry backup: $backup"
            }
        }
        finally {
            Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
        }
    }
    $global:LASTEXITCODE = 0
}

try {
    Backup-Registration
    Remove-Registration
    Register-TestHandler
    $previousNativeOleLog = $env:LATEXSNIPPER_OLE_LOG
    $env:LATEXSNIPPER_OLE_LOG = "1"
    & $HostTestExecutable $FixtureContract $EvidenceDirectory --ole $SvgDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Word OLE host acceptance failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousNativeOleLog) {
        Remove-Item Env:\LATEXSNIPPER_OLE_LOG -ErrorAction SilentlyContinue
    }
    else {
        $env:LATEXSNIPPER_OLE_LOG = $previousNativeOleLog
    }
    Restore-Registration
}

Write-Host "Word OLE host acceptance passed; registration was restored."
exit 0
