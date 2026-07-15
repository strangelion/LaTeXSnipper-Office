import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root },
)
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
    /^(src|src-tauri\/src|apps\/native-office|apps\/wps|apps\/browser-extension\/src)\//.test(
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
const forbiddenWpsProduction = [
  "http://127.0.0.1:8080",
  "127.0.0.1:28765",
  "127.0.0.1:28766",
  "http://127.0.0.1:19876",
  "/convert/latex",
  "Date.now() % 1000",
  "Word.run",
  "Excel.run",
  "PowerPoint.run",
  "Office.context",
  "Microsoft Office manifest",
  "VSTO",
  "IOleObject",
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
  if (
    /^apps\/native-office\/.*\.cs$/i.test(file) &&
    /\bTask\.Run\s*\(/.test(text)
  )
    failures.push(`Office COM code must not use Task.Run: ${file}`);
  if (/^apps\/wps\//i.test(file)) {
    for (const needle of forbiddenWpsProduction) {
      if (text.includes(needle))
        failures.push(
          `forbidden cross-host or legacy WPS value ${needle}: ${file}`,
        );
    }
  }
  if (
    /^apps\/office-addin\//i.test(file) &&
    /(apps\/native-office|Microsoft\.Win32|\bRegistry\b|\bRegAsm\b|\bVSTO\b|\bIOleObject\b)/.test(
      text,
    )
  )
    failures.push(`Windows Native import in Office.js source: ${file}`);
}

const browserProduction = tracked.filter((file) =>
  /^apps\/browser-extension\/(src\/|manifest\.(chrome|firefox)\.json$)/.test(
    file,
  ),
);
for (const file of browserProduction) {
  if (!existsSync(resolve(root, file))) continue;
  const text = readFileSync(resolve(root, file), "utf8");
  for (const needle of [
    "http://127.0.0.1:19876",
    '"<all_urls>"',
    "document.execCommand",
    "eval(",
    "new Function(",
    "document.cookie",
    "localStorage.getItem",
    "Microsoft.Office.Interop",
    "Office.context.document",
    "window.Application",
  ]) {
    if (text.includes(needle))
      failures.push(`forbidden browser production value ${needle}: ${file}`);
  }
  if (/\.innerHTML\s*=/.test(text))
    failures.push(
      `untrusted innerHTML assignment in browser production: ${file}`,
    );
}
const browserContent = readFileSync(
  resolve(root, "apps/browser-extension/src/content.ts"),
  "utf8",
);
if (
  !browserContent.includes('target: "desktop"') ||
  !browserContent.includes('origin: "browser"')
)
  failures.push("browser imports do not explicitly route through the desktop");
const browserBackground = readFileSync(
  resolve(root, "apps/browser-extension/src/background.ts"),
  "utf8",
);
if (
  !browserBackground.includes("InsertFormulaIntoBrowser") ||
  !browserBackground.includes("ImportConversationSelection")
)
  failures.push("browser action directions are not distinct and versioned");
const conversationImport = readFileSync(
  resolve(root, "src-tauri/src/platforms/conversation_import.rs"),
  "utf8",
);
if (/insertHtml|providerHtml|rawOoxml/i.test(conversationImport))
  failures.push("conversation import accepts browser HTML or raw OOXML");

// Ecosystem plugin source files (Obsidian, VS Code) — exclude staged Ecosystem resources
const legacyMigrationFile = "apps/obsidian-plugin/src/settings.ts";

const ecosystemProduction = tracked.filter(
  (file) =>
    /^(apps\/obsidian-plugin|apps\/vscode-extension)\//.test(
      file.replaceAll("\\", "/"),
    ) &&
    // Exclude staged resources (build产物，not source code)
    !file.replaceAll("\\", "/").startsWith("src-tauri/resources/Ecosystem/") &&
    /\.(js|ts|json|html)$/i.test(file),
);

for (const file of ecosystemProduction) {
  if (!existsSync(resolve(root, file))) continue;

  const text = readFileSync(resolve(root, file), "utf8");

  // Skip legacy migration file but verify it defaults to 19877
  if (file === legacyMigrationFile) {
    if (
      !text.includes(
        'DEFAULT_BRIDGE_URL = "http://127.0.0.1:19877"',
      )
    ) {
      failures.push(
        "Obsidian migration file must default to Bridge 19877",
      );
    }
    continue;
  }

  for (const needle of [
    "127.0.0.1:28765",
    "127.0.0.1:28766",
    "http://127.0.0.1:19876",
  ]) {
    if (text.includes(needle)) {
      failures.push(
        `legacy ecosystem Bridge value ${needle}: ${file}`,
      );
    }
  }
}

if (
  existsSync(
    resolve(
      root,
      "src-tauri/resources/Ecosystem/wps",
    ),
  )
) {
  failures.push(
    "duplicate legacy Ecosystem/wps payload must not be bundled; use resources/WPS",
  );
}

const desktopSource = readFileSync(resolve(root, "src/main.js"), "utf8");
if (/fetch\s*\(\s*["']http:\/\/127\.0\.0\.1:19877/.test(desktopSource))
  failures.push(
    "packaged desktop code calls its own HTTP Bridge instead of a Tauri command",
  );
const sharedProtocol = readFileSync(
  resolve(root, "apps/native-office/LaTeXSnipper.Shared/Protocol.cs"),
  "utf8",
);
if (
  /Microsoft\.Office\.Interop|Microsoft\.Win32|\bRegistry\b/.test(
    sharedProtocol,
  )
)
  failures.push(
    "host-neutral Native Office protocol imports host or registry types",
  );

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
