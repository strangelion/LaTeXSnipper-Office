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

  ensureDir(dstDir);

  // Copy built JS files from dist
  const jsFiles = ["background.js", "content.js", "popup.js"];
  let copied = 0;
  for (const f of jsFiles) {
    const src = path.join(distDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dstDir, f));
      copied++;
    }
  }

  // Copy popup.html from app root
  const popupSrc = path.join(appDir, "popup.html");
  if (fs.existsSync(popupSrc)) {
    fs.copyFileSync(popupSrc, path.join(dstDir, "popup.html"));
    copied++;
  }

  // Copy both manifests
  for (const m of ["manifest.chrome.json", "manifest.firefox.json"]) {
    const src = path.join(appDir, m);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dstDir, m));
    }
  }

  console.log(`  [Browser] Staged ${copied} files`);
}

// ─── WPS ───────────────────────────────────────────────────────────────
function stageWps() {
  const appDir = path.join(__dirname, "..", "apps", "wps", "installer");
  const dstDir = path.join(ECO_ROOT, "wps");

  if (!fs.existsSync(appDir)) {
    console.warn("  [WPS] WARNING: WPS installer dir not found. Skipping.");
    return;
  }

  function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      const s = path.join(src, entry);
      const d = path.join(dest, entry);
      if (fs.statSync(s).isDirectory()) {
        copyDir(s, d);
      } else {
        fs.copyFileSync(s, d);
      }
    }
  }

  copyDir(appDir, dstDir);
  console.log("  [WPS] Staged resources");
}

// ─── Main ─────────────────────────────────────────────────────────────
console.log("[stage-ecosystem] Staging ecosystem plugin resources...");
ensureDir(ECO_ROOT);
stageObsidian();
stageVscode();
stageBrowser();
stageWps();
console.log("[stage-ecosystem] Done.");
