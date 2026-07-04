/**
 * Stage Office.js add-in for Tauri packaging.
 * 
 * 1. Cleans src-tauri/resources/OfficeJS/taskpane/
 * 2. Copies apps/office-addin/dist/ to resources/OfficeJS/taskpane/
 * 3. Copies the Word manifest to resources/OfficeJS/manifest.word.local.xml
 * 
 * Run after `npm --prefix apps/office-addin run build`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const src = {
  dist: path.resolve(root, 'apps', 'office-addin', 'dist'),
  manifest: {
    local: path.resolve(root, 'apps', 'office-addin', 'manifests', 'manifest.word.local.xml'),
    desktop: path.resolve(root, 'apps', 'office-addin', 'manifests', 'manifest.word.desktop.xml'),
  },
};

const dest = {
  taskpaneDir: path.resolve(root, 'src-tauri', 'resources', 'OfficeJS', 'taskpane'),
  manifestOut: path.resolve(root, 'src-tauri', 'resources', 'OfficeJS', 'manifest.word.local.xml'),
};

// 1. Clean
if (fs.existsSync(dest.taskpaneDir)) {
  fs.rmSync(dest.taskpaneDir, { recursive: true, force: true });
  console.log('[stage] Cleaned taskpane directory');
}

// 2. Copy dist/taskpane contents to OfficeJS/taskpane
// Vite output: dist/taskpane/index.html
const taskpaneDist = path.resolve(src.dist, 'taskpane');
if (!fs.existsSync(taskpaneDist)) {
  console.error('[stage] ERROR: Task pane dist not found at:', taskpaneDist);
  console.error('[stage] Build first: npm --prefix apps/office-addin run build');
  process.exit(1);
}

fs.cpSync(taskpaneDist, dest.taskpaneDir, { recursive: true });
console.log(`[stage] Copied taskpane: ${taskpaneDist} → ${dest.taskpaneDir}`);

// 3. Copy manifests
const manifestDir = path.dirname(dest.manifestOut);
fs.mkdirSync(manifestDir, { recursive: true });

// Copy dev manifest
fs.copyFileSync(src.manifest.local, dest.manifestOut);
console.log(`[stage] Copied local manifest: ${src.manifest.local} → ${dest.manifestOut}`);

// Copy desktop manifest (for production/bundled use)
if (fs.existsSync(src.manifest.desktop)) {
  const desktopDest = path.resolve(manifestDir, 'manifest.word.desktop.xml');
  fs.copyFileSync(src.manifest.desktop, desktopDest);
  console.log(`[stage] Copied desktop manifest: ${src.manifest.desktop} → ${desktopDest}`);
}

console.log('[stage] Office.js add-in staged successfully');
