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
    "src-tauri/Cargo.lock",
    "apps/browser-extension/package.json",
    "apps/browser-extension/manifest.chrome.json",
    "apps/browser-extension/manifest.firefox.json",
    "apps/wps/manifest.json",
    "apps/wps/package.json",
    "src-tauri/resources/Ecosystem",
    "src-tauri/resources/Obsidian"
)

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file)) {
        throw "File not found: $file"
    }
}

Write-Host "Bumping version to $Version" -ForegroundColor Green

# Use Node for JSON files so they remain UTF-8 without BOM and use stable formatting.
$tempScript = Join-Path $env:TEMP "bump-version-$([guid]::NewGuid().ToString('N').Substring(0,8)).cjs"
try {
    @'
const fs = require("node:fs");

const [file, version, updateLockRoot] = process.argv.slice(2);
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
'@ | Set-Content -LiteralPath $tempScript -Encoding UTF8 -NoNewline

    & node $tempScript "package.json" $Version "false"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update package.json" }

    & node $tempScript "package-lock.json" $Version "true"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update package-lock.json" }

    & node $tempScript "src-tauri/tauri.conf.json" $Version "false"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update src-tauri/tauri.conf.json" }

    & node $tempScript "apps/browser-extension/package.json" $Version "false"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update apps/browser-extension/package.json" }

    & node $tempScript "apps/browser-extension/manifest.chrome.json" $Version "false"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update apps/browser-extension/manifest.chrome.json" }

    & node $tempScript "apps/browser-extension/manifest.firefox.json" $Version "false"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update apps/browser-extension/manifest.firefox.json" }

    & node $tempScript "apps/wps/manifest.json" $Version "false"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update apps/wps/manifest.json" }

    & node $tempScript "apps/wps/package.json" $Version "false"
    if ($LASTEXITCODE -ne 0) { throw "Failed to update apps/wps/package.json" }
} finally {
    if (Test-Path -LiteralPath $tempScript) { Remove-Item -LiteralPath $tempScript -Force }
}

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

# Cargo metadata does not reliably rewrite the local root package version in Cargo.lock,
# so update that exact package entry before asking Cargo to validate the manifest.
$cargoLockPath = "src-tauri/Cargo.lock"
$cargoLock = [System.IO.File]::ReadAllText(
    $cargoLockPath,
    [System.Text.Encoding]::UTF8
)
$cargoLockVersionRegex = [regex]::new(
    '(?ms)(^\[\[package\]\]\r?\nname = "latexsnipper-office"\r?\nversion = ")[^"]+("$)'
)
$cargoLockMatches = $cargoLockVersionRegex.Matches($cargoLock)
if ($cargoLockMatches.Count -ne 1) {
    throw "Expected exactly one latexsnipper-office package entry in $cargoLockPath, found $($cargoLockMatches.Count)"
}
$cargoLock = $cargoLockVersionRegex.Replace(
    $cargoLock,
    {
        param($match)
        return $match.Groups[1].Value + $Version + $match.Groups[2].Value
    },
    1
)
[System.IO.File]::WriteAllText(
    $cargoLockPath,
    $cargoLock,
    $utf8NoBom
)

# Ask Cargo to validate the synchronized manifest and lock file.
& cargo metadata `
    --manifest-path "src-tauri/Cargo.toml" `
    --format-version 1 `
    --no-deps |
    Out-Null

if ($LASTEXITCODE -ne 0) {
    throw "Failed to synchronize src-tauri/Cargo.lock"
}

# Rebuild every staged ecosystem payload before version verification and commit.
& npm run build:ecosystem
if ($LASTEXITCODE -ne 0) { throw "Failed to build ecosystem resources" }

& npm run stage:ecosystem
if ($LASTEXITCODE -ne 0) { throw "Failed to stage ecosystem resources" }

# Verify all version sources are consistent using Node (avoids PowerShell JSON limits).
$verifyScript = @"
const fs = require("node:fs");

const version = process.argv[2];
const errors = [];

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (pkg.version !== version) errors.push("package.json: " + pkg.version);

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
if (lock.version !== version) errors.push("package-lock version: " + lock.version);
if (lock.packages && lock.packages[""] && lock.packages[""].version !== version) {
  errors.push("package-lock packages root: " + lock.packages[""].version);
}

const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (tauri.version !== version) errors.push("tauri.conf.json: " + tauri.version);

const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const m = cargo.match(/^(version\s*=\s*)"([^"]+)"/m);
if (!m || m[2] !== version) errors.push("Cargo.toml: " + (m ? m[2] : "not found"));

const browserExt = JSON.parse(fs.readFileSync("apps/browser-extension/package.json", "utf8"));
if (browserExt.version !== version) errors.push("browser-extension/package.json: " + browserExt.version);

const chromeManifest = JSON.parse(fs.readFileSync("apps/browser-extension/manifest.chrome.json", "utf8"));
if (chromeManifest.version !== version) errors.push("browser-extension/manifest.chrome.json: " + chromeManifest.version);

const firefoxManifest = JSON.parse(fs.readFileSync("apps/browser-extension/manifest.firefox.json", "utf8"));
if (firefoxManifest.version !== version) errors.push("browser-extension/manifest.firefox.json: " + firefoxManifest.version);

const wpsManifest = JSON.parse(fs.readFileSync("apps/wps/manifest.json", "utf8"));
if (wpsManifest.version !== version) errors.push("wps/manifest.json: " + wpsManifest.version);

const wpsPkg = JSON.parse(fs.readFileSync("apps/wps/package.json", "utf8"));
if (wpsPkg.version !== version) errors.push("wps/package.json: " + wpsPkg.version);

for (const target of ["chrome", "firefox"]) {
  const root = "src-tauri/resources/Ecosystem/browser/" + target;
  const manifest = JSON.parse(fs.readFileSync(root + "/manifest.json", "utf8"));
  if (manifest.version !== version) {
    errors.push(target + " staged manifest: " + manifest.version);
  }
  const provenance = JSON.parse(fs.readFileSync(root + "/provenance.json", "utf8"));
  if (provenance.extensionVersion !== version) {
    errors.push(target + " staged provenance: " + provenance.extensionVersion);
  }
}

if (errors.length) {
  console.error("Version mismatch: " + errors.join(", "));
  process.exit(1);
}

console.log("All version sources equal " + version);
"@

$tempVerify = Join-Path $env:TEMP "verify-version-$([guid]::NewGuid().ToString('N').Substring(0,8)).cjs"
try {
    $verifyScript | Set-Content -LiteralPath $tempVerify -Encoding UTF8 -NoNewline
    & node $tempVerify $Version
    if ($LASTEXITCODE -ne 0) { throw "Version verification failed" }
} finally {
    if (Test-Path -LiteralPath $tempVerify) { Remove-Item -LiteralPath $tempVerify -Force }
}

if ($DryRun) {
    Write-Host "`nDry run - no commit or tag created." -ForegroundColor Cyan
    git diff --stat
    exit 0
}

# Commit
git add @files
git commit -m "chore: bump version to $Version"
Write-Host "`nCommitted." -ForegroundColor Green

& npm run check:ecosystem-drift
if ($LASTEXITCODE -ne 0) {
    throw "Committed ecosystem resources do not match the generated payloads; refusing to tag or push."
}

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
