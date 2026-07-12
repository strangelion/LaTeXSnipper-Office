# Bump version across all manifests, commit, tag, and push.
# Usage:
#   .\scripts\bump-version.ps1 1.2.6
#   .\scripts\bump-version.ps1 -Version 1.2.6 -Tag

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$Tag,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid semantic version: $Version (expected MAJOR.MINOR.PATCH)"
}

$files = @(
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml"
)

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file)) {
        throw "File not found: $file"
    }
}

Write-Host "Bumping version to $Version" -ForegroundColor Green

# Detect current version from package.json
$current = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "Current version: $current" -ForegroundColor Yellow

if ($current -eq $Version) {
    Write-Host "Version unchanged, skipping." -ForegroundColor Cyan
    exit 0
}

# Update package.json
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 100 | Set-Content package.json -Encoding UTF8

# Update tauri.conf.json
$tauri = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$tauri.version = $Version
$tauri | ConvertTo-Json -Depth 100 | Set-Content src-tauri/tauri.conf.json -Encoding UTF8

# Update Cargo.toml (line-based, no TOML library needed)
$cargo = Get-Content src-tauri/Cargo.toml -Raw
$cargo = $cargo -replace '^(version\s*=\s*)"[^"]+"', "`$1`"$Version`""
Set-Content src-tauri/Cargo.toml -Value $cargo -Encoding UTF8 -NoNewline

Write-Host "Updated:" -ForegroundColor Green
foreach ($file in $files) {
    Write-Host "  $file" -ForegroundColor Gray
}

if ($DryRun) {
    Write-Host "`nDry run — no commit or tag created." -ForegroundColor Cyan
    git diff --stat
    exit 0
}

# Commit
git add @files
git commit -m "chore: bump version to $Version"
Write-Host "`nCommitted." -ForegroundColor Green

# Tag
if ($Tag) {
    $tagName = "v$Version"
    $existing = git tag --list $tagName
    if ($existing) {
        Write-Host "Tag $tagName already exists, skipping tag." -ForegroundColor Yellow
    } else {
        git tag $tagName
        Write-Host "Created tag: $tagName" -ForegroundColor Green
    }
}

# Push
$pushArgs = @("push", "origin", "main")
git push @pushArgs
Write-Host "Pushed to origin/main." -ForegroundColor Green

if ($Tag -and -not $existing) {
    git push origin "v$Version"
    Write-Host "Pushed tag: v$Version" -ForegroundColor Green
}

Write-Host "`nDone! Version $Version" -ForegroundColor Green
