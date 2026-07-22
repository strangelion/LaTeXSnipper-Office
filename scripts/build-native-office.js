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

// Convert semver with prerelease to MSI ProductVersion (major.minor.build).
// Windows Installer only uses the first THREE fields for version comparison.
// The 4th field is ignored, so we encode the RC number in the 3rd field.
//
//   "1.5.1-rc.1"  → "1.5.101"
//   "1.5.1-rc.4"  → "1.5.104"
//   "1.5.1"       → "1.5.199"   (stable > any RC)
//   "1.5.2-rc.1"  → "1.5.201"
//
// This gives MajorUpgrade real version discrimination between RC builds.
//
// See: https://learn.microsoft.com/en-us/windows/win32/msi/productversion
function toMsiVersion(v) {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(rc|alpha|beta)\.(\d+))?$/);
  if (!match) return v;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  const kind = match[4];
  const num = parseInt(match[5] || "0", 10);

  let build;
  if (!kind) {
    // Stable release — use high build number so it's > any RC
    build = String(Number(patch) * 100 + 99).padStart(2, "0");
  } else if (kind === "rc") {
    build = String(Number(patch) * 100 + num).padStart(2, "0");
  } else if (kind === "alpha") {
    build = String(Number(patch) * 100 + 200 + num).padStart(2, "0");
  } else {
    build = String(Number(patch) * 100 + 250 + num).padStart(2, "0");
  }

  return `${major}.${minor}.${build}`;
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
