import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 2100,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, "node_modules"), resolve(__dirname, "src")],
    },
    // Proxy Bridge requests during development.
    proxy: {
      "/bridge": {
        target: "http://127.0.0.1:19877",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bridge/, ""),
      },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        capture: resolve(__dirname, "src/capture.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  optimizeDeps: {
    include: ["mathlive", "mathjax"],
  },
});
