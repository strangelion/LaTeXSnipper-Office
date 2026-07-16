#!/usr/bin/env pwsh
<#
.SYNOPSIS
Checks Native Office VSTO add-in registry entries after install.
#>

[CmdletBinding()]
param(
    [ValidateSet("Word", "Excel", "PowerPoint", "Visio")]
    [string[]]$Hosts = @("Word", "Excel", "PowerPoint", "Visio")
)

$ErrorActionPreference = "Continue"
$failed = $false

function Invoke-RegQuery {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$ValueName,
        [Parameter(Mandatory = $true)][ValidateSet("32", "64")][string]$View
    )

    $output = & reg.exe query $Key /v $ValueName "/reg:$View" 2>&1
    $exit = $LASTEXITCODE
    if ($exit -ne 0) {
        Write-Host "FAIL [$View] $Key /v $ValueName" -ForegroundColor Red
        Write-Host ($output -join "`n")
        return $null
    }

    Write-Host "OK   [$View] $Key /v $ValueName" -ForegroundColor Green
    return ($output -join "`n")
}

function Get-RegDword {
    param([string]$Text)

    if ($Text -match "0x([0-9A-Fa-f]+)") {
        return [Convert]::ToInt32($Matches[1], 16)
    }
    return $null
}

foreach ($hostName in $Hosts) {
    $addinId = "LaTeXSnipper.NativeOffice.$hostName"
    $key = "HKCU\Software\Microsoft\Office\$hostName\Addins\$addinId"
    foreach ($view in @("64", "32")) {
        $loadOutput = Invoke-RegQuery -Key $key -ValueName "LoadBehavior" -View $view
        if ($null -eq $loadOutput) {
            $failed = $true
            continue
        }

        $loadBehavior = Get-RegDword -Text $loadOutput
        if ($loadBehavior -ne 3) {
            Write-Host "FAIL [$view] $hostName LoadBehavior expected 3, got $loadBehavior" -ForegroundColor Red
            $failed = $true
        }

        $manifestOutput = Invoke-RegQuery -Key $key -ValueName "Manifest" -View $view
        if ($null -eq $manifestOutput) {
            $failed = $true
            continue
        }

        if ($manifestOutput -notmatch "file:///(.+?\.vsto)\|vstolocal") {
            Write-Host "FAIL [$view] $hostName Manifest is not a file:///...vsto|vstolocal path" -ForegroundColor Red
            $failed = $true
            continue
        }

        $manifestPath = [Uri]::UnescapeDataString($Matches[1]).Replace("/", "\")
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            Write-Host "FAIL [$view] $hostName manifest file missing: $manifestPath" -ForegroundColor Red
            $failed = $true
        } else {
            Write-Host "OK   [$view] $hostName manifest exists: $manifestPath" -ForegroundColor Green
        }
    }
}

if ($failed) {
    exit 1
}

Write-Host "Native Office registry smoke passed." -ForegroundColor Green
