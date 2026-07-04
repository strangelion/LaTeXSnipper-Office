/**
 * Generate self-signed development certificates for localhost HTTPS.
 * Requires OpenSSL to be available in PATH.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.resolve(__dirname, '..', 'cert');

if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

const keyPath = path.join(certDir, 'localhost.key');
const certPath = path.join(certDir, 'localhost.crt');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('[cert] Dev certificates already exist at:', certDir);
  console.log('[cert] To re-generate, delete the files and run this script again.');
  process.exit(0);
}

try {
  execSync('openssl version', { stdio: 'pipe' });
} catch {
  console.error('[cert] OpenSSL not found. Install it via:');
  console.error('  Windows: choco install openssl  or  winget install OpenSSL.OpenSSL');
  console.error('  macOS:   brew install openssl');
  console.error('  Linux:   sudo apt install openssl');
  process.exit(1);
}

console.log('[cert] Generating private key...');
execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'inherit' });

console.log('[cert] Generating self-signed certificate for localhost...');
execSync(
  `openssl req -x509 -new -nodes -key "${keyPath}" -sha256 -days 365 -out "${certPath}" ` +
  `-subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,DNS:127.0.0.1,IP:127.0.0.1"`,
  { stdio: 'inherit' }
);

console.log('[cert] Dev certificates generated:');
console.log(`  Key:  ${keyPath}`);
console.log(`  Cert: ${certPath}`);
console.log('');
console.log('[cert] To trust the certificate:');
console.log('  Windows: npm run cert:trust');
console.log('  macOS:   sh apps/office-addin/scripts/trust-cert-macos.sh');
console.log('  Done.');
