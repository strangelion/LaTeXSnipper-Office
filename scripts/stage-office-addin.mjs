/**
 * Stage Office.js add-in files for the desktop bundle and website deploy.
 *
 * Run after `npm --prefix apps/office-addin run build`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const distDir = path.resolve(root, 'apps', 'office-addin', 'dist');
const manifestDir = path.resolve(root, 'apps', 'office-addin', 'manifests');
const hosts = ['word', 'excel', 'powerpoint'];

const targets = [
  {
    name: 'Tauri resources',
    siteDir: path.resolve(root, 'src-tauri', 'resources', 'OfficeJS', 'site'),
    manifestDir: path.resolve(root, 'src-tauri', 'resources', 'OfficeJS', 'manifest'),
  },
  {
    name: 'Website deploy',
    siteDir: path.resolve(root, 'office-deploy'),
    manifestDir: path.resolve(root, 'office-deploy', 'manifest'),
  },
];

if (!fs.existsSync(distDir)) {
  console.error('[stage] ERROR: Office add-in dist not found at:', distDir);
  console.error('[stage] Build first: npm --prefix apps/office-addin run build');
  process.exit(1);
}

for (const target of targets) {
  if (fs.existsSync(target.siteDir)) {
    fs.rmSync(target.siteDir, { recursive: true, force: true });
  }
  fs.cpSync(distDir, target.siteDir, { recursive: true });
  fs.mkdirSync(target.manifestDir, { recursive: true });

  for (const host of hosts) {
    const source = path.resolve(manifestDir, `manifest.${host}.desktop.xml`);
    const output = path.resolve(target.manifestDir, `${host}.xml`);
    fs.copyFileSync(source, output);
  }

  const taskpane = path.resolve(target.siteDir, 'taskpane.html');
  const assetsDir = path.resolve(target.siteDir, 'assets');
  const hasTaskpane = fs.existsSync(taskpane);
  const hasBundle = fs.existsSync(assetsDir)
    && fs.readdirSync(assetsDir).some((file) => file.startsWith('taskpane-') && file.endsWith('.js'));
  const hasIcons = fs.existsSync(assetsDir)
    && ['icon-16.png', 'icon-32.png', 'icon-80.png'].every((file) => fs.existsSync(path.join(assetsDir, file)));

  console.log(`[stage] ${target.name}: ${target.siteDir}`);
  console.log(`[stage]   taskpane.html:        ${hasTaskpane ? 'ok' : 'missing'}`);
  console.log(`[stage]   assets/taskpane-*.js:${hasBundle ? 'ok' : 'missing'}`);
  console.log(`[stage]   assets/icon-*.png:   ${hasIcons ? 'ok' : 'missing'}`);
  for (const host of hosts) {
    console.log(`[stage]   manifest/${host}.xml: ok`);
  }
}

console.log('[stage] Office.js add-in staged successfully');
