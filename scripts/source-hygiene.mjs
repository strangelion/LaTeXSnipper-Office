import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const failures = [];
const forbiddenExtensions = new Set([
  ".pfx",
  ".p12",
  ".pem",
  ".key",
  ".snk",
  ".pdb",
  ".emf",
]);

for (const file of tracked) {
  const lower = file.toLowerCase();
  const extension = extname(lower);
  if (forbiddenExtensions.has(extension))
    failures.push(`forbidden tracked artifact: ${file}`);
  if (extension === ".exe" && /(test|probe|smoke)/i.test(file))
    failures.push(`test executable must not be tracked: ${file}`);
  const allowedSvg =
    lower.startsWith("apps/native-office/fixtures/mathjax-svg/") ||
    lower.includes("/images/") ||
    lower.startsWith("src/public/icons/");
  if (extension === ".svg" && !allowedSvg)
    failures.push(`temporary SVG must not be tracked: ${file}`);
  if (/private[-_.]?key|id_rsa|id_ed25519/.test(lower))
    failures.push(`possible private key: ${file}`);
}

const productionFiles = tracked.filter(
  (file) =>
    /^(src|src-tauri\/src|apps\/native-office|apps\/wps)\//.test(
      file.replaceAll("\\", "/"),
    ) &&
    /\.(rs|cs|cpp|h|js|ts|html)$/i.test(file) &&
    !/(^|\/)(tests?|fixtures?|docs?|target|bin|obj|output[^/]*)(\/|$)/i.test(
      file,
    ) &&
    !/^src\/public\/mathjax\//i.test(file),
);
const forbiddenProduction = [
  ["CreatePlaceholderPresentation", "placeholder presentation"],
  ["DrawFormulaText", "hard-coded formula drawing"],
  ["e^{i\\pi}+1=0", "hard-coded Euler formula"],
];
for (const file of productionFiles) {
  let text;
  try {
    text = readFileSync(resolve(root, file), "utf8");
  } catch {
    continue;
  }
  for (const [needle, description] of forbiddenProduction) {
    if (text.includes(needle))
      failures.push(`${description} in production source: ${file}`);
  }
  if (/\bcatch(?:\s*\([^)]*\))?\s*\{\s*\}/m.test(text))
    failures.push(`empty catch in production source: ${file}`);
  if (/\bThread\.Sleep\s*\(/.test(text))
    failures.push(`Thread.Sleep in production source: ${file}`);
}

const packageVersion = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
const tauri = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const cargo = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (packageVersion !== tauri.version || packageVersion !== cargoVersion)
  failures.push(
    `version mismatch: package=${packageVersion} tauri=${tauri.version} cargo=${cargoVersion}`,
  );
if (JSON.stringify(tauri.bundle.resources).includes("NativeOffice"))
  failures.push("base Tauri config includes Windows NativeOffice resources");

const windowsConfig = readFileSync(
  resolve(root, "src-tauri/tauri.windows.conf.json"),
  "utf8",
);
if (!windowsConfig.includes("resources/NativeOffice/**/*"))
  failures.push("Windows Tauri config does not include NativeOffice resources");

const cppProtocol = readFileSync(
  resolve(
    root,
    "apps/native-office/LaTeXSnipper.OleFormulaObjectNative/src/OleEditSession.h",
  ),
  "utf8",
).match(/kOleEditProtocolVersion\s*=\s*(\d+)/)?.[1];
const rustProtocol = readFileSync(
  resolve(root, "src-tauri/src/platforms/ole_edit.rs"),
  "utf8",
).match(/OLE_EDIT_PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)/)?.[1];
if (!cppProtocol || cppProtocol !== rustProtocol)
  failures.push(
    `OLE edit protocol mismatch: C++=${cppProtocol} Rust=${rustProtocol}`,
  );

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Source hygiene passed (${tracked.length} tracked files, version ${packageVersion}, OLE protocol v${cppProtocol}).`,
);
