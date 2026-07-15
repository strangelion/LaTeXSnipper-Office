/**
 * Stage ecosystem plugin resources to src-tauri/resources/Ecosystem/
 *
 * Run after building all plugins: npm run build:ecosystem
 */

const fs = require("fs");
const path = require("path");

const ECO_ROOT = path.join(__dirname, "..", "src-tauri", "resources", "Ecosystem");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Obsidian ─────────────────────────────────────────────────────────
function stageObsidian() {
  const srcDir = path.join(__dirname, "..", "apps", "obsidian-plugin");
  const dstDir = path.join(ECO_ROOT, "obsidian");

  ensureDir(dstDir);

  const files = ["main.js", "manifest.json"];
  let copied = 0;
  for (const f of files) {
    const src = path.join(srcDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dstDir, f));
      console.log(`  [Obsidian] Copied ${f}`);
      copied++;
    } else {
      console.warn(`  [Obsidian] WARNING: ${f} not found at ${src}`);
    }
  }

  // Optional: styles.css
  const stylesSrc = path.join(srcDir, "styles.css");
  if (fs.existsSync(stylesSrc)) {
    fs.copyFileSync(stylesSrc, path.join(dstDir, "styles.css"));
    console.log("  [Obsidian] Copied styles.css");
  }

  // Also copy to legacy location for tauri build compatibility
  const legacyDir = path.join(__dirname, "..", "src-tauri", "resources", "Obsidian");
  ensureDir(legacyDir);
  for (const f of files) {
    const src = path.join(srcDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(legacyDir, f));
    }
  }
  console.log(`  [Obsidian] Staged ${copied}/2 files`);
}

// ─── VS Code ──────────────────────────────────────────────────────────
function stageVscode() {
  const appDir = path.join(__dirname, "..", "apps", "vscode-extension");
  const distDir = path.join(appDir, "dist");
  const dstDir = path.join(ECO_ROOT, "vscode");

  ensureDir(dstDir);

  // Copy package.json (needed for VS Code extension detection)
  const pkgSrc = path.join(appDir, "package.json");
  if (fs.existsSync(pkgSrc)) {
    fs.copyFileSync(pkgSrc, path.join(dstDir, "package.json"));
    console.log("  [VS Code] Copied package.json");
  }

  // Copy built extension.js
  const extSrc = path.join(distDir, "extension.js");
  if (fs.existsSync(extSrc)) {
    fs.copyFileSync(extSrc, path.join(dstDir, "extension.js"));
    console.log("  [VS Code] Copied extension.js");
  } else {
    console.warn("  [VS Code] WARNING: extension.js not found. Run npm run build:vscode first.");
  }
}

// ─── Browser Extension ────────────────────────────────────────────────
function stageBrowser() {
  const appDir = path.join(__dirname, "..", "apps", "browser-extension");
  const distDir = path.join(appDir, "dist");
  const dstDir = path.join(ECO_ROOT, "browser");

  fs.rmSync(dstDir, { recursive: true, force: true });
  if (!fs.existsSync(distDir)) {
    throw new Error("[Browser] Build output is missing. Run the browser extension build first.");
  }
  const required = [
    "manifest.json", "background.js", "content.js", "popup.html",
    "sidepanel.html", "options.html", "provenance.json",
    "THIRD_PARTY_LICENSES.txt", "_locales/en/messages.json",
    "_locales/zh_CN/messages.json", "_locales/zh_TW/messages.json",
  ];
  for (const target of ["chrome", "firefox"]) {
    const targetDir = path.join(distDir, target);
    for (const file of required) {
      const candidate = path.join(targetDir, file);
      if (!fs.existsSync(candidate) || fs.statSync(candidate).size === 0) {
        throw new Error(`[Browser] Incomplete ${target} package: ${file}`);
      }
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, "manifest.json"), "utf8"));
    if (JSON.stringify(manifest).includes("<all_urls>") || JSON.stringify(manifest).includes("19876")) {
      throw new Error(`[Browser] ${target} manifest violates permission or Bridge port policy`);
    }
  }
  fs.cpSync(distDir, dstDir, { recursive: true });

  console.log("  [Browser] Staged verified Chrome and Firefox packages");
}

// ─── Main ─────────────────────────────────────────────────────────────
console.log("[stage-ecosystem] Staging ecosystem plugin resources...");
ensureDir(ECO_ROOT);
stageObsidian();
stageVscode();
stageBrowser();
// WPS is staged separately via stage-resources.ps1 into resources/WPS
console.log("[stage-ecosystem] Done.");
