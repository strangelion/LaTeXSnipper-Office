const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (os.platform() !== "win32") {
  console.log("[native-office] skipped: VSTO is Windows-only");
  process.exit(0);
}

const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const version = process.env.VERSION || packageVersion;
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
