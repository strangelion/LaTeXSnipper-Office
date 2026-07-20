/**
 * Check for staged artifact drift.
 *
 * Verifies that committed ecosystem resources match what the build produces.
 * Uses content hash comparison (not git status) to avoid false positives
 * from line ending differences between platforms.
 *
 * Exit codes:
 *   0 - No drift detected
 *   1 - Drift detected (content differs)
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

function fileHash(filePath) {
  // Normalize line endings to LF before hashing to avoid false drift
  // from CRLF/LF differences between Windows and Linux builds
  const content = readFileSync(filePath).toString("utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(content).digest("hex");
}

function getCommittedContent(relPath) {
  try {
    return execFileSync("git", ["show", `HEAD:${relPath}`], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    });
  } catch {
    return null;
  }
}

function contentHash(content) {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex");
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

console.log("[ecosystem-drift] Checking for staged artifact drift...");

const stagedResources = [
  "src-tauri/resources/Ecosystem",
  "src-tauri/resources/Obsidian",
];

let hasDrift = false;

for (const dir of stagedResources) {
  const fullDir = resolve(root, dir);
  if (!existsSync(fullDir)) {
    console.error(`[ecosystem-drift] DIRECTORY MISSING: ${dir}`);
    hasDrift = true;
    continue;
  }

  const files = walkDir(fullDir).filter((f) => !f.includes("provenance.json"));

  for (const filePath of files) {
    const relPath = relative(root, filePath).replace(/\\/g, "/");
    const currentHash = fileHash(filePath);
    const committedContent = getCommittedContent(relPath);

    if (committedContent === null) {
      // New file, not yet committed — this is normal after build
      continue;
    }

    const committedHash = contentHash(committedContent);
    if (currentHash !== committedHash) {
      console.error(`[ecosystem-drift] CONTENT CHANGED: ${relPath}`);
      hasDrift = true;
    }
  }
}

if (hasDrift) {
  console.error("\n[ecosystem-drift] FAILED: Staged artifact drift detected");
  console.error(
    "Run 'npm run build:ecosystem && npm run stage:ecosystem' and commit the changes.",
  );
  process.exit(1);
}

console.log("\n[ecosystem-drift] PASSED: No staged artifact drift detected");
process.exit(0);
