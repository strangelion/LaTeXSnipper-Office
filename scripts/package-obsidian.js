/**
 * Package Obsidian plugin into a .zip file.
 * Usage: node scripts/package-obsidian.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const pluginDir = path.join(__dirname, "..", "apps", "obsidian-plugin");
const outputDir = path.join(__dirname, "..", "dist", "ecosystem", "obsidian");

// Always build to ensure fresh main.js
console.log("[package-obsidian] Building plugin...");
execSync("npm run build -- --production", { cwd: pluginDir, stdio: "inherit" });

// Ensure output dir
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Copy files
const files = ["main.js", "manifest.json"];
for (const f of files) {
  const src = path.join(pluginDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outputDir, f));
  }
}

// Create zip
const zipName = `latexsnipper-obsidian-${require(path.join(pluginDir, "package.json")).version}.zip`;
const archiver = require("child_process").spawnSync("powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -Path "${outputDir}\\*" -DestinationPath "${path.join(outputDir, '..', zipName)}" -Force`,
]);
if (archiver.status === 0) {
  console.log(`[package-obsidian] Created ${zipName}`);
} else {
  console.error("[package-obsidian] Failed to create zip");
}

console.log("[package-obsidian] Done.");
