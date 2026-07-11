[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$StagingRoot,
    [string]$DiagnosticsDirectory = "vsto-diagnostics",
    [ValidateSet("Debug", "Release")][string]$ProbeConfiguration = "Release",
    [switch]$ExistingRegistration
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DiagnosticsDirectory | Out-Null
$activationLog = Join-Path $DiagnosticsDirectory "activation.log"
try {
    & (Join-Path $PSScriptRoot "build-native-office-probes.ps1") -Configuration $ProbeConfiguration *>&1 |
        Tee-Object -FilePath (Join-Path $DiagnosticsDirectory "probe-build.log")
    if ($LASTEXITCODE -ne 0) { throw "Activation probe build failed with exit code $LASTEXITCODE." }

    if ($ExistingRegistration) {
        $root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
        $pairs = @(
            @((Join-Path $root "apps\native-office\OleActivationProbe\bin\x64\$ProbeConfiguration\OleActivationProbe.exe"), (Join-Path $StagingRoot "OleFormulaObject.x64.dll")),
            @((Join-Path $root "apps\native-office\OleActivationProbe\bin\Win32\$ProbeConfiguration\OleActivationProbe.exe"), (Join-Path $StagingRoot "OleFormulaObject.x86.dll"))
        )
        & (Join-Path $PSScriptRoot "smoke-ole-registration.ps1") *>&1 |
            Tee-Object -FilePath (Join-Path $DiagnosticsDirectory "registry-smoke.log")
        if ($LASTEXITCODE -ne 0) { throw "Installed Native Office registry smoke failed." }
        foreach ($view in @("64", "32")) {
            & reg.exe query "HKCU\Software\Classes\CLSID\{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}" /s "/reg:$view" *>&1 |
                Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "registry-x$view.txt") -Encoding UTF8
        }
        foreach ($pair in $pairs) {
            $view = if ($pair[0] -match '\\x64\\') { "64" } else { "32" }
            $stderrPath = Join-Path $DiagnosticsDirectory "probe-x$view-stderr.txt"
            $stdout = & $pair[0] $pair[1] 2> $stderrPath
            $probeExitCode = $LASTEXITCODE
            $stdout | Set-Content -LiteralPath (Join-Path $DiagnosticsDirectory "probe-x$view-stdout.json") -Encoding UTF8
            $stdout | Tee-Object -FilePath $activationLog -Append
            if ($probeExitCode -ne 0) { throw "Installed Native Office activation probe failed: $($pair[0])" }
        }
    } else {
        & (Join-Path $PSScriptRoot "smoke-ole-activation.ps1") `
            -StagingRoot $StagingRoot `
            -ProbeConfiguration $ProbeConfiguration `
            -DiagnosticsDirectory $DiagnosticsDirectory *>&1 |
            Tee-Object -FilePath $activationLog
        if ($LASTEXITCODE -ne 0) { throw "Dual-bitness Native Office activation smoke failed with exit code $LASTEXITCODE." }
    }
}
finally {
    & (Join-Path $PSScriptRoot "collect-native-office-diagnostics.ps1") `
        -StagingRoot $StagingRoot -DiagnosticsDirectory $DiagnosticsDirectory -ProbeConfiguration $ProbeConfiguration
}
