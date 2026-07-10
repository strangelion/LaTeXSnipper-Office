#!/usr/bin/env pwsh
<#
.SYNOPSIS
Checks LaTeXSnipper OLE COM registration in both registry views.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
$failed = $false
$progId = "LaTeXSnipper.Formula.1"
$versionIndependentProgId = "LaTeXSnipper.Formula"
$clsid = "{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}"

function Invoke-RegQuery {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [string]$ValueName = "",
        [Parameter(Mandatory = $true)][ValidateSet("32", "64")][string]$View
    )

    $args = @("query", $Key, "/reg:$View")
    if (-not [string]::IsNullOrWhiteSpace($ValueName)) {
        $args += @("/v", $ValueName)
    } else {
        $args += "/ve"
    }

    $output = & reg.exe @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL [$View] $Key $(if ($ValueName) { "/v $ValueName" } else { "/ve" })" -ForegroundColor Red
        Write-Host ($output -join "`n")
        return $null
    }

    Write-Host "OK   [$View] $Key $(if ($ValueName) { "/v $ValueName" } else { "/ve" })" -ForegroundColor Green
    return ($output -join "`n")
}

function Get-RegStringValue {
    param([string]$Text)

    $lines = $Text -split "`r?`n"
    foreach ($line in $lines) {
        if ($line -match "REG_SZ\s+(.+)$") {
            return $Matches[1].Trim()
        }
    }
    return $null
}

function Test-OleActivation {
    param(
        [Parameter(Mandatory = $true)][string]$PowerShellExe,
        [Parameter(Mandatory = $true)][ValidateSet("32", "64")][string]$View
    )

    if (-not (Test-Path -LiteralPath $PowerShellExe -PathType Leaf)) {
        Write-Host "FAIL [$View] PowerShell host not found: $PowerShellExe" -ForegroundColor Red
        return $false
    }

    # Run in a process of the exact COM bitness. Registry keys and DLL paths
    # alone do not prove that CoCreateInstance can load the in-proc server.
    $activationScript = @'
$ErrorActionPreference = 'Stop'
$type = [Type]::GetTypeFromProgID('LaTeXSnipper.Formula.1', $true)
$object = [Activator]::CreateInstance($type)
if ($object.IsInitialized() -ne $false) {
    throw 'A newly activated empty object must not be initialized'
}
[Console]::Out.WriteLine('OLE_ACTIVATION_OK')
[Console]::Out.Flush()
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($activationScript))
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $PowerShellExe
    $startInfo.Arguments = "-NoProfile -NonInteractive -EncodedCommand $encoded"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        Write-Host "FAIL [$View] Cannot start activation probe" -ForegroundColor Red
        return $false
    }
    if (-not $process.WaitForExit(10000)) {
        $process.Kill()
        [void]$process.WaitForExit(5000)
        Write-Host "FAIL [$View] COM activation / IDispatch probe timed out" -ForegroundColor Red
        return $false
    }
    $output = $process.StandardOutput.ReadToEnd()
    $errorOutput = $process.StandardError.ReadToEnd()
    if ($process.ExitCode -ne 0 -or $output -notmatch 'OLE_ACTIVATION_OK') {
        Write-Host "FAIL [$View] COM activation / IDispatch probe failed" -ForegroundColor Red
        if ($output) { Write-Host $output }
        if ($errorOutput) { Write-Host $errorOutput }
        return $false
    }

    Write-Host "OK   [$View] COM activation and IDispatch probe passed" -ForegroundColor Green
    return $true
}

foreach ($view in @("64", "32")) {
    $progClsidOutput = Invoke-RegQuery -Key "HKCU\Software\Classes\$progId\CLSID" -View $view
    $viClsidOutput = Invoke-RegQuery -Key "HKCU\Software\Classes\$versionIndependentProgId\CLSID" -View $view
    $inprocOutput = Invoke-RegQuery -Key "HKCU\Software\Classes\CLSID\$clsid\InprocServer32" -View $view
    $threadingOutput = Invoke-RegQuery -Key "HKCU\Software\Classes\CLSID\$clsid\InprocServer32" -ValueName "ThreadingModel" -View $view

    foreach ($item in @($progClsidOutput, $viClsidOutput, $inprocOutput, $threadingOutput)) {
        if ($null -eq $item) {
            $failed = $true
        }
    }
    if ($null -eq $inprocOutput) {
        continue
    }

    $dllPath = Get-RegStringValue -Text $inprocOutput
    if ([string]::IsNullOrWhiteSpace($dllPath) -or -not (Test-Path -LiteralPath $dllPath -PathType Leaf)) {
        Write-Host "FAIL [$view] InprocServer32 DLL missing: $dllPath" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "OK   [$view] InprocServer32 DLL exists: $dllPath" -ForegroundColor Green
    }

    $threading = Get-RegStringValue -Text $threadingOutput
    if ($threading -ne "Apartment") {
        Write-Host "FAIL [$view] ThreadingModel expected Apartment, got $threading" -ForegroundColor Red
        $failed = $true
    }
}

$powerShell64 = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$powerShell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-OleActivation -PowerShellExe $powerShell64 -View "64")) {
    $failed = $true
}
if (-not (Test-OleActivation -PowerShellExe $powerShell32 -View "32")) {
    $failed = $true
}

if ($failed) {
    exit 1
}

Write-Host "OLE registration smoke passed." -ForegroundColor Green
