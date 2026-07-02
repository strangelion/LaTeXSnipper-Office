$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $root "..\..\..")

& (Join-Path $root "build.ps1") -Platform x64

$source = Join-Path $root "bin\x64\Release\LaTeXSnipper.OfficeAddIn.dll"
$targetDir = Join-Path $repoRoot "src-tauri\resources\Office\LightweightAddIn"
$target = Join-Path $targetDir "LaTeXSnipper.OfficeAddIn.dll"

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force

Write-Host "Staged $target"
