import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  base: './',
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [
        resolve(__dirname, 'node_modules'),
        resolve(__dirname, 'src'),
      ],
    },
    // Proxy Bridge requests during development.
    proxy: {
      '/bridge': {
        target: 'http://127.0.0.1:28765',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bridge/, ''),
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: ['mathlive', 'mathjax'],
  },
});


