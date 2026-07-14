const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const host = process.argv[2];
if (!new Set(["wps", "et", "wpp"]).has(host)) {
  throw new Error("Expected host: wps, et, or wpp");
}

const source = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `latexsnipper-wps-${host}-`));
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (new Set(["dist", "tools", "legacy"]).has(entry.name)) continue;
  fs.cpSync(path.join(source, entry.name), path.join(temporary, entry.name), {
    recursive: true,
  });
}
const packagePath = path.join(temporary, "package.json");
const project = JSON.parse(fs.readFileSync(packagePath, "utf8"));
project.name = `latexsnipper-wps-${host}`;
project.addonType = host;
fs.writeFileSync(packagePath, `${JSON.stringify(project, null, 2)}\n`);

console.log(`[wps-debug] Starting ${host} from isolated workspace ${temporary}`);
const result = spawnSync("wpsjs", ["debug"], {
  cwd: temporary,
  stdio: "inherit",
  shell: process.platform === "win32",
});
fs.rmSync(temporary, { recursive: true, force: true });
process.exit(result.status == null ? 1 : result.status);
