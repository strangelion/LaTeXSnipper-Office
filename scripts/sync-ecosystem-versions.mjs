/**
 * Sync ecosystem plugin versions to match the root package.json.
 *
 * Usage: node scripts/sync-ecosystem-versions.mjs [--dry-run]
 *   --dry-run   Print what would change without writing files.
 *
 * Supported files:
 *   apps/browser-extension/package.json
 *   apps/browser-extension/manifest.chrome.json
 *   apps/browser-extension/manifest.firefox.json
 *   apps/wps/package.json
 *   apps/wps/manifest.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const rootPkg = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const targetVersion = rootPkg.version;

const targets = [
  "apps/browser-extension/package.json",
  "apps/browser-extension/manifest.chrome.json",
  "apps/browser-extension/manifest.firefox.json",
  "apps/wps/package.json",
  "apps/wps/manifest.json",
];

let changed = 0;

for (const relPath of targets) {
  const abs = resolve(root, relPath);
  const raw = readFileSync(abs, "utf8");
  const data = JSON.parse(raw);

  if (data.version === targetVersion) {
    console.log(`  skip ${relPath} (already ${targetVersion})`);
    continue;
  }

  const old = data.version;
  data.version = targetVersion;

  if (dryRun) {
    console.log(`  dry   ${relPath}: ${old} -> ${targetVersion}`);
  } else {
    writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`  write ${relPath}: ${old} -> ${targetVersion}`);
  }
  changed++;
}

console.log(`\n${dryRun ? "[dry-run] " : ""}${changed} file(s) changed.`);
