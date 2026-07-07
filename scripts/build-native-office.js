const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

if (os.platform() !== "win32") {
  console.log("[native-office] skipped: VSTO is Windows-only");
  process.exit(0);
}

const version = process.env.VERSION || "1.0.0";

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join("apps", "native-office", "Installer", "build.ps1"),
    "-OutputDir",
    path.join("apps", "native-office", "Installer", "output"),
    "-Version",
    version,
  ],
  { stdio: "inherit" },
);
