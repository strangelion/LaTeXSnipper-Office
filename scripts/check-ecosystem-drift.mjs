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
 *   1 - Drift detected or build failed
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const tempDir = resolve(root, ".ecosystem-drift-check");

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

function compareDirs(dir1, dir2, relativePath = "") {
  const differences = [];

  const entries1 = existsSync(dir1) ? getEntries(dir1) : [];
  const entries2 = existsSync(dir2) ? getEntries(dir2) : [];

  const allEntries = new Set([...entries1, ...entries2]);

  for (const entry of allEntries) {
    const path1 = join(dir1, entry);
    const path2 = join(dir2, entry);
    const relPath = relativePath ? `${relativePath}/${entry}` : entry;

    const exists1 = existsSync(path1);
    const exists2 = existsSync(path2);

    if (!exists1) {
      differences.push(
        `  + ${relPath} (exists in committed, missing in generated)`,
      );
    } else if (!exists2) {
      differences.push(
        `  - ${relPath} (exists in generated, missing in committed)`,
      );
    } else {
      const content1 = readFileSync(path1);
      const content2 = readFileSync(path2);
      if (!content1.equals(content2)) {
        differences.push(`  ~ ${relPath} (content differs)`);
      }
    }
  }

  return differences;
}

function getEntries(dir) {
  return readdirSync(dir).filter((entry) => {
    const path = join(dir, entry);
    return statSync(path).isFile();
  });
}

// Main
console.log("[ecosystem-drift] Checking for staged artifact drift...");

// Clean temp directory
if (existsSync(tempDir)) {
  rmSync(tempDir, { recursive: true, force: true });
}
mkdirSync(tempDir, { recursive: true });

const committedResources = resolve(root, "src-tauri", "resources", "Ecosystem");
const driftFiles = [];

// Check each ecosystem component
const components = ["obsidian", "vscode", "browser"];

for (const component of components) {
  const committedDir = join(committedResources, component);
  const tempComponentDir = join(tempDir, component);

  if (!existsSync(committedDir)) {
    console.log(`  [${component}] No committed resources found, skipping`);
    continue;
  }

  // Find source directory
  const sourceDir = resolve(
    root,
    "apps",
    component === "vscode"
      ? "vscode-extension"
      : component === "obsidian"
        ? "obsidian-plugin"
        : component === "browser"
          ? "browser-extension"
          : component,
  );

  if (!existsSync(sourceDir)) {
    console.log(`  [${component}] Source directory not found, skipping`);
    continue;
  }

  // Build and copy to temp
  console.log(`  [${component}] Building from source...`);

  try {
    if (component === "obsidian") {
      run("npm", ["run", "build", "--", "--production"], { cwd: sourceDir });
      mkdirSync(tempComponentDir, { recursive: true });
      const files = ["main.js", "manifest.json"];
      for (const file of files) {
        const src = join(sourceDir, file);
        if (existsSync(src)) {
          cpSync(src, join(tempComponentDir, file));
        }
      }
    } else if (component === "vscode") {
      run("npm", ["run", "build"], { cwd: sourceDir });
      mkdirSync(tempComponentDir, { recursive: true });
      const files = ["package.json", "dist/extension.js"];
      for (const file of files) {
        const src = join(sourceDir, file);
        if (existsSync(src)) {
          const dest = file.includes("/")
            ? join(tempComponentDir, file.split("/")[1])
            : join(tempComponentDir, file);
          cpSync(src, dest);
        }
      }
    } else if (component === "browser") {
      run("npm", ["run", "build"], { cwd: sourceDir });
      const distDir = join(sourceDir, "dist");
      if (existsSync(distDir)) {
        cpSync(distDir, tempComponentDir, { recursive: true });
      }
    }

    // Compare
    const differences = compareDirs(committedDir, tempComponentDir);
    if (differences.length > 0) {
      console.error(`  [${component}] DRIFT DETECTED:`);
      differences.forEach((d) => console.error(d));
      driftFiles.push(...differences.map((d) => `${component}/${d.trim()}`));
    } else {
      console.log(`  [${component}] OK - no drift`);
    }
  } catch (error) {
    console.error(`  [${component}] Build failed: ${error.message}`);
    driftFiles.push(`${component}: build failed`);
  }
}

// Clean up
if (existsSync(tempDir)) {
  rmSync(tempDir, { recursive: true, force: true });
}

if (driftFiles.length > 0) {
  console.error("\n[ecosystem-drift] FAILED: Staged artifact drift detected");
  console.error(
    "Run 'npm run build:ecosystem && npm run stage:ecosystem' to fix",
  );
  process.exit(1);
}

console.log("\n[ecosystem-drift] PASSED: No staged artifact drift detected");
process.exit(0);
