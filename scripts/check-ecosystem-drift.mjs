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
 *   1 - Drift detected
 *
 * Note: This script assumes dependencies are already installed.
 * Run after: npm run build:ecosystem && npm run stage:ecosystem
 */

import { execFileSync } from "node:child_process";
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

// Check if there are uncommitted changes in ecosystem resources
const stagedResources = [
  "src-tauri/resources/Ecosystem",
  "src-tauri/resources/Obsidian",
];

let hasDrift = false;

for (const dir of stagedResources) {
  const output = run("git", ["status", "--porcelain", dir]);
  if (output.trim()) {
    console.error(`[ecosystem-drift] DRIFT DETECTED in ${dir}:`);
    console.error(output);
    hasDrift = true;
  }
}

// Also check if there are unstaged changes
for (const dir of stagedResources) {
  const output = run("git", ["diff", "--name-only", dir]);
  if (output.trim()) {
    console.error(`[ecosystem-drift] UNSTAGED CHANGES in ${dir}:`);
    console.error(output);
    hasDrift = true;
  }
}

if (hasDrift) {
  console.error("\n[ecosystem-drift] FAILED: Staged artifact drift detected");
  console.error(
    "Run 'npm run build:ecosystem && npm run stage:ecosystem' to fix",
  );
  process.exit(1);
}

console.log("\n[ecosystem-drift] PASSED: No staged artifact drift detected");
process.exit(0);
