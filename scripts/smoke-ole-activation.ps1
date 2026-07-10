param(
    [Parameter(Mandatory = $true)]
    [string]$StagingRoot,
    [int]$TimeoutSeconds = 15
)

$ErrorActionPreference = "Stop"
$clsid = "{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}"
$progId = "LaTeXSnipper.Formula.1"
$versionIndependentProgId = "LaTeXSnipper.Formula"
$staging = (Resolve-Path -LiteralPath $StagingRoot).Path
$dll64 = Join-Path $staging "OleFormulaObject.x64.dll"
$dll32 = Join-Path $staging "OleFormulaObject.x86.dll"
$registryBackups = @()

foreach ($dll in @($dll64, $dll32)) {
    if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) {
        throw "OLE activation DLL is missing: $dll"
    }
}

function Invoke-Reg([string[]]$Arguments) {
    & reg.exe @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "reg.exe failed: $($Arguments -join ' ')" }
}

function Register-View([string]$View, [string]$DllPath) {
    $base = "HKCU\Software\Classes"
    Invoke-Reg @("add", "$base\$progId", "/ve", "/t", "REG_SZ", "/d", "LaTeXSnipper Formula Object", "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\$progId\CLSID", "/ve", "/t", "REG_SZ", "/d", $clsid, "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\$versionIndependentProgId\CLSID", "/ve", "/t", "REG_SZ", "/d", $clsid, "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\$versionIndependentProgId\CurVer", "/ve", "/t", "REG_SZ", "/d", $progId, "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\CLSID\$clsid", "/ve", "/t", "REG_SZ", "/d", "LaTeXSnipper Formula Object", "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\CLSID\$clsid\InprocServer32", "/ve", "/t", "REG_SZ", "/d", $DllPath, "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\CLSID\$clsid\InprocServer32", "/v", "ThreadingModel", "/t", "REG_SZ", "/d", "Apartment", "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\CLSID\$clsid\Insertable", "/ve", "/t", "REG_SZ", "/d", "", "/f", "/reg:$View")
    Invoke-Reg @("add", "$base\CLSID\$clsid\Verb\0", "/ve", "/t", "REG_SZ", "/d", "Edit Formula, 0, 2", "/f", "/reg:$View")
}

function Remove-View([string]$View) {
    foreach ($key in @(
        "HKCU\Software\Classes\CLSID\$clsid",
        "HKCU\Software\Classes\$progId",
        "HKCU\Software\Classes\$versionIndependentProgId"
    )) {
        try {
            & reg.exe delete $key /f "/reg:$View" 2>$null | Out-Null
        }
        catch {
            # Missing keys are expected before registration and after partial cleanup.
        }
    }
}

function Backup-View([string]$View) {
    foreach ($key in @(
        "HKCU\Software\Classes\CLSID\$clsid",
        "HKCU\Software\Classes\$progId",
        "HKCU\Software\Classes\$versionIndependentProgId"
    )) {
        $exists = $false
        try {
            & reg.exe query $key "/reg:$View" 2>$null | Out-Null
            $exists = $LASTEXITCODE -eq 0
        }
        catch {
            $exists = $false
        }
        if (-not $exists) { continue }
        $backup = Join-Path $env:TEMP "latexsnipper-ole-reg-$View-$([guid]::NewGuid().ToString('N')).reg"
        & reg.exe export $key $backup /y "/reg:$View" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Cannot back up existing registry key: $key ($View-bit)" }
        $script:registryBackups += [pscustomobject]@{ View = $View; Path = $backup }
    }
}

function Restore-RegistryBackups {
    foreach ($backup in $registryBackups) {
        try {
            & reg.exe import $backup.Path "/reg:$($backup.View)" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "reg.exe import failed" }
        }
        finally {
            Remove-Item -LiteralPath $backup.Path -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-Activation([string]$HostPath, [string]$View) {
    if (-not (Test-Path -LiteralPath $HostPath -PathType Leaf)) {
        throw "cscript host is missing for $View-bit activation: $HostPath"
    }
    $scriptPath = Join-Path $env:TEMP "latexsnipper-ole-activation-$View-$PID.js"
    $stdoutPath = "$scriptPath.stdout"
    $stderrPath = "$scriptPath.stderr"
    try {
        @"
var formula = new ActiveXObject("LaTeXSnipper.Formula.1");
if (formula.IsInitialized() !== false) {
  WScript.Echo("OLE_ACTIVATION_BAD_INITIAL_STATE");
  WScript.Quit(3);
}
WScript.Echo("OLE_ACTIVATION_OK");
"@ | Set-Content -LiteralPath $scriptPath -Encoding ASCII
        $process = Start-Process -FilePath $HostPath -ArgumentList @("//Nologo", $scriptPath) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            [void]$process.WaitForExit(5000)
            throw "$View-bit OLE activation timed out."
        }
        $process.WaitForExit()
        $process.Refresh()
        $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
        if ($stdout -notmatch "OLE_ACTIVATION_OK") {
            throw "$View-bit OLE activation failed: $stdout $stderr"
        }
        Write-Host "OLE activation passed for $View-bit host."
    }
    finally {
        Remove-Item -LiteralPath $scriptPath,$stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
    }
}

try {
    Backup-View "64"
    Backup-View "32"
    Remove-View "64"
    Remove-View "32"
    Register-View "64" $dll64
    Register-View "32" $dll32
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "smoke-ole-registration.ps1")
    if ($LASTEXITCODE -ne 0) { throw "OLE registration smoke failed." }
    Invoke-Activation (Join-Path $env:SystemRoot "System32\cscript.exe") "64"
    Invoke-Activation (Join-Path $env:SystemRoot "SysWOW64\cscript.exe") "32"
}
finally {
    Remove-View "64"
    Remove-View "32"
    Restore-RegistryBackups
}
