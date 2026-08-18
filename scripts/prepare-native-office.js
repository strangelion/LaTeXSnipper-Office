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
const nativeSourceRoot = path.join("apps", "native-office");
const repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim().toLowerCase();

function newestSourceMtimeMs(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "Installer" || entry.name === "bin" || entry.name === "obj") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtimeMs(fullPath));
      continue;
    }
    if (!/\.(cs|csproj|cpp|h|idl|rc|vcxproj|props)$/i.test(entry.name)) {
      continue;
    }
    newest = Math.max(newest, fs.statSync(fullPath).mtimeMs);
  }

  return newest;
}

function requiredStagingFiles() {
  const files = [];
  for (const host of ["Word", "Excel", "PowerPoint"]) {
    for (const file of [
      `LaTeXSnipper.${host}.vsto`,
      `LaTeXSnipper.${host}.dll.manifest`,
      `LaTeXSnipper.${host}.dll`,
    ]) {
      files.push(path.join(staging, host, file));
    }
  }
  files.push(
    path.join(staging, "Shared", "LaTeXSnipper.NativeOffice.Shared.dll"),
    path.join(staging, "OleFormulaObject.x86.dll"),
    path.join(staging, "OleFormulaObject.x64.dll"),
    path.join(staging, "certificates", "LaTeXSnipperOffice.cer"),
    path.join(staging, "certificates", "native-office-signing.json"),
    path.join(staging, "build-provenance.json"),
  );
  return files;
}

function hasRequiredStaging() {
  const requiredFiles = requiredStagingFiles();
  if (!requiredFiles.every((file) => fs.existsSync(file))) {
    return false;
  }

  try {
    const provenance = JSON.parse(
      fs.readFileSync(path.join(staging, "build-provenance.json"), "utf8"),
    );
    if (String(provenance.sourceCommitSha || "").toLowerCase() !== repositoryCommit) {
      console.warn(
        `[native-office] refusing staging from commit ${provenance.sourceCommitSha || "unknown"}; expected ${repositoryCommit}`,
      );
      return false;
    }
  } catch (error) {
    console.warn(`[native-office] invalid staging provenance: ${error.message}`);
    return false;
  }

  const newestSource = newestSourceMtimeMs(nativeSourceRoot);
  const stagingUpdated = fs.statSync(staging).mtimeMs;
  return stagingUpdated >= newestSource;
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
