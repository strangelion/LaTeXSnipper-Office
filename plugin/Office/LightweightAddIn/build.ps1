param(
    [ValidateSet("x64", "x86")]
    [string] $Platform = "x64"
)

$ErrorActionPreference = "Stop"

$frameworkDir = if ($Platform -eq "x64") {
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
} else {
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319"
}

$csc = Join-Path $frameworkDir "csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
    throw "csc.exe was not found: $csc"
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "bin\$Platform\Release"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$source = Join-Path $root "LaTeXSnipperOfficeAddIn.cs"
$output = Join-Path $outDir "LaTeXSnipper.OfficeAddIn.dll"

& $csc `
    /nologo `
    /target:library `
    /platform:$Platform `
    /optimize+ `
    /out:$output `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Web.Extensions.dll `
    /reference:System.Windows.Forms.dll `
    /unsafe `
    $source

if ($LASTEXITCODE -ne 0) {
    throw "Compilation failed with exit code $LASTEXITCODE"
}

Write-Host "Built $output"
