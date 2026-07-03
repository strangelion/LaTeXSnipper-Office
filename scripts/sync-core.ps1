# sync-core.ps1
# 从远程拉取 latexsnipper-core 最新提交，更新主仓库的 submodule 引用
# 用法: .\scripts\sync-core.ps1
#
# 工作流:
#   1. 在 latexsnipper-core 仓库编辑代码、推送
#   2. 在 LaTeXSnipper-Office 仓库运行此脚本
#   3. 脚本自动更新 submodule 引用并推送

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path $root -Parent
$corePath = Join-Path $repoRoot "src-tauri\latexsnipper-core"

Write-Host "=== Sync latexsnipper-core submodule ===" -ForegroundColor Cyan

# 1. 更新 submodule 到远程最新
Write-Host "`n[1/4] Fetching latest from remote..." -ForegroundColor Yellow
Set-Location $corePath
$before = git rev-parse --short HEAD

# 拉取远程最新提交
git fetch origin --quiet

# 获取 origin/main 的 HEAD
$remoteHead = git rev-parse --short origin/main

if ($before -eq $remoteHead) {
    Write-Host "  Already up to date ($before)" -ForegroundColor Green
    Write-Host "`nNo changes. Done." -ForegroundColor Cyan
    Set-Location $repoRoot
    exit 0
}

# Checkout 到 origin/main
git checkout origin/main --quiet
$after = git rev-parse --short HEAD
Write-Host "  $before -> $after" -ForegroundColor Green

# 2. 回到主仓库
Set-Location $repoRoot

# 3. 提交 submodule 引用更新
Write-Host "`n[2/3] Committing submodule update..." -ForegroundColor Yellow
git add src-tauri/latexsnipper-core
$commitMsg = "chore: sync latexsnipper-core -> $after"
git commit -m $commitMsg
Write-Host "  $commitMsg" -ForegroundColor Green

# 4. 推送
Write-Host "`n[3/3] Pushing..." -ForegroundColor Yellow
git push
Write-Host "  Done" -ForegroundColor Green

Write-Host "`n=== Synced to $after ===" -ForegroundColor Cyan
