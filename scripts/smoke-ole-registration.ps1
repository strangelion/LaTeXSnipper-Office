#!/usr/bin/env pwsh
<#
.SYNOPSIS
Checks only LaTeXSnipper OLE registry state in both registry views.
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

if ($failed) {
    exit 1
}

Write-Host "OLE registration smoke passed." -ForegroundColor Green
