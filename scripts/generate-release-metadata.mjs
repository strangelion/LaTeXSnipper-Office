import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  readFileSync(resolve(root, "package-lock.json"), "utf8"),
);
const packages = Object.entries(lock.packages || {})
  .filter(([path, value]) => path && value?.version)
  .map(([path, value]) => ({
    name: value.name || path.replace(/^node_modules\//, ""),
    version: value.version,
    license: value.license || "NOASSERTION",
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const app = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const sbom = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${app.name}-${app.version}`,
  documentNamespace: `https://github.com/strangelion/LaTeXSnipper-Office/releases/${app.version}/sbom`,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ["Tool: LaTeXSnipper release metadata generator"],
  },
  packages: packages.map((item, index) => ({
    name: item.name,
    SPDXID: `SPDXRef-Package-${index + 1}`,
    versionInfo: item.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: item.license,
    licenseDeclared: item.license,
  })),
};
writeFileSync(
  resolve(root, "SBOM.spdx.json"),
  `${JSON.stringify(sbom, null, 2)}\n`,
);
writeFileSync(
  resolve(root, "THIRD-PARTY-LICENSES.json"),
  `${JSON.stringify(packages, null, 2)}\n`,
);
console.log(
  `Release metadata generated for ${packages.length} locked npm packages.`,
);
