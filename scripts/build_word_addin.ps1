param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Building LaTeXSnipper.dotm from scratch (no external template)..." -ForegroundColor Cyan

$pyArgs = @()
if ($SkipInstall) { $pyArgs += "--no-install" }

# Use miniconda Python (has pywin32)
$python = "C:\Users\WangWenXuan\miniconda3\python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}

& $python (Join-Path $scriptRoot "build_word_addin.py") @pyArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}
