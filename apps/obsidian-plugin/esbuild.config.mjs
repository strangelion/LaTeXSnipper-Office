import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production");

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: [path.join(__dirname, "main.ts")],
  bundle: true,
  format: "cjs",
  target: "es2018",
  platform: "browser",
  outfile: path.join(__dirname, "main.js"),
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  external: ["obsidian"],
};

async function main() {
  const ctx = await esbuild.context(config);
  if (production) {
    await ctx.rebuild();
    console.log("Build complete:", config.outfile);
    process.exit(0);
  } else {
    await ctx.watch();
    console.log("Watching for changes...");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
