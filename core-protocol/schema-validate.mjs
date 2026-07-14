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
    "GetSelectedFormula",
    "ReplaceSelectedFormula",
    "DeleteSelectedFormula",
    "InsertEquationReference",
    "GetHostCapabilities",
    "RenderFormula",
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
  check(ts.includes("GetSelectedFormula"), "TS defines GetSelectedFormula");
  check(ts.includes("ReplaceSelectedFormula"), "TS defines ReplaceSelectedFormula");
  check(ts.includes("DeleteSelectedFormula"), "TS defines DeleteSelectedFormula");
  check(ts.includes("InsertEquationReference"), "TS defines InsertEquationReference");
  check(ts.includes("GetHostCapabilities"), "TS defines GetHostCapabilities");
  check(ts.includes("RenderFormula"), "TS defines RenderFormula");
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
  check(ts.includes("interface VstoInsertResult"), "TS defines VstoInsertResult");
  check(ts.includes("errorCode?: string"), "TS VstoInsertResult has optional errorCode");
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
  const protocol = readFileSync(
    resolve(ROOT, "apps/native-office/LaTeXSnipper.Shared/Protocol.cs"),
    "utf-8"
  );
  check(protocol.includes("class VstoInsertResult"), "C# defines VstoInsertResult");
  check(protocol.includes('JsonPropertyName("errorCode")'), "C# protocol includes errorCode");
} catch (e) {
  check(false, `Failed to read C# types: ${e.message}`);
}

// ─── 4. Schema structural validation ────────────────────────────────
console.log("\n[4] Schema structural validation:");
try {
  const schema = JSON.parse(
    readFileSync(resolve(ROOT, "core-protocol", "command.schema.json"), "utf-8")
  );
  const commands = schema.definitions.Command.oneOf;
  const commandNames = commands.map((c) => c.title);

  // Check each command has type and payload
  for (const cmd of commands) {
    const props = cmd.properties;
    check(props?.type?.const === cmd.title, `"${cmd.title}" has correct type const`);
    check(cmd.required.includes("type"), `"${cmd.title}" requires "type" field`);
    check(cmd.required.includes("payload"), `"${cmd.title}" requires "payload" field`);
  }

  // Check InsertFormula has formulaId
  const insertCmd = commands.find((c) => c.title === "InsertFormula");
  check(
    insertCmd.properties.payload.properties.formulaId !== undefined,
    "InsertFormula payload includes formulaId"
  );

  // Check CommandResult has ok
  const result = schema.definitions.CommandResult;
  check(result.oneOf.length === 2, "CommandResult has success and failure variants");

  const insertResult = schema.definitions.VstoInsertResult;
  check(insertResult !== undefined, "Schema defines VstoInsertResult");
  check(insertResult.properties.errorCode !== undefined, "VstoInsertResult includes errorCode");
  check(insertResult.properties.requestedStorageMode !== undefined, "VstoInsertResult includes requestedStorageMode");
  check(insertResult.properties.actualStorageMode !== undefined, "VstoInsertResult includes actualStorageMode");
  check(insertResult.properties.fallbackReason !== undefined, "VstoInsertResult includes fallbackReason");

  // Validate fixture instances against schema structure
  const fixtures = [
    { type: "InsertFormula", payload: { latex: "x^2", display: "block", formulaId: "test-id" } },
    { type: "GetSelectedFormula", payload: {} },
    { type: "ReplaceSelectedFormula", payload: { latex: "x^3", display: "block" } },
    { type: "DeleteSelectedFormula", payload: {} },
    { type: "InsertEquationReference", payload: { formulaId: "test-id" } },
    { type: "GetHostCapabilities", payload: {} },
    { type: "RenderFormula", payload: { latex: "x^2", format: "png" } },
    { type: "ReplaceSelection", payload: { content: "$e^{i\\pi}$" } },
    { type: "GetSelection", payload: {} },
    { type: "ConvertToOMML", payload: { latex: "\\alpha" } },
    { type: "ConvertToLaTeX", payload: { omml: "<m:oMath/>" } },
    { type: "RenderPreview", payload: { latex: "E=mc^2", format: "svg" } },
    { type: "DetectTable", payload: {} },
    { type: "FormatContent", payload: { fontFamily: "serif", fontSize: 12 } },
    { type: "OpenEditor", payload: {} },
    { type: "OpenSettings", payload: {} },
  ];

  for (const fixture of fixtures) {
    const matchingCmd = commands.find((c) => c.title === fixture.type);
    check(
      matchingCmd !== undefined,
      `Fixture "${fixture.type}" matches a schema command`
    );
    if (matchingCmd) {
      const payloadProps = matchingCmd.properties.payload.properties || {};
      const requiredPayloadFields = matchingCmd.properties.payload.required || [];
      const fixturePayload = fixture.payload || {};
      const missing = requiredPayloadFields.filter(
        (f) => !(f in fixturePayload)
      );
      check(
        missing.length === 0,
        `Fixture "${fixture.type}" has all required payload fields`
      );
    }
  }

  console.log(`  ✅ ${fixtures.length} fixture instances validated`);
} catch (e) {
  check(false, `Failed schema structural validation: ${e.message}`);
}

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n${errors.length > 0 ? "❌ FAILED" : "✅ ALL PASSED"} — ${errors.length} error(s)`);
errors.forEach((e) => console.log(`  ${e}`));
process.exit(exitCode);
