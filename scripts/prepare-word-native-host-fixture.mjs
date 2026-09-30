import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptRoot, "..");
const options = parseArguments(process.argv.slice(2));
const fixturePath = resolvePath(
  options.fixture,
  join(
    repositoryRoot,
    "apps/native-office/LaTeXSnipper.Word.HostTests/fixtures/word-nary-acceptance-v1.json",
  ),
);
const outputPath = resolvePath(
  options.output,
  join(
    repositoryRoot,
    "src-tauri/target/word-native-host-fixture/word-nary-acceptance.generated.json",
  ),
);
const coreRoot = resolvePath(
  options.coreRoot,
  join(repositoryRoot, "src-tauri/latexsnipper-core"),
);

if (fixturePath.toLowerCase() === outputPath.toLowerCase()) {
  throw new Error(
    "Generated Word fixture must not overwrite the source contract.",
  );
}
if (!options.skipCoreBuild) {
  run("cargo", [
    "build",
    "--locked",
    "-p",
    "latexsnipper-cli",
    "--manifest-path",
    join(coreRoot, "Cargo.toml"),
  ]);
}

const coreCli = resolvePath(
  options.coreCli,
  join(coreRoot, "target/debug/snipper.exe"),
);
const contract = JSON.parse(readFileSync(fixturePath, "utf8"));
if (
  contract?.schemaVersion !== 1 ||
  !Array.isArray(contract.cases) ||
  contract.cases.length === 0
) {
  throw new Error(
    `Word native host fixture contract is invalid: ${fixturePath}`,
  );
}

for (const fixture of contract.cases) {
  if (typeof fixture.latex !== "string" || fixture.latex.trim() === "") {
    throw new Error(`Fixture '${fixture.name}' has no LaTeX source.`);
  }
  const omml = execFileSync(
    coreCli,
    ["render", "--latex", fixture.latex, "--to", "omml"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ).trim();
  if (
    !omml.includes("<m:oMath") ||
    !omml.includes("officeDocument/2006/math")
  ) {
    throw new Error(
      `Core returned invalid OMML for fixture '${fixture.name}'.`,
    );
  }
  fixture.omml = omml;
}

contract.generatedByCoreCommit = execFileSync(
  "git",
  ["-c", "core.fsmonitor=false", "-C", coreRoot, "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
const output = `${JSON.stringify(contract, null, 2)}\n`;
if (Buffer.byteLength(output, "utf8") > 16 * 1024 * 1024) {
  throw new Error(
    "Generated Word native fixture exceeds the 16 MiB safety limit.",
  );
}
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output, "utf8");
console.log(
  `Prepared ${contract.cases.length} native Word fixtures with Core ${contract.generatedByCoreCommit.slice(0, 12)}: ${outputPath}`,
);

function run(command, args) {
  execFileSync(command, args, { cwd: repositoryRoot, stdio: "inherit" });
}

function resolvePath(value, fallback) {
  if (!value) return resolve(fallback);
  return isAbsolute(value) ? resolve(value) : resolve(repositoryRoot, value);
}

function parseArguments(args) {
  const parsed = {
    fixture: "",
    output: "",
    coreRoot: "",
    coreCli: "",
    skipCoreBuild: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--skip-core-build") {
      parsed.skipCoreBuild = true;
      continue;
    }
    const key = {
      "--fixture": "fixture",
      "--output": "output",
      "--core-root": "coreRoot",
      "--core-cli": "coreCli",
    }[argument];
    if (!key || index + 1 >= args.length) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    parsed[key] = args[index + 1];
    index += 1;
  }
  return parsed;
}
