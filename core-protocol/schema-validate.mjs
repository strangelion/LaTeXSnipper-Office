/**
 * LaTeXSnipper Protocol Schema Validator
 *
 * Validates that:
 * 1. JSON Schema is well-formed
 * 2. Each command in the TS types has a matching JSON Schema definition
 * 3. Each command in the C# types has a matching JSON Schema definition
 *
 * Usage: node core-protocol/schema-validate.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let exitCode = 0;
const errors = [];

function check(condition, msg) {
  if (!condition) {
    errors.push(`❌ ${msg}`);
    exitCode = 1;
  } else {
    console.log(`  ✅ ${msg}`);
  }
}

// ─── 1. JSON Schema well-formed ──────────────────────────────────────
console.log("\n[1] JSON Schema validation:");
try {
  const schema = JSON.parse(
    readFileSync(resolve(ROOT, "core-protocol", "command.schema.json"), "utf-8")
  );
  check(true, "command.schema.json is valid JSON");

  const commands = schema.definitions.Command.oneOf;
  check(
    commands.length >= 10,
    `Schema defines ${commands.length} commands (expected >= 10)`
  );

  const commandNames = commands.map((c) => c.title);
  const expectedCommands = [
    "InsertFormula",
    "ReplaceSelection",
    "GetSelection",
    "ConvertToOMML",
    "ConvertToLaTeX",
    "RenderPreview",
    "DetectTable",
    "FormatContent",
    "OpenEditor",
    "OpenSettings",
  ];

  for (const name of expectedCommands) {
    check(
      commandNames.includes(name),
      `Schema includes "${name}" command`
    );
  }
} catch (e) {
  check(false, `Failed to parse JSON Schema: ${e.message}`);
}

// ─── 2. TS types exist ──────────────────────────────────────────────
console.log("\n[2] TypeScript type definitions:");
try {
  const ts = readFileSync(
    resolve(ROOT, "core-protocol", "command.schema.ts"),
    "utf-8"
  );
  check(ts.includes("InsertFormula"), "TS defines InsertFormula");
  check(ts.includes("ReplaceSelection"), "TS defines ReplaceSelection");
  check(ts.includes("GetSelection"), "TS defines GetSelection");
  check(ts.includes("ConvertToOMML"), "TS defines ConvertToOMML");
  check(ts.includes("ConvertToLaTeX"), "TS defines ConvertToLaTeX");
  check(ts.includes("RenderPreview"), "TS defines RenderPreview");
  check(ts.includes("DetectTable"), "TS defines DetectTable");
  check(ts.includes("FormatContent"), "TS defines FormatContent");
  check(ts.includes("OpenEditor"), "TS defines OpenEditor");
  check(ts.includes("OpenSettings"), "TS defines OpenSettings");
  check(ts.includes("formulaId"), "TS InsertFormula has formulaId field");
} catch (e) {
  check(false, `Failed to read TS types: ${e.message}`);
}

// ─── 3. C# types exist ─────────────────────────────────────────────
console.log("\n[3] C# type definitions:");
try {
  const cs = readFileSync(
    resolve(ROOT, "apps/native-office/LaTeXSnipper.Shared/CommandMessage.cs"),
    "utf-8"
  );
  check(cs.includes("InsertFormula"), "C# defines InsertFormula");
  check(cs.includes("ReplaceSelection"), "C# defines ReplaceSelection");
  check(cs.includes("GetSelection"), "C# defines GetSelection");
  check(cs.includes("ConvertToOMML"), "C# defines ConvertToOMML");
  check(cs.includes("ConvertToLaTeX"), "C# defines ConvertToLaTeX");
  check(cs.includes("RenderPreview"), "C# defines RenderPreview");
  check(cs.includes("DetectTable"), "C# defines DetectTable");
  check(cs.includes("FormatContent"), "C# defines FormatContent");
  check(cs.includes("OpenEditor"), "C# defines OpenEditor");
  check(cs.includes("OpenSettings"), "C# defines OpenSettings");
  check(cs.includes("FormulaId"), "C# InsertFormula has FormulaId field");
} catch (e) {
  check(false, `Failed to read C# types: ${e.message}`);
}

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n${errors.length > 0 ? "❌ FAILED" : "✅ ALL PASSED"} — ${errors.length} error(s)`);
errors.forEach((e) => console.log(`  ${e}`));
process.exit(exitCode);
