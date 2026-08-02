# Bump version across all manifests, rebuild plugins, verify, commit, tag, and push.
#
# Usage:
#   .\scripts\bump-version.ps1 -Version 1.6.0 -DryRun        # true read-only preview
#   .\scripts\bump-version.ps1 -Version 1.6.0 -NoCommit      # apply, don't commit
#   .\scripts\bump-version.ps1 -Version 1.6.0 -NoPush        # commit, don't push
#   .\scripts\bump-version.ps1 -Version 1.6.0 -Tag           # full release with tag
#
# Parameters:
#   -Version   semver string (supports pre-release: 1.6.0-rc.2, 1.7.0-beta.1+build.3)
#   -DryRun    print what WOULD change; modifies NOTHING, runs NO builds
#   -NoCommit  apply version bumps + rebuild plugins, but don't git commit
#   -NoPush    apply + commit, but don't git push
#   -Tag       create and push a v<version> git tag (requires -NoPush absent)

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$DryRun,
    [switch]$NoCommit,
    [switch]$NoPush,
    [switch]$Tag
)

$ErrorActionPreference = "Stop"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# ── 1. Pre-flight validation ──

if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$') {
    throw "Invalid semantic version: $Version`nExpected: MAJOR.MINOR.PATCH[-prerelease][+build]`nExamples: 1.6.0, 1.6.0-rc.2, 1.7.0-beta.1+build.3"
}

# Check we're in the repo root.
if (-not (Test-Path -LiteralPath "package.json" -PathType Leaf)) {
    throw "package.json not found — run this script from the repository root"
}

# Read current version for DryRun display.
$currentPkg = Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json
$currentVersion = $currentPkg.version

if ($DryRun) {
    Write-Host "=== Dry Run: bump $currentVersion -> $Version ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Files that will be modified:" -ForegroundColor Yellow
    $dryRunFiles = @(
        "package.json",
        "package-lock.json",
        "src-tauri/tauri.conf.json",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
        "apps/browser-extension/package.json",
        "apps/browser-extension/package-lock.json",
        "apps/browser-extension/manifest.chrome.json",
        "apps/browser-extension/manifest.firefox.json",
        "apps/wps/manifest.json",
        "apps/wps/package.json",
        "contracts/resources.v1.json  (WPS manifest.xml hash)",
        "src-tauri/resources/Ecosystem/   (rebuilt + staged)",
        "src-tauri/resources/Obsidian/    (rebuilt + staged)",
        "src-tauri/resources/WPS/         (rebuilt + staged)"
    )
    foreach ($f in $dryRunFiles) {
        Write-Host "  $f"
    }
    Write-Host ""
    Write-Host "Actions that will run:" -ForegroundColor Yellow
    Write-Host "  1. Bump version strings in all manifests"
    Write-Host "  2. Sync apps/browser-extension/package-lock.json"
    Write-Host "  3. Rebuild ecosystem (Obsidian + VS Code + Browser)"
    Write-Host "  4. Rebuild WPS plugin"
    Write-Host "  5. Stage ecosystem + WPS resources"
    Write-Host "  6. Update contracts/resources.v1.json hash"
    Write-Host "  7. Verify all version sources equal $Version"
    Write-Host "  8. Run check:ecosystem-drift & check:resource-drift"
    Write-Host "  9. Run test:frontend & cargo test"
    if (-not $NoCommit) {
        Write-Host " 10. git commit"
        if (-not $NoPush) {
            Write-Host " 11. git push origin $(git branch --show-current)"
            if ($Tag) {
                Write-Host " 12. git tag v$Version + push"
            }
        }
    }
    Write-Host ""
    Write-Host "Pre-flight checks:" -ForegroundColor Yellow

    # Workspace cleanliness.
    $status = git status --porcelain
    if ($status) {
        Write-Host "  WARNING: workspace is not clean. Uncommitted changes:" -ForegroundColor Yellow
        Write-Host ($status -split "`n" | ForEach-Object { "    $_" })
    } else {
        Write-Host "  OK: workspace is clean" -ForegroundColor Green
    }

    # Branch check.
    $branch = git branch --show-current
    if ($branch -eq "main") {
        Write-Host "  OK: on branch 'main'" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: not on 'main' (current: $branch)" -ForegroundColor Yellow
    }

    # Remote status.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>&1
    $upstreamOk = ($LASTEXITCODE -eq 0)
    if ($upstreamOk -and $upstream) {
        $behindStr = git rev-list --count 'HEAD..@{u}' 2>&1
        if ($LASTEXITCODE -eq 0) {
            $behindNum = [int](($behindStr -join '').Trim())
            if ($behindNum -gt 0) {
                Write-Host "  WARNING: local is behind remote by $behindNum commits" -ForegroundColor Yellow
            } else {
                Write-Host "  OK: up to date with remote" -ForegroundColor Green
            }
        } else {
            Write-Host "  NOTE: could not determine remote status" -ForegroundColor Gray
        }
    } else {
        Write-Host "  NOTE: no upstream tracking branch configured" -ForegroundColor Gray
    }
    $ErrorActionPreference = $prevEAP

    # Tag existence.
    if ($Tag) {
        $tagName = "v$Version"
        if (git tag --list $tagName) {
            Write-Host "  WARNING: tag $tagName already exists locally" -ForegroundColor Yellow
        }
        if (git ls-remote --tags origin "refs/tags/$tagName" 2>$null) {
            Write-Host "  WARNING: tag $tagName already exists on remote" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "No files were modified." -ForegroundColor Cyan
    exit 0
}

# ── 2. Real pre-flight checks ──

Write-Host "=== Bumping version $currentVersion -> $Version ===" -ForegroundColor Green

$branch = git branch --show-current
if ($branch -ne "main") {
    Write-Host "WARNING: not on 'main' branch (current: $branch)" -ForegroundColor Yellow
    Write-Host "Press Ctrl+C to abort, or wait 3 seconds to continue..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}

$status = git status --porcelain
if ($status) {
    Write-Host "WARNING: workspace is not clean:" -ForegroundColor Yellow
    Write-Host $status
    Write-Host "Press Ctrl+C to abort, or wait 3 seconds to continue..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}

if ($Tag) {
    $tagName = "v$Version"
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $remoteTag = git ls-remote --tags origin "refs/tags/$tagName" 2>&1
    $ErrorActionPreference = $prevEAP
    if ($remoteTag) {
        throw "Tag $tagName already exists on remote. Aborting."
    }
    if (git tag --list $tagName) {
        Write-Host "WARNING: local tag $tagName exists (but not on remote). Will replace." -ForegroundColor Yellow
    }
}

# ── 3. Bump version in JSON files ──

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

fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
'@ | Set-Content -LiteralPath $tempScript -Encoding UTF8 -NoNewline

    $jsonFiles = @(
        @{ Path = "package.json"; LockRoot = $false },
        @{ Path = "package-lock.json"; LockRoot = $true },
        @{ Path = "src-tauri/tauri.conf.json"; LockRoot = $false },
        @{ Path = "apps/browser-extension/package.json"; LockRoot = $false },
        @{ Path = "apps/browser-extension/manifest.chrome.json"; LockRoot = $false },
        @{ Path = "apps/browser-extension/manifest.firefox.json"; LockRoot = $false },
        @{ Path = "apps/wps/manifest.json"; LockRoot = $false },
        @{ Path = "apps/wps/package.json"; LockRoot = $false }
    )

    foreach ($entry in $jsonFiles) {
        $lockFlag = if ($entry.LockRoot) { "true" } else { "false" }
        & node $tempScript $entry.Path $Version $lockFlag
        if ($LASTEXITCODE -ne 0) { throw "Failed to update $($entry.Path)" }
    }
} finally {
    if (Test-Path -LiteralPath $tempScript) { Remove-Item -LiteralPath $tempScript -Force }
}

# ── 4. Bump Cargo.toml ──

$cargoPath = "src-tauri/Cargo.toml"
$cargo = [System.IO.File]::ReadAllText($cargoPath, [System.Text.Encoding]::UTF8)

$versionRegex = [regex]::new('(?m)^(version\s*=\s*)"[^"]+"')
if (-not $versionRegex.IsMatch($cargo)) {
    throw "Unable to locate package version in $cargoPath"
}
$cargo = $versionRegex.Replace($cargo, {
    param($match)
    return $match.Groups[1].Value + '"' + $Version + '"'
}, 1)

[System.IO.File]::WriteAllText($cargoPath, $cargo, $utf8NoBom)

# ── 5. Bump Cargo.lock ──

$cargoLockPath = "src-tauri/Cargo.lock"
$cargoLock = [System.IO.File]::ReadAllText($cargoLockPath, [System.Text.Encoding]::UTF8)
$cargoLockVersionRegex = [regex]::new(
    '(?ms)(^\[\[package\]\]\r?\nname = "latexsnipper-office"\r?\nversion = ")[^"]+("$)'
)
$cargoLockMatches = $cargoLockVersionRegex.Matches($cargoLock)
if ($cargoLockMatches.Count -ne 1) {
    throw "Expected exactly one latexsnipper-office package entry in $cargoLockPath, found $($cargoLockMatches.Count)"
}
$cargoLock = $cargoLockVersionRegex.Replace($cargoLock, {
    param($match)
    return $match.Groups[1].Value + $Version + $match.Groups[2].Value
}, 1)
[System.IO.File]::WriteAllText($cargoLockPath, $cargoLock, $utf8NoBom)

# Validate Cargo manifest.
& cargo metadata --manifest-path "src-tauri/Cargo.toml" --format-version 1 --no-deps | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to synchronize src-tauri/Cargo.lock" }

# ── 6. Sync browser-extension package-lock.json ──

Write-Host "Syncing apps/browser-extension/package-lock.json..." -ForegroundColor Gray
$beLockPath = "apps/browser-extension/package-lock.json"
if (Test-Path -LiteralPath $beLockPath -PathType Leaf) {
    $tempBeScript = Join-Path $env:TEMP "bump-version-be-$([guid]::NewGuid().ToString('N').Substring(0,8)).cjs"
    try {
        @'
const fs = require("node:fs");
const [file, version] = process.argv.slice(2);
const json = JSON.parse(fs.readFileSync(file, "utf8"));
json.version = version;
if (json.packages && json.packages[""]) {
  json.packages[""].version = version;
}
fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
'@ | Set-Content -LiteralPath $tempBeScript -Encoding UTF8 -NoNewline
        & node $tempBeScript $beLockPath $Version
        if ($LASTEXITCODE -ne 0) { throw "Failed to update $beLockPath" }
    } finally {
        if (Test-Path -LiteralPath $tempBeScript) { Remove-Item -LiteralPath $tempBeScript -Force }
    }
    Write-Host "  $beLockPath -> $Version" -ForegroundColor Gray
} else {
    Write-Host "  $beLockPath not found, skipping" -ForegroundColor Yellow
}

# ── 7. Rebuild and stage plugins ──

Write-Host "Building ecosystem plugins..." -ForegroundColor Gray
& npm run build:ecosystem
if ($LASTEXITCODE -ne 0) { throw "Failed to build ecosystem resources" }

& npm run stage:ecosystem
if ($LASTEXITCODE -ne 0) { throw "Failed to stage ecosystem resources" }

Write-Host "Building WPS plugin..." -ForegroundColor Gray
& npm run build:wps
if ($LASTEXITCODE -ne 0) { throw "Failed to build WPS plugin" }

# Stage WPS resources (allow NativeOffice MSI to be absent).
Write-Host "Staging WPS resources..." -ForegroundColor Gray
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& node scripts/stage-resources.js 2>&1
$stageOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEAP
if (-not $stageOk) {
    Write-Host "WARNING: stage:resources failed (likely Native Office MSI not built). WPS files may need manual staging." -ForegroundColor Yellow
    Write-Host "Run 'npm run build:native-office' if you need the MSI, then re-run stage:resources." -ForegroundColor Yellow
}

# ── 8. Update resource contract hash for WPS manifest.xml ──

Write-Host "Updating resource contract..." -ForegroundColor Gray
$contractPath = "contracts/resources.v1.json"
if (Test-Path -LiteralPath $contractPath -PathType Leaf) {
    $tempHashScript = Join-Path $env:TEMP "bump-version-hash-$([guid]::NewGuid().ToString('N').Substring(0,8)).cjs"
    try {
        @'
const fs = require("node:fs");
const crypto = require("node:crypto");

const [contractPath, wpsXmlPath] = process.argv.slice(2);

// Compute normalized hash of WPS manifest.xml.
const wpsBytes = Buffer.from(
  fs.readFileSync(wpsXmlPath, "utf8").replaceAll("\r\n", "\n"),
  "utf8"
);
const hash = crypto.createHash("sha256").update(wpsBytes).digest("hex");

const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const key = "src-tauri/resources/WPS/manifest.xml";
if (!contract.files || !contract.files[key]) {
  throw new Error(`${key} not found in resource contract`);
}
const oldHash = contract.files[key];
contract.files[key] = hash;
fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

console.log(`  WPS manifest.xml hash: ${oldHash.substring(0, 12)}... -> ${hash.substring(0, 12)}...`);
'@ | Set-Content -LiteralPath $tempHashScript -Encoding UTF8 -NoNewline
        & node $tempHashScript $contractPath "src-tauri/resources/WPS/manifest.xml"
        if ($LASTEXITCODE -ne 0) { throw "Failed to update resource contract hash" }
    } finally {
        if (Test-Path -LiteralPath $tempHashScript) { Remove-Item -LiteralPath $tempHashScript -Force }
    }
} else {
    Write-Host "  $contractPath not found, skipping" -ForegroundColor Yellow
}

# ── 9. Verify all version sources ──

Write-Host "Verifying version consistency..." -ForegroundColor Gray
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

const bePkg = JSON.parse(fs.readFileSync("apps/browser-extension/package.json", "utf8"));
if (bePkg.version !== version) errors.push("browser-extension/package.json: " + bePkg.version);

const beLockPath = "apps/browser-extension/package-lock.json";
if (fs.existsSync(beLockPath)) {
  const beLock = JSON.parse(fs.readFileSync(beLockPath, "utf8"));
  if (beLock.version !== version) errors.push("browser-extension/package-lock.json version: " + beLock.version);
  if (beLock.packages && beLock.packages[""] && beLock.packages[""].version !== version) {
    errors.push("browser-extension/package-lock.json root: " + beLock.packages[""].version);
  }
}

const chromeManifest = JSON.parse(fs.readFileSync("apps/browser-extension/manifest.chrome.json", "utf8"));
if (chromeManifest.version !== version) errors.push("browser-extension/manifest.chrome.json: " + chromeManifest.version);

const firefoxManifest = JSON.parse(fs.readFileSync("apps/browser-extension/manifest.firefox.json", "utf8"));
if (firefoxManifest.version !== version) errors.push("browser-extension/manifest.firefox.json: " + firefoxManifest.version);

const wpsManifest = JSON.parse(fs.readFileSync("apps/wps/manifest.json", "utf8"));
if (wpsManifest.version !== version) errors.push("wps/manifest.json: " + wpsManifest.version);

const wpsPkg = JSON.parse(fs.readFileSync("apps/wps/package.json", "utf8"));
if (wpsPkg.version !== version) errors.push("wps/package.json: " + wpsPkg.version);

const wpsStagedManifestPath = "src-tauri/resources/WPS/manifest.json";
if (fs.existsSync(wpsStagedManifestPath)) {
  const wpsStagedManifest = JSON.parse(fs.readFileSync(wpsStagedManifestPath, "utf8"));
  if (wpsStagedManifest.version !== version) {
    errors.push("staged WPS/manifest.json: " + wpsStagedManifest.version);
  }
}

for (const target of ["chrome", "firefox"]) {
  const root = "src-tauri/resources/Ecosystem/browser/" + target;
  if (fs.existsSync(root + "/manifest.json")) {
    const manifest = JSON.parse(fs.readFileSync(root + "/manifest.json", "utf8"));
    if (manifest.version !== version) {
      errors.push(target + " staged manifest: " + manifest.version);
    }
    const provenance = JSON.parse(fs.readFileSync(root + "/provenance.json", "utf8"));
    if (provenance.extensionVersion !== version) {
      errors.push(target + " staged provenance: " + provenance.extensionVersion);
    }
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

# ── 10. Run drift checks ──

# ecosystem-drift: compares staged resources against HEAD (only meaningful post-commit).
# resource-drift: compares staged resources against build outputs.
# Skip ecosystem-drift pre-commit (it compares against HEAD which still has the old version).
Write-Host "Running resource drift checks..." -ForegroundColor Gray
& npm run check:resource-drift 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: resource-drift found issues. Some plugin resources may need staging." -ForegroundColor Yellow
    Write-Host "Run 'npm run stage:resources && npm run stage:ecosystem' to fix." -ForegroundColor Yellow
}

# ── 11. Run tests ──

Write-Host "Running frontend tests..." -ForegroundColor Gray
& npm run test:frontend 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: frontend tests had failures. Review before releasing." -ForegroundColor Yellow
}

Write-Host "Running Rust tests..." -ForegroundColor Gray
& cargo test --manifest-path "src-tauri/Cargo.toml" --locked 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Rust tests had failures. Review before releasing." -ForegroundColor Yellow
}

# ── 12. NoCommit: stop here ──

if ($NoCommit) {
    Write-Host "`n-NoCommit: changes applied but not committed." -ForegroundColor Cyan
    Write-Host "Review with: git diff --stat" -ForegroundColor Cyan
    Write-Host "Commit with:  git add -A && git commit -m 'chore: bump version to $Version'" -ForegroundColor Cyan
    git diff --stat
    exit 0
}

# ── 13. Commit ──

$commitFiles = @(
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "apps/browser-extension/package.json",
    "apps/browser-extension/package-lock.json",
    "apps/browser-extension/manifest.chrome.json",
    "apps/browser-extension/manifest.firefox.json",
    "apps/wps/manifest.json",
    "apps/wps/package.json",
    "contracts/resources.v1.json",
    "src-tauri/resources/Ecosystem",
    "src-tauri/resources/Obsidian",
    "src-tauri/resources/WPS"
)

foreach ($f in $commitFiles) {
    if (Test-Path -LiteralPath $f) {
        git add $f
    }
}

git commit -m "chore: bump version to $Version"
Write-Host "`nCommitted." -ForegroundColor Green

# Post-commit ecosystem drift check: now HEAD is the new version, this should pass.
Write-Host "Running post-commit ecosystem drift check..." -ForegroundColor Gray
& npm run check:ecosystem-drift
if ($LASTEXITCODE -ne 0) {
    throw "Committed ecosystem resources do not match the generated payloads; refusing to tag or push."
}

# ── 14. Push ──

if ($NoPush) {
    Write-Host "`n-NoPush: committed but not pushed. Push manually:" -ForegroundColor Cyan
    Write-Host "  git push origin $branch" -ForegroundColor Cyan
    exit 0
}

git push origin $branch
Write-Host "Pushed to origin/$branch." -ForegroundColor Green

# ── 15. Tag ──

if ($Tag) {
    $tagName = "v$Version"
    $existing = git tag --list $tagName
    if ($existing) {
        Write-Host "Replacing existing local tag $tagName..." -ForegroundColor Yellow
        git tag -d $tagName
    }
    git tag $tagName
    Write-Host "Created tag: $tagName" -ForegroundColor Green

    git push origin $tagName
    Write-Host "Pushed tag: $tagName" -ForegroundColor Green
}

Write-Host "`nDone! Version $Version" -ForegroundColor Green
