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
for (const [environment, parameter] of [
  ["WPS_STAGING", "-WpsStaging"],
  ["NATIVE_OFFICE_STAGING", "-NativeOfficeStaging"],
  ["OFFICEJS_STAGING", "-OfficeJsStaging"],
  ["OBSIDIAN_STAGING", "-ObsidianStaging"],
  ["WPS_SOURCE_NAME", "-WpsSourceName"],
  ["NATIVE_OFFICE_SOURCE_NAME", "-NativeOfficeSourceName"],
  ["OFFICEJS_SOURCE_NAME", "-OfficeJsSourceName"],
  ["OBSIDIAN_SOURCE_NAME", "-ObsidianSourceName"],
]) {
  if (process.env[environment]) args.push(parameter, process.env[environment]);
}
args.push(...process.argv.slice(2));
execFileSync(shell, args, { stdio: "inherit" });
