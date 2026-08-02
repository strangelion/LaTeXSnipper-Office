const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (os.platform() !== "win32") {
  console.log("[native-office] skipped: VSTO is Windows-only");
  process.exit(0);
}

const packageVersion = JSON.parse(
  fs.readFileSync("package.json", "utf8"),
).version;
const rawVersion = process.env.VERSION || packageVersion;

// build.ps1 is the single owner of semver -> MSI ProductVersion mapping.
// Passing a pre-converted value here would make it convert a second time
// (for example 1.6.0-rc.2 -> 1.6.02 -> 1.6.299).
const version = rawVersion;

const wixPath = path.resolve(".wix", "wix.exe");
const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
const buildScript = path.join(
  "apps",
  "native-office",
  "Installer",
  "build.ps1",
);
const outputDir = path.join("apps", "native-office", "Installer", "output");
let buildCommand =
  "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; " +
  `& ${quotePowerShell(buildScript)} ` +
  `-OutputDir ${quotePowerShell(outputDir)} ` +
  `-Version ${quotePowerShell(version)}`;
if (fs.existsSync(wixPath)) {
  buildCommand += ` -WixPath ${quotePowerShell(wixPath)}`;
}

execFileSync(
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", buildCommand],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      // A PowerShell 7 module path inherited by Windows PowerShell 5.1 can
      // load incompatible type data and prevent the Cert: provider from
      // mounting. Keep this child on the native Windows PowerShell roots.
      PSModulePath: [
        path.join(
          process.env.WINDIR || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "Modules",
        ),
        path.join(
          process.env.ProgramFiles || "C:\\Program Files",
          "WindowsPowerShell",
          "Modules",
        ),
        process.env.USERPROFILE
          ? path.join(
              process.env.USERPROFILE,
              "Documents",
              "WindowsPowerShell",
              "Modules",
            )
          : null,
      ]
        .filter(Boolean)
        .join(path.delimiter),
    },
  },
);
