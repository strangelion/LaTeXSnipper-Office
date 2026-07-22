const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (os.platform() !== "win32") {
  console.log("[native-office] skipped: VSTO is Windows-only");
  process.exit(0);
}

const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const rawVersion = process.env.VERSION || packageVersion;

// Convert semver with prerelease to 4-part MSI ProductVersion.
// "1.5.1-rc.4" → "1.5.1.4" so MajorUpgrade can distinguish RC builds.
// Without this, all RC builds share "1.5.1" and component ref-counting
// prevents clean uninstall of shared components (certificates, OLE DLLs).
function toMsiVersion(v) {
  const match = v.match(/^(\d+\.\d+\.\d+)(?:-(?:rc|alpha|beta)\.(\d+))?/);
  if (!match) return v;
  const base = match[1];
  const prereleaseNum = match[2] || "0";
  return `${base}.${prereleaseNum}`;
}

const version = toMsiVersion(rawVersion);
if (version !== rawVersion) {
  console.log(`[native-office] MSI version: ${rawVersion} → ${version}`);
}

const wixPath = path.resolve(".wix", "wix.exe");
const installerArgs = [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  path.join("apps", "native-office", "Installer", "build.ps1"),
  "-OutputDir",
  path.join("apps", "native-office", "Installer", "output"),
  "-Version",
  version,
];
if (fs.existsSync(wixPath)) {
  installerArgs.push("-WixPath", wixPath);
}

execFileSync(
  "powershell.exe",
  installerArgs,
  { stdio: "inherit" },
);
