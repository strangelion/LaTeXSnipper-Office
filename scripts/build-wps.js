const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const isWindows = os.platform() === "win32";
const shell = isWindows ? "powershell.exe" : "pwsh";
const version =
  process.env.VERSION ||
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
    .version;
const args = ["-NoProfile"];

if (isWindows) {
  args.push("-ExecutionPolicy", "Bypass");
}

args.push(
  "-File",
  path.join("apps", "wps", "build.ps1"),
  "-OutputDir",
  path.join("apps", "wps", "dist"),
  "-Version",
  version,
);

console.log(`[wps] building package for ${os.platform()} (version ${version})`);
execFileSync(shell, args, { stdio: "inherit" });
