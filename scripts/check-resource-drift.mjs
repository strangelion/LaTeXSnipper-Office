/**
 * Check for staged resource drift across ALL bundled plugins.
 *
 * Compares build outputs against the staged Tauri resources. Fails if any
 * plugin's staged resources are out of sync — meaning someone edited source
 * but forgot to rebuild and re-stage before committing.
 *
 * Covered resources:
 *   WPS          – apps/wps/dist  vs  src-tauri/resources/WPS
 *   OfficeJS     – apps/office-addin/dist  vs  src-tauri/resources/OfficeJS/site
 *   NativeOffice – apps/native-office/Installer/output  vs  src-tauri/resources/NativeOffice
 *   Ecosystem    – Obsidian / VS Code / Browser  vs  src-tauri/resources/Ecosystem + Obsidian
 *
 * Exit codes:
 *   0 - No drift detected (all staged resources match build outputs)
 *   1 - Drift detected (content differs)
 *   2 - Build output missing (run the indicated build command first)
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const platform = os.platform();

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fileHash(filePath) {
  const content = readFileSync(filePath)
    .toString("utf8")
    .replace(/\r\n/g, "\n");
  return createHash("sha256").update(content).digest("hex");
}

function binaryHash(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function walkDir(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function findLatestDir(parentDir, prefix) {
  if (!existsSync(parentDir)) return null;
  const dirs = readdirSync(parentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => join(parentDir, e.name))
    .filter((p) => statSync(p).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dirs.length > 0 ? dirs[0] : null;
}

function getCommittedContent(relPath) {
  try {
    return execFileSync("git", ["show", `HEAD:${relPath}`], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return null;
  }
}

function contentHash(content) {
  return createHash("sha256")
    .update(content.replace(/\r\n/g, "\n"))
    .digest("hex");
}

const issues = [];
let exitCode = 0;

function fail(msg) {
  issues.push(msg);
  exitCode = 1;
}

// ---------------------------------------------------------------------------
// Checker: WPS
// ---------------------------------------------------------------------------
function checkWps() {
  const stagedDir = resolve(root, "src-tauri", "resources", "WPS");
  if (!existsSync(stagedDir)) {
    fail("WPS staged resources directory not found: src-tauri/resources/WPS/");
    return;
  }

  const distRoot = resolve(root, "apps", "wps", "dist");
  const buildDir = findLatestDir(distRoot, "latexsnipper-wps_");
  if (!buildDir) {
    fail("WPS build output missing in apps/wps/dist/ — run: npm run build:wps");
    return;
  }

  const buildFiles = walkDir(buildDir)
    .filter((f) => !f.endsWith(".zip"))
    .map((f) => ({
      rel: relative(buildDir, f).replace(/\\/g, "/"),
      abs: f,
      hash: fileHash(f),
    }));

  const stagedFiles = walkDir(stagedDir).map((f) => ({
    rel: relative(stagedDir, f).replace(/\\/g, "/"),
    abs: f,
    hash: fileHash(f),
  }));

  const buildMap = new Map(buildFiles.map((f) => [f.rel, f]));
  const stagedMap = new Map(stagedFiles.map((f) => [f.rel, f]));

  for (const [rel, bf] of buildMap) {
    if (!stagedMap.has(rel)) {
      fail(`WPS: missing in resources — ${rel}`);
    } else if (stagedMap.get(rel).hash !== bf.hash) {
      fail(`WPS: content mismatch — ${rel}`);
    }
  }

  for (const [rel] of stagedMap) {
    if (!buildMap.has(rel)) {
      fail(`WPS: stale file in resources (not in build) — ${rel}`);
    }
  }

  if (!exitCode) {
    console.log(`  WPS: ${buildFiles.length} files in sync`);
  }
}

// ---------------------------------------------------------------------------
// Checker: OfficeJS
// ---------------------------------------------------------------------------
function checkOfficeJs() {
  const stagedSiteDir = resolve(
    root,
    "src-tauri",
    "resources",
    "OfficeJS",
    "site",
  );
  const stagedManifestDir = resolve(
    root,
    "src-tauri",
    "resources",
    "OfficeJS",
    "manifest",
  );

  if (!existsSync(stagedSiteDir)) {
    fail(
      "OfficeJS staged site directory not found: src-tauri/resources/OfficeJS/site/",
    );
    return;
  }
  if (!existsSync(stagedManifestDir)) {
    fail(
      "OfficeJS staged manifest directory not found: src-tauri/resources/OfficeJS/manifest/",
    );
    return;
  }

  // OfficeJS uses Vite which produces non-deterministic hashed filenames.
  // In CI (where a fresh build just ran), we use git diff to detect whether
  // the committed resources are stale. Locally (no fresh build), comparing
  // against git HEAD catches pre-commit drift.
  const buildDir = resolve(root, "apps", "office-addin", "dist");
  const freshBuildExists = existsSync(buildDir) && walkDir(buildDir).length > 0;

  if (freshBuildExists) {
    // CI path: a fresh build was just staged. Check if git sees any
    // uncommitted changes — if so, the developer forgot to commit.
    try {
      execFileSync(
        "git",
        ["diff", "--exit-code", "--", "src-tauri/resources/OfficeJS/"],
        { cwd: root, encoding: "utf8", stdio: "pipe" },
      );
      console.log("  OfficeJS: staged resources match committed (post-build)");
    } catch {
      // git diff --exit-code returns non-zero when there are changes
      fail(
        "OfficeJS: staged resources differ from committed — run npm run build:office-addin and commit the result",
      );
    }
  } else {
    // Local path: compare staged files against git HEAD
    let fileCount = 0;
    let officeJsOk = true;

    for (const dir of [stagedSiteDir, stagedManifestDir]) {
      const files = walkDir(dir);
      for (const filePath of files) {
        const relPath = relative(root, filePath).replace(/\\/g, "/");
        const currentHash = fileHash(filePath);
        const committedContent = getCommittedContent(relPath);

        if (committedContent === null) {
          continue;
        }

        const committedHash = contentHash(committedContent);
        if (currentHash !== committedHash) {
          fail(`OfficeJS: content changed vs HEAD — ${relPath}`);
          officeJsOk = false;
        }
        fileCount++;
      }
    }

    if (officeJsOk) {
      console.log(`  OfficeJS: ${fileCount} files in sync with HEAD`);
    }
  }
}

// ---------------------------------------------------------------------------
// Checker: NativeOffice (Windows only)
// ---------------------------------------------------------------------------
function checkNativeOffice() {
  if (platform !== "win32") {
    console.log("  NativeOffice: skipped (Windows-only)");
    return;
  }

  const stagedDir = resolve(root, "src-tauri", "resources", "NativeOffice");
  const buildDir = resolve(
    root,
    "apps",
    "native-office",
    "Installer",
    "output",
  );

  if (!existsSync(stagedDir)) {
    fail(
      "NativeOffice staged directory not found: src-tauri/resources/NativeOffice/",
    );
    return;
  }

  const msiName = "LaTeXSnipper.NativeOffice.msi";
  const buildMsi = join(buildDir, msiName);
  const stagedMsi = join(stagedDir, msiName);

  if (!existsSync(buildMsi)) {
    fail(
      `NativeOffice MSI missing in build output — run: npm run build:native-office`,
    );
    return;
  }
  if (!existsSync(stagedMsi)) {
    fail(
      `NativeOffice MSI missing in staged resources — run: npm run stage:resources`,
    );
    return;
  }

  const buildHash = binaryHash(buildMsi);
  const stagedHash = binaryHash(stagedMsi);
  if (buildHash !== stagedHash) {
    fail(
      "NativeOffice: MSI content mismatch — staged MSI differs from build output",
    );
    return;
  }

  console.log("  NativeOffice: MSI in sync");
}

// ---------------------------------------------------------------------------
// Checker: Ecosystem (Obsidian, VS Code, Browser plugins)
// ---------------------------------------------------------------------------
function checkEcosystem() {
  const ecosystemDir = resolve(root, "src-tauri", "resources", "Ecosystem");
  const obsidianDir = resolve(root, "src-tauri", "resources", "Obsidian");

  // --- Ecosystem ---
  if (!existsSync(ecosystemDir)) {
    fail(
      "Ecosystem staged directory not found: src-tauri/resources/Ecosystem/",
    );
  } else {
    const files = walkDir(ecosystemDir).filter(
      (f) => !f.includes("provenance.json"),
    );
    let ecosystemOk = true;

    for (const filePath of files) {
      const relPath = relative(root, filePath).replace(/\\/g, "/");
      const currentHash = fileHash(filePath);
      const committedContent = getCommittedContent(relPath);

      if (committedContent === null) {
        // New file not yet committed — acceptable after build
        continue;
      }

      const committedHash = contentHash(committedContent);
      if (currentHash !== committedHash) {
        fail(`Ecosystem: content changed vs HEAD — ${relPath}`);
        ecosystemOk = false;
      }
    }

    if (ecosystemOk) {
      console.log(`  Ecosystem: ${files.length} files in sync with HEAD`);
    }
  }

  // --- Obsidian (legacy location) ---
  if (!existsSync(obsidianDir)) {
    fail("Obsidian staged directory not found: src-tauri/resources/Obsidian/");
  } else {
    const keyFiles = ["main.js", "manifest.json", "styles.css"];
    let obsidianOk = true;

    for (const file of keyFiles) {
      const stagedPath = join(obsidianDir, file);
      if (!existsSync(stagedPath)) {
        fail(`Obsidian: missing — ${file}`);
        obsidianOk = false;
        continue;
      }

      const relPath = `src-tauri/resources/Obsidian/${file}`;
      const currentHash = fileHash(stagedPath);
      const committedContent = getCommittedContent(relPath);

      if (committedContent === null) continue;

      const committedHash = contentHash(committedContent);
      if (currentHash !== committedHash) {
        fail(`Obsidian: content changed vs HEAD — ${relPath}`);
        obsidianOk = false;
      }
    }

    if (obsidianOk) {
      console.log("  Obsidian: key files in sync with HEAD");
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(
  "[resource-drift] Checking staged resource drift across all plugins...\n",
);

checkWps();
checkOfficeJs();
checkNativeOffice();
checkEcosystem();

if (exitCode !== 0) {
  console.error("\n[resource-drift] FAILED: Staged resource drift detected!\n");
  for (const issue of issues) {
    console.error(`  • ${issue}`);
  }
  console.error("\n---");
  console.error(
    "The staged Tauri resources are out of sync with build outputs.",
  );
  console.error("This means the desktop app will run OLD plugin code.\n");
  console.error("Fix (run in order):");
  console.error("  npm run build:wps            # rebuild WPS plugin");
  console.error("  npm run build:office-addin    # rebuild Office.js add-in");
  console.error(
    "  npm run build:native-office   # rebuild NativeOffice (Windows only)",
  );
  console.error(
    "  npm run build:ecosystem       # rebuild Obsidian + VS Code + Browser",
  );
  console.error(
    "  npm run stage:resources       # copy WPS + NativeOffice to resources",
  );
  console.error(
    "  npm run stage:ecosystem       # copy Ecosystem to resources",
  );
  console.error("\nThen commit the updated src-tauri/resources/ files.");
  console.error("---");
  process.exit(1);
}

console.log("\n[resource-drift] PASSED: All staged resources in sync");
process.exit(0);
