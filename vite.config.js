import { defineConfig, normalizePath } from "vite";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { viteStaticCopy } from "vite-plugin-static-copy";

function serveBundledTikzRuntime() {
  const runtimeRoot = resolve(__dirname, "node_modules/@rod2ik/tikzjax/dist");
  const idmSafeAliases = {
    "runtime/core": "core.dump.gz",
    "runtime/tex": "tex.wasm.gz",
  };
  const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".gz": "application/gzip",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return {
    name: "latexsnipper-serve-bundled-tikz-runtime",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/vendor/tikzjax", (request, response, next) => {
        const pathname = decodeURIComponent(
          String(request.url || "/").split("?", 1)[0],
        ).replace(/^\/+/, "");
        const texFilePrefix = "runtime/file/";
        const runtimePath = pathname.startsWith(texFilePrefix)
          ? `tex_files/${pathname.slice(texFilePrefix.length)}.gz`
          : idmSafeAliases[pathname] || pathname;
        const filePath = resolve(runtimeRoot, runtimePath);
        const relativePath = relative(runtimeRoot, filePath);
        if (
          !relativePath ||
          relativePath.startsWith("..") ||
          isAbsolute(relativePath) ||
          !existsSync(filePath) ||
          !statSync(filePath).isFile()
        ) {
          next();
          return;
        }
        response.statusCode = 200;
        if (pathname === "run-tex.js" || pathname === "run-tex.min.js") {
          const source = readFileSync(filePath, "utf8")
            .replaceAll("tex.wasm.gz", "runtime/tex")
            .replaceAll("core.dump.gz", "runtime/core")
            .replaceAll("tex_files/${A}.gz", "runtime/file/${A}");
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-cache");
          response.setHeader(
            "Content-Length",
            String(Buffer.byteLength(source)),
          );
          response.end(source);
          return;
        }
        response.setHeader(
          "Content-Type",
          idmSafeAliases[pathname] || pathname.startsWith(texFilePrefix)
            ? "application/octet-stream"
            : mimeTypes[extname(filePath).toLowerCase()] ||
                "application/octet-stream",
        );
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Length", String(statSync(filePath).size));
        createReadStream(filePath).pipe(response);
      });
    },
  };
}

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
  plugins: [
    serveBundledTikzRuntime(),
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(
            resolve(__dirname, "node_modules/@rod2ik/tikzjax/dist/**/*"),
          ),
          dest: "vendor/tikzjax",
        },
      ],
    }),
  ],
});
