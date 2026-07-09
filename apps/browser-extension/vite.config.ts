import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const isFirefox = mode === "firefox";

  return {
    define: {
      __TARGET__: JSON.stringify(isFirefox ? "firefox" : "chrome"),
    },
    build: {
      outDir: "dist",
      emptyDirOut: true,
      rollupOptions: {
        input: {
          background: resolve(__dirname, "src/background.ts"),
          content: resolve(__dirname, "src/content.ts"),
          popup: resolve(__dirname, "src/popup.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          format: "es",
        },
      },
      copyPublicDir: false,
    },
  };
});
