const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

const isWindows = os.platform() === "win32";
const shell = isWindows ? "powershell.exe" : "pwsh";
const args = ["-NoProfile"];

if (isWindows) {
  args.push("-ExecutionPolicy", "Bypass");
}

args.push("-File", path.join("scripts", "stage-resources.ps1"));
execFileSync(shell, args, { stdio: "inherit" });
