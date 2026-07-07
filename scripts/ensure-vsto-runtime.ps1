# Ensures the VSTO 2010 runtime required by MSBuild VSTO manifest generation is available.
# The runtime installs Microsoft.VisualStudio.Tools.Applications.Hosting (v10.0) into the .NET Framework GAC.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$runningOnWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
)

if (-not $runningOnWindows) {
    throw "The VSTO runtime can only be installed on Windows."
}

function Test-VstoHostingAssembly {
    $gacRoots = @(
        (Join-Path $env:WINDIR "Microsoft.NET\assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Hosting"),
        (Join-Path $env:WINDIR "assembly\GAC_MSIL\Microsoft.VisualStudio.Tools.Applications.Hosting")
    )

    foreach ($root in $gacRoots) {
        $assembly = Get-ChildItem -LiteralPath $root -Recurse `
            -Filter "Microsoft.VisualStudio.Tools.Applications.Hosting.dll" `
            -File -ErrorAction SilentlyContinue |
            Select-Object -First 1

        if ($assembly) {
            return $true
        }
    }

    return $false
}

if (Test-VstoHostingAssembly) {
    Write-Host "VSTO runtime hosting assembly: already installed" -ForegroundColor Green
    exit 0
}

$tempRoot = if ($env:RUNNER_TEMP) {
    $env:RUNNER_TEMP
} elseif ($env:TEMP) {
    $env:TEMP
} else {
    [System.IO.Path]::GetTempPath()
}

$installer = Join-Path $tempRoot "vstor_redist.exe"
$runtimeUrl = "https://go.microsoft.com/fwlink/?LinkId=261103"

Write-Host "Downloading VSTO runtime redistributable..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $runtimeUrl -OutFile $installer

Write-Host "Installing VSTO runtime..." -ForegroundColor Cyan
$process = Start-Process -FilePath $installer `
    -ArgumentList "/quiet", "/norestart" `
    -Wait -PassThru

if ($process.ExitCode -notin @(0, 3010)) {
    throw "VSTO runtime installer failed with exit code $($process.ExitCode)."
}

if (-not (Test-VstoHostingAssembly)) {
    throw "VSTO runtime installation completed but Microsoft.VisualStudio.Tools.Applications.Hosting.dll is still unavailable."
}

Write-Host "VSTO runtime hosting assembly: installed successfully" -ForegroundColor Green
