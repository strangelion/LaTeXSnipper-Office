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

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const stagingDir = resolve('apps/native-office/Installer/output/staging');

const required = [
  // VSTO manifests per host
  join('Word', 'LaTeXSnipper.Word.vsto'),
  join('Word', 'LaTeXSnipper.Word.dll.manifest'),
  join('Excel', 'LaTeXSnipper.Excel.vsto'),
  join('Excel', 'LaTeXSnipper.Excel.dll.manifest'),
  join('PowerPoint', 'LaTeXSnipper.PowerPoint.vsto'),
  join('PowerPoint', 'LaTeXSnipper.PowerPoint.dll.manifest'),
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

// Default Office Bridge builds must not pull local recognition runtimes.
try {
  const tree = execFileSync('cargo', ['tree'], {
    cwd: resolve('src-tauri'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ortLines = tree
    .split(/\r?\n/)
    .filter((line) => /\b(ort|ort-sys|onnxruntime)\b/i.test(line));
  if (ortLines.length > 0) {
    console.error('\nDefault Office build unexpectedly includes ORT dependencies:');
    for (const line of ortLines) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }
  console.log('  OK: default cargo tree has no ORT dependencies');
} catch (e) {
  console.error(`  INVALID: failed to inspect default cargo tree: ${e.message}`);
  process.exit(1);
}

// Verify signing.json is valid JSON
try {
  const signingPath = join(stagingDir, 'certificates', 'native-office-signing.json');
  const signingText = readFileSync(signingPath, 'utf-8').replace(/^\uFEFF/, '');
  const meta = JSON.parse(signingText);
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
