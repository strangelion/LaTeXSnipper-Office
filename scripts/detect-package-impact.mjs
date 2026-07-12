import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const normalize = (value) => value.replaceAll("\\", "/").replace(/^\.\//, "");

const sharedPackage = (path) =>
  /^\.github\/workflows\/(package-.*|main-package-verify)\.yml$/.test(path) ||
  path === ".github/workflows/ci.yml" ||
  path === ".github/workflows/release.yml" ||
  path === "src-tauri/tauri.conf.json" ||
  path === "src-tauri/tauri.ci.conf.json" ||
  path === "src-tauri/Cargo.toml" ||
  path === "src-tauri/Cargo.lock" ||
  path === "package.json" ||
  path === "package-lock.json" ||
  path.startsWith("src/") ||
  path.startsWith("public/") ||
  path.startsWith("apps/obsidian-plugin/") ||
  path.startsWith("apps/vscode-extension/") ||
  path.startsWith("apps/browser-extension/") ||
  path === "index.html" ||
  path.startsWith("vite.config.") ||
  path === "scripts/detect-package-impact.mjs" ||
  path.startsWith("scripts/stage-resources") ||
  path.startsWith("scripts/stage-release-artifacts") ||
  path.startsWith("scripts/stage-ecosystem-resources") ||
  path.startsWith("scripts/verify-package");

export function detectPackageImpact(inputPaths) {
  const paths = [...new Set(inputPaths.map(normalize).filter(Boolean))].sort();
  let windows = false;
  let linux = false;
  let macos = false;
  for (const path of paths) {
    if (sharedPackage(path)) windows = linux = macos = true;
    if (
      path.startsWith("apps/wps/") ||
      path.startsWith("apps/office-addin/") ||
      path.startsWith("src-tauri/resources/")
    ) {
      windows = linux = macos = true;
    }
    if (
      path.startsWith("apps/native-office/") ||
      path === "src-tauri/tauri.windows.conf.json" ||
      path === "src-tauri/tauri.ci.windows.conf.json" ||
      path.startsWith("scripts/invoke-native-office") ||
      path === "scripts/resolve-prior-native-office-msi.ps1" ||
      path === ".github/workflows/native-office-ci.yml" ||
      path.startsWith(".github/actions/setup-native-office/")
    ) {
      windows = true;
    }
    if (
      /linux|deb|rpm/i.test(path) &&
      /package|tauri|bundle|workflow/i.test(path)
    )
      linux = true;
    if (
      /macos|darwin|dmg/i.test(path) &&
      /package|tauri|bundle|workflow/i.test(path)
    )
      macos = true;
  }
  return {
    paths,
    windows_package: windows,
    linux_package: linux,
    macos_package: macos,
    any_package: windows || linux || macos,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = argument("--base");
  const head = argument("--head") || "HEAD";
  let paths;
  const pathsFile = argument("--paths-file");
  if (pathsFile) {
    paths = fs.readFileSync(pathsFile, "utf8").split(/\r?\n/);
  } else {
    let resolvedBase = base;
    if (!resolvedBase || /^0+$/.test(resolvedBase)) resolvedBase = `${head}^`;
    paths = execFileSync("git", ["diff", "--name-only", resolvedBase, head], {
      encoding: "utf8",
    }).split(/\r?\n/);
  }
  const result = detectPackageImpact(paths);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    fs.appendFileSync(
      output,
      Object.entries(result)
        .filter(([key]) => key !== "paths")
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }
  const report = [
    "## Package impact",
    "",
    `- windows_package: ${result.windows_package}`,
    `- linux_package: ${result.linux_package}`,
    `- macos_package: ${result.macos_package}`,
    `- any_package: ${result.any_package}`,
    "",
    "Changed paths:",
    "```",
    ...(result.paths.length ? result.paths : ["(none)"]),
    "```",
    "",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  process.stdout.write(report);
}
