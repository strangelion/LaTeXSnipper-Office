import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  define: {
    __TARGET__: JSON.stringify(mode === "firefox" ? "firefox" : "chrome"),
  },
  build: {
    outDir: `dist/${mode === "firefox" ? "firefox" : "chrome"}`,
    emptyDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        sidepanel: resolve(__dirname, "sidepanel.html"),
        options: resolve(__dirname, "options.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        format: "es",
      },
    },
    copyPublicDir: false,
  },
}));
