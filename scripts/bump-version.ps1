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
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock"
)

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file)) {
        throw "File not found: $file"
    }
}

Write-Host "Bumping version to $Version" -ForegroundColor Green

# Use Node for JSON files so they remain UTF-8 without BOM and use stable formatting.
$updateJsonScript = @'
const fs = require("node:fs");

const [file, version, updateLockRoot] = process.argv.slice(1);
const source = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
const json = JSON.parse(source);

json.version = version;

if (updateLockRoot === "true") {
  if (!json.packages || !json.packages[""]) {
    throw new Error(`${file} does not contain packages[""]`);
  }

  json.packages[""].version = version;
}

fs.writeFileSync(
  file,
  `${JSON.stringify(json, null, 2)}\n`,
  "utf8",
);
'@

& node -e $updateJsonScript "package.json" $Version "false"
if ($LASTEXITCODE -ne 0) { throw "Failed to update package.json" }

& node -e $updateJsonScript "package-lock.json" $Version "true"
if ($LASTEXITCODE -ne 0) { throw "Failed to update package-lock.json" }

& node -e $updateJsonScript "src-tauri/tauri.conf.json" $Version "false"
if ($LASTEXITCODE -ne 0) { throw "Failed to update src-tauri/tauri.conf.json" }

# Update only the package version in Cargo.toml.
$cargoPath = "src-tauri/Cargo.toml"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$cargo = [System.IO.File]::ReadAllText(
    $cargoPath,
    [System.Text.Encoding]::UTF8
)

$versionRegex = [regex]::new(
    '(?m)^(version\s*=\s*)"[^"]+"'
)

if (-not $versionRegex.IsMatch($cargo)) {
    throw "Unable to locate package version in $cargoPath"
}

$cargo = $versionRegex.Replace(
    $cargo,
    {
        param($match)
        return $match.Groups[1].Value + '"' + $Version + '"'
    },
    1
)

[System.IO.File]::WriteAllText(
    $cargoPath,
    $cargo,
    $utf8NoBom
)

# Ask Cargo to synchronize the root package entry in Cargo.lock.
& cargo metadata `
    --manifest-path "src-tauri/Cargo.toml" `
    --format-version 1 `
    --no-deps |
    Out-Null

if ($LASTEXITCODE -ne 0) {
    throw "Failed to synchronize src-tauri/Cargo.lock"
}

# Verify all version sources are consistent.
$packageVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$packageLock = Get-Content package-lock.json -Raw | ConvertFrom-Json
$packageLockVersion = $packageLock.version
$packageLockRootVersion = $packageLock.packages."".version
$tauriVersion = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
$cargoText = Get-Content src-tauri/Cargo.toml -Raw
$cargoMatch = [regex]::Match($cargoText, '(?m)^version\s*=\s*"([^"]+)"')

if (-not $cargoMatch.Success) {
    throw "Unable to verify Cargo.toml version"
}

$cargoVersion = $cargoMatch.Groups[1].Value

$actualVersions = @{
    packageJson     = $packageVersion
    packageLock     = $packageLockVersion
    packageLockRoot = $packageLockRootVersion
    tauriConfig     = $tauriVersion
    cargoToml       = $cargoVersion
}

foreach ($entry in $actualVersions.GetEnumerator()) {
    if ($entry.Value -ne $Version) {
        throw (
            "Version synchronization failed: " +
            "$($entry.Key) expected=$Version actual=$($entry.Value)"
        )
    }
}

Write-Host "All version sources now equal $Version." -ForegroundColor Green

if ($DryRun) {
    Write-Host "`nDry run - no commit or tag created." -ForegroundColor Cyan
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
git push origin main
Write-Host "Pushed to origin/main." -ForegroundColor Green

if ($Tag -and -not $existing) {
    git push origin "v$Version"
    Write-Host "Pushed tag: v$Version" -ForegroundColor Green
}

Write-Host "`nDone! Version $Version" -ForegroundColor Green
