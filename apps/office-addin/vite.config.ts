import { defineConfig } from 'vite';
import { resolve } from 'path';

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
    port: 1421,
    strictPort: true,
    https: false,
  },
  define: {
    'process.env.NODE_ENV': '"development"',
  },
});
