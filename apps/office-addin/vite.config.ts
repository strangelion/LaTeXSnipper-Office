import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

const certDir = resolve(__dirname, 'cert');
const keyPath = resolve(certDir, 'localhost.key');
const certPath = resolve(certDir, 'localhost.crt');

function getHttpsConfig() {
  // Try to use dev certificates if they exist
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  }
  // Fallback: let Vite generate a self-signed cert
  console.warn('[LaTeXSnipper] No dev certificates found, using auto-generated self-signed cert.');
  console.warn('[LaTeXSnipper] Run: npm --prefix apps/office-addin run cert:dev to create trusted certs.');
  return true;
}

export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        taskpane: resolve(__dirname, 'src/taskpane/index.html'),
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    https: getHttpsConfig(),
  },
});
