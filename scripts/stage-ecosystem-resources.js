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
  const distDir = path.join(__dirname, "..", "apps", "vscode-extension", "dist");
  const dstDir = path.join(ECO_ROOT, "vscode");

  ensureDir(dstDir);

  const extensionJs = path.join(distDir, "extension.js");
  if (fs.existsSync(extensionJs)) {
    fs.copyFileSync(extensionJs, path.join(dstDir, "extension.js"));
    console.log("  [VS Code] Copied extension.js");
  } else {
    console.warn("  [VS Code] WARNING: extension.js not found. Run npm run build:vscode first.");
  }
}

// ─── Browser Extension ────────────────────────────────────────────────
function stageBrowser() {
  const distDir = path.join(__dirname, "..", "apps", "browser-extension", "dist");
  const dstDir = path.join(ECO_ROOT, "browser");

  ensureDir(dstDir);

  const files = ["background.js", "content.js", "popup.html"];
  let copied = 0;
  for (const f of files) {
    const src = path.join(distDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dstDir, f));
      copied++;
    }
  }
  console.log(`  [Browser] Staged ${copied} files`);
}

// ─── Main ─────────────────────────────────────────────────────────────
console.log("[stage-ecosystem] Staging ecosystem plugin resources...");
ensureDir(ECO_ROOT);
stageObsidian();
stageVscode();
stageBrowser();
console.log("[stage-ecosystem] Done.");
