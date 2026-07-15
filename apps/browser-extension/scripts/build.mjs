import { build as viteBuild } from "vite";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = process.argv[2];
if (!new Set(["chrome", "firefox"]).has(target)) throw new Error("Target must be chrome or firefox");
const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist", target);
await rm(out, { recursive: true, force: true });
await viteBuild({ root, mode: target, configFile: resolve(root, "vite.config.ts") });
await viteBuild({
  root,
  configFile: false,
  define: { __TARGET__: JSON.stringify(target) },
  build: {
    outDir: out,
    emptyOutDir: false,
    lib: { entry: resolve(root, "src/content.ts"), name: "LaTeXSnipperContent", formats: ["iife"], fileName: () => "content.js" },
  },
});
await viteBuild({
  root,
  configFile: false,
  define: { __TARGET__: JSON.stringify(target) },
  build: {
    outDir: out,
    emptyOutDir: false,
    lib: { entry: resolve(root, "src/background.ts"), name: "LaTeXSnipperBackground", formats: ["iife"], fileName: () => "background.js" },
  },
});
await mkdir(out, { recursive: true });
await cp(resolve(root, "_locales"), resolve(out, "_locales"), { recursive: true });
const manifest = JSON.parse(await readFile(resolve(root, `manifest.${target}.json`), "utf8"));
await writeFile(resolve(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const providers = ["chatgpt", "gemini", "deepseek", "claude", "copilot", "kimi", "doubao", "qwen", "yuanbao", "perplexity", "grok", "wenxin", "zhipu"];
const provenanceCommit = process.env.LATEXSNIPPER_PROVENANCE_COMMIT || "local";
await writeFile(resolve(out, "provenance.json"), `${JSON.stringify({ extensionVersion: manifest.version, target, commit: provenanceCommit, providers, locales: ["en", "zh_CN", "zh_TW"], formulaDetectorSchema: 1, conversationSchema: 1 }, null, 2)}\n`);
await writeFile(resolve(out, "THIRD_PARTY_LICENSES.txt"), "Build dependencies are listed in package-lock.json. Runtime bundles contain no remote code.\n");
