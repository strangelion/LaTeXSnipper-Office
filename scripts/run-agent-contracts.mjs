import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import path from "node:path";

const suiteIndex = process.argv.indexOf("--suite");
const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : "all";
if (!suite) throw new Error("--suite requires a suite name");

const contractDir = path.join("contracts", "agent");
const contracts = readdirSync(contractDir)
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => ({
    file: path.join(contractDir, file),
    body: JSON.parse(readFileSync(path.join(contractDir, file), "utf8")),
  }));

function checkMatrix(matrixPath) {
  const body = JSON.parse(readFileSync(matrixPath, "utf8"));
  const rows = body.observations || body.devices || [];
  if (!rows.length) throw new Error("CONTRACT_MATRIX_EMPTY");
  for (const row of rows) {
    if (!["passed", "blocked", "notRun", "unsupported"].includes(row.status)) {
      throw new Error(`CONTRACT_MATRIX_STATUS_INVALID: ${row.id}`);
    }
    if (row.status === "passed" && !(row.evidence || []).length) {
      throw new Error(`CONTRACT_MATRIX_EVIDENCE_MISSING: ${row.id}`);
    }
    if (row.status !== "passed" && !row.reason) {
      throw new Error(`CONTRACT_MATRIX_REASON_MISSING: ${row.id}`);
    }
  }
  return [`${matrixPath} sha256=${sha256(readFileSync(matrixPath))}`];
}

function execute(rule) {
  const started = Date.now();
  try {
    let evidence = [];
    if (rule.evidence.kind === "command") {
      const [command, ...args] = rule.evidence.command;
      const result = spawnSync(command, args, {
        encoding: "utf8",
        shell: false,
      });
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      if (result.status !== 0)
        throw new Error(output || `exit ${result.status}`);
      evidence = output.split(/\r?\n/).filter(Boolean).slice(-20);
    } else if (rule.evidence.kind === "truthfulMatrix") {
      evidence = checkMatrix(rule.evidence.matrix);
    } else {
      throw new Error(`CONTRACT_EVIDENCE_KIND_INVALID: ${rule.evidence.kind}`);
    }
    return {
      id: rule.id,
      status: "passed",
      evidence,
      reason: null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      id: rule.id,
      status: "failed",
      evidence: [],
      reason: error.message,
      durationMs: Date.now() - started,
    };
  }
}

const selected = contracts.flatMap(({ file, body }) =>
  body.rules
    .filter((rule) => suite === "all" || rule.suite === suite)
    .map((rule) => ({ ...rule, contractFile: file })),
);
if (!selected.length) throw new Error(`CONTRACT_SUITE_EMPTY: ${suite}`);
const checks = selected.map(execute);
const report = {
  contractVersion: 1,
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  suite,
  platform: { os: platform(), architecture: arch() },
  checks,
  unsupportedClaims: [],
};
const outputDir = path.join("artifacts", "contracts");
mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, `contract-${suite}.json`);
const json = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(jsonPath, json);
const failures = checks.filter((check) => check.status !== "passed");
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="contract-${suite}" tests="${checks.length}" failures="${failures.length}">${checks
  .map(
    (check) =>
      `<testcase name="${escapeXml(check.id)}" time="${check.durationMs / 1000}">${check.status === "failed" ? `<failure message="${escapeXml(check.reason)}"/>` : ""}</testcase>`,
  )
  .join("")}</testsuite>\n`;
const junitPath = path.join(outputDir, `contract-${suite}.junit.xml`);
writeFileSync(junitPath, xml);
const hashes =
  [
    `${sha256(json)}  ${path.basename(jsonPath)}`,
    `${sha256(xml)}  ${path.basename(junitPath)}`,
  ].join("\n") + "\n";
writeFileSync(path.join(outputDir, `contract-${suite}.sha256`), hashes);
console.log(json.trim());
if (failures.length) process.exitCode = 1;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}
