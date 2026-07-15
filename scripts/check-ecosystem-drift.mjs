/**
 * Check for staged artifact drift.
 *
 * This script verifies that the committed ecosystem resources
 * match what would be generated from current source code.
 *
 * Usage: node scripts/check-ecosystem-drift.mjs
 *
 * Exit codes:
 *   0 - No drift detected
 *   1 - Drift detected (modified files don't match source)
 *
 * Note: This script assumes dependencies are already installed.
 * Run after: npm run build:ecosystem && npm run stage:ecosystem
 *
 * "Drift" means: committed files were modified by build but not staged.
 * Untracked (??) files are normal after a fresh build and don't count as drift.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

function run(cmd, args, options = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
      ...options,
    });
  } catch (error) {
    console.error(`Command failed: ${cmd} ${args.join(" ")}`);
    console.error(error.stderr || error.message);
    process.exit(1);
  }
}

// Main
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

  // Only check for MODIFIED files (M prefix), not untracked (??)
  // Untracked files are normal after a fresh build
  const statusOutput = run("git", ["status", "--porcelain", dir]);
  const modifiedFiles = statusOutput
    .split("\n")
    .filter(
      (line) => line.trim() && !line.startsWith("??") && !line.startsWith("A"),
    );

  if (modifiedFiles.length > 0) {
    console.error(`[ecosystem-drift] MODIFIED FILES in ${dir} (not staged):`);
    modifiedFiles.forEach((f) => console.error(f));
    hasDrift = true;
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
