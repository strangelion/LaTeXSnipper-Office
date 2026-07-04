/**
 * Stage Office.js add-in for Tauri packaging.
 *
 * 1. Copies entire apps/office-addin/dist/ to resources/OfficeJS/site/
 *    (includes taskpane/ + assets/ so index.html can resolve ../assets/*.js)
 * 2. Copies the production manifest to resources/OfficeJS/manifest.word.xml
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
    desktop: path.resolve(root, 'apps', 'office-addin', 'manifests', 'manifest.word.desktop.xml'),
  },
};

const dest = {
  siteDir: path.resolve(root, 'src-tauri', 'resources', 'OfficeJS', 'site'),
  manifestOut: path.resolve(root, 'src-tauri', 'resources', 'OfficeJS', 'manifest.word.xml'),
};

// 1. Verify dist exists
if (!fs.existsSync(src.dist)) {
  console.error('[stage] ERROR: Office add-in dist not found at:', src.dist);
  console.error('[stage] Build first: npm --prefix apps/office-addin run build');
  process.exit(1);
}

// 2. Clean and copy entire dist/ to OfficeJS/site/
if (fs.existsSync(dest.siteDir)) {
  fs.rmSync(dest.siteDir, { recursive: true, force: true });
  console.log('[stage] Cleaned site directory');
}
fs.cpSync(src.dist, dest.siteDir, { recursive: true });
console.log(`[stage] Copied dist: ${src.dist} → ${dest.siteDir}`);

// Verify assets exist
const assetsDir = path.resolve(dest.siteDir, 'assets');
if (!fs.existsSync(assetsDir) || fs.readdirSync(assetsDir).length === 0) {
  console.warn('[stage] WARNING: assets/ directory is empty or missing.');
  console.warn('[stage] The taskpane will likely show a white screen (JS bundles 404).');
}

// 3. Copy production manifest (NOT the dev manifest which points to localhost:3000)
const manifestDir = path.dirname(dest.manifestOut);
fs.mkdirSync(manifestDir, { recursive: true });

if (!fs.existsSync(src.manifest.desktop)) {
  console.error('[stage] ERROR: Production manifest not found at:', src.manifest.desktop);
  process.exit(1);
}
fs.copyFileSync(src.manifest.desktop, dest.manifestOut);
console.log(`[stage] Copied production manifest: ${src.manifest.desktop} → ${dest.manifestOut}`);

console.log('[stage] Office.js add-in staged successfully');
