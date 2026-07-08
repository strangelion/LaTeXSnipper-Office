#!/usr/bin/env node
/**
 * Check that the Native Office VSTO package is structurally complete.
 * Intended for CI static verification before the Tauri build.
 *
 * Usage:
 *   node scripts/check-native-office-package.mjs
 *
 * Exits with code 0 on success, 1 on failure.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const stagingDir = resolve('apps/native-office/Installer/output/staging');

const required = [
  // VSTO manifests per host
  join('Word', 'LaTeXSnipper.Word.vsto'),
  join('Excel', 'LaTeXSnipper.Excel.vsto'),
  join('PowerPoint', 'LaTeXSnipper.PowerPoint.vsto'),
  // Shared assembly
  join('Shared', 'LaTeXSnipper.NativeOffice.Shared.dll'),
  // OLE DLLs
  'OleFormulaObject.x64.dll',
  'OleFormulaObject.x86.dll',
  // Certificates
  join('certificates', 'LaTeXSnipperOffice.cer'),
  join('certificates', 'native-office-signing.json'),
];

let allOk = true;
for (const rel of required) {
  const full = join(stagingDir, rel);
  if (!existsSync(full)) {
    console.error(`  MISSING: ${rel}`);
    allOk = false;
  } else {
    console.log(`  OK: ${rel}`);
  }
}

if (!allOk) {
  console.error('\nNative Office package check FAILED: missing required files.');
  process.exit(1);
}

// Verify signing.json is valid JSON
try {
  const signingPath = join(stagingDir, 'certificates', 'native-office-signing.json');
  const meta = JSON.parse(readFileSync(signingPath, 'utf-8'));
  if (!meta.sha1Thumbprint || meta.sha1Thumbprint.length !== 40) {
    console.error('  INVALID: native-office-signing.json missing or invalid sha1Thumbprint');
    process.exit(1);
  }
  console.log(`  Signing thumbprint: ${meta.sha1Thumbprint}`);
} catch (e) {
  console.error(`  INVALID: native-office-signing.json parse error: ${e.message}`);
  process.exit(1);
}

console.log('\nAll Native Office package checks passed.');
