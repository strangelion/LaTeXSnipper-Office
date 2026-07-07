const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (os.platform() !== "win32") {
  console.log("[native-office] skipped: VSTO is Windows-only");
  process.exit(0);
}

const staging = path.join(
  "apps",
  "native-office",
  "Installer",
  "output",
  "staging",
);

function hasRequiredStaging() {
  const hosts = ["Word", "Excel", "PowerPoint"];
  return (
    hosts.every((host) => {
      const dir = path.join(staging, host);
      return [
        `LaTeXSnipper.${host}.vsto`,
        `LaTeXSnipper.${host}.dll.manifest`,
        `LaTeXSnipper.${host}.dll`,
      ].every((file) => fs.existsSync(path.join(dir, file)));
    }) &&
    fs.existsSync(
      path.join(staging, "Shared", "LaTeXSnipper.NativeOffice.Shared.dll"),
    )
  );
}

if (hasRequiredStaging()) {
  console.log("[native-office] reusing validated VSTO staging output");
  process.exit(0);
}

if (process.env.CI === "true") {
  throw new Error(
    "[native-office] Downloaded VSTO artifact is incomplete. " +
      "The vsto job must produce a complete signed staging payload."
  );
}

execFileSync(
  process.execPath,
  [path.join("scripts", "build-native-office.js")],
  { stdio: "inherit" },
);
