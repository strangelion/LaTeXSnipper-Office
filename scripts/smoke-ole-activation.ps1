param(
    [Parameter(Mandatory = $true)]
    [string]$StagingRoot,
    [int]$TimeoutSeconds = 15,
    [ValidateSet("Debug", "Release")]
    [string]$ProbeConfiguration = "Release",
    [string]$DiagnosticsDirectory = ""
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
    $registryView = if ($View -eq "64") {
        [Microsoft.Win32.RegistryView]::Registry64
    }
    else {
        [Microsoft.Win32.RegistryView]::Registry32
    }
    $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $registryView)
    try {
        foreach ($key in @(
            "Software\Classes\CLSID\$clsid",
            "Software\Classes\$progId",
            "Software\Classes\$versionIndependentProgId"
        )) {
            $existing = $root.OpenSubKey($key, $false)
            if ($null -eq $existing) {
                Write-Verbose "Registry cleanup skipped missing key: operation=delete view=$View key=HKCU\$key"
                continue
            }
            $existing.Dispose()
            $root.DeleteSubKeyTree($key, $false)
        }
    }
    catch {
        throw "Registry cleanup failed: operation=delete view=$View error=$($_.Exception.Message)"
    }
    finally {
        $root.Dispose()
    }
    $global:LASTEXITCODE = 0
}

function Backup-View([string]$View) {
    foreach ($key in @(
        "HKCU\Software\Classes\CLSID\$clsid",
        "HKCU\Software\Classes\$progId",
        "HKCU\Software\Classes\$versionIndependentProgId"
    )) {
        try {
            & reg.exe query $key "/reg:$View" 2>$null | Out-Null
            $exists = $LASTEXITCODE -eq 0
        }
        catch {
            $exists = $false
            Write-Verbose "Registry backup skipped missing key: operation=query view=$View key=$key exitCode=$LASTEXITCODE error=$($_.Exception.Message)"
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
    $global:LASTEXITCODE = 0
}

function Invoke-NativeActivationProbe([string]$ProbePath, [string]$DllPath, [string]$View) {
    if (-not (Test-Path -LiteralPath $ProbePath -PathType Leaf)) {
        throw "OleActivationProbe is missing for $View-bit activation: $ProbePath"
    }
    $process = $null
    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $ProbePath
        $startInfo.Arguments = '"' + $DllPath.Replace('"', '\"') + '"'
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw "$View-bit OleActivationProbe could not be started."
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            [void]$process.WaitForExit(5000)
            throw "$View-bit OleActivationProbe timed out."
        }
        $process.WaitForExit()
        $probeExitCode = $process.ExitCode
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if (-not [string]::IsNullOrWhiteSpace($DiagnosticsDirectory)) {
            $stdout | Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "probe-x$View-stdout.json") -Encoding UTF8
            $stderr | Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "probe-x$View-stderr.txt") -Encoding UTF8
        }
        $diagnostic = $null
        try {
            $diagnostic = $stdout | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw "$View-bit OleActivationProbe returned invalid JSON. stdout=$stdout stderr=$stderr"
        }
        Write-Host $stdout.Trim()
        if ($probeExitCode -ne 0 -or $diagnostic.success -ne $true) {
            throw "$View-bit OleActivationProbe failed with exit code $probeExitCode. stdout=$stdout stderr=$stderr"
        }
        Write-Host "OLE native activation probe passed for $View-bit host."
    }
    finally {
        if ($null -ne $process) {
            $process.Dispose()
        }
    }
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$probe64 = Join-Path $repositoryRoot "apps\native-office\OleActivationProbe\bin\x64\$ProbeConfiguration\OleActivationProbe.exe"
$probe32 = Join-Path $repositoryRoot "apps\native-office\OleActivationProbe\bin\Win32\$ProbeConfiguration\OleActivationProbe.exe"
if (-not [string]::IsNullOrWhiteSpace($DiagnosticsDirectory)) {
    New-Item -ItemType Directory -Force -Path $DiagnosticsDirectory | Out-Null
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
    if (-not [string]::IsNullOrWhiteSpace($DiagnosticsDirectory)) {
        foreach ($view in @("64", "32")) {
            & reg.exe query "HKCU\Software\Classes\CLSID\$clsid" /s "/reg:$view" *>&1 |
                Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "registry-x$view.txt") -Encoding UTF8
        }
    }
    Invoke-NativeActivationProbe $probe64 $dll64 "64"
    Invoke-NativeActivationProbe $probe32 $dll32 "32"
}
finally {
    Remove-View "64"
    Remove-View "32"
    Restore-RegistryBackups
    $global:LASTEXITCODE = 0
}

Write-Host "OLE dual-bitness native activation smoke passed."
exit 0
