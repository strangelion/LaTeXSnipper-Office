import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

test("Native Office replacement preserves result correlation and concurrency data", () => {
  const csharpProtocol = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Shared",
    "Protocol.cs",
  );
  const wordAddIn = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Word",
    "ThisAddIn.cs",
  );
  const wordAdapter = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Word",
    "Host",
    "WordAdapter.cs",
  );
  const rustProtocol = read(
    "src-tauri",
    "src",
    "platforms",
    "pipe_protocol.rs",
  );
  const session = read("src-tauri", "src", "platforms", "session.rs");
  const pipeServer = read("src-tauri", "src", "platforms", "pipe_server.rs");
  const command = read("src-tauri", "src", "commands", "native_office.rs");
  const frontend = read("src", "main.js");

  assert.match(
    csharpProtocol,
    /JsonPropertyName\("formulaId"\)[\s\S]*FormulaId/,
  );
  assert.match(csharpProtocol, /JsonPropertyName\("revision"\)[\s\S]*Revision/);
  assert.match(
    csharpProtocol,
    /JsonPropertyName\("errorCode"\)[\s\S]*ErrorCode/,
  );
  assert.match(wordAddIn, /FormulaId = result\.FormulaId/);
  assert.match(wordAddIn, /Revision = result\.Revision/);
  assert.match(wordAddIn, /ErrorCode = result\.ErrorCode/);
  assert.match(wordAdapter, /Revision = newPayload\.Revision/);

  assert.match(
    rustProtocol,
    /ReplaceResult \{[\s\S]*formulaId: Option<String>/,
  );
  assert.match(rustProtocol, /ReplaceResult \{[\s\S]*revision: Option<u64>/);
  assert.match(
    rustProtocol,
    /ReplaceResult \{[\s\S]*actualStorageMode: Option<String>/,
  );
  assert.match(
    rustProtocol,
    /ReplaceResult \{[\s\S]*errorCode: Option<String>/,
  );
  assert.match(session, /"native-office-replace-result"/);
  assert.match(session, /"requestId": requestId/);
  assert.match(pipeServer, /expected_context_id: Option<String>/);
  assert.match(pipeServer, /expectedContextId: expected_context_id/);
  assert.match(command, /expected_document_id: Option<String>/);
  assert.match(command, /Ok\(ReplaceResult/);
  assert.match(
    frontend,
    /expectedDocumentId: officeTransaction\.sourceDocumentId \|\| null/,
  );
  assert.match(frontend, /replaceResult\.success/);
});

test("Native Office selection loads a complete formula payload", () => {
  const session = read("src-tauri", "src", "platforms", "session.rs");
  const frontend = read("src", "main.js");

  assert.match(session, /"native-office-formula-loaded"/);
  assert.match(session, /"formula": formula/);
  assert.match(session, /"documentContextId": document_context_id/);
  assert.match(
    session,
    /else if let Some\(xml\) = rangeXml \{[\s\S]*"native-office-latex-loaded"/,
  );
  assert.match(frontend, /listen\("native-office-formula-loaded"/);
  assert.match(frontend, /formula\?\.formulaId/);
});

test("Native Office can re-read an identified formula without relying on selection", () => {
  const csharpProtocol = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Shared",
    "Protocol.cs",
  );
  const wordAddIn = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Word",
    "ThisAddIn.cs",
  );
  const wordAdapter = read(
    "apps",
    "native-office",
    "LaTeXSnipper.Word",
    "Host",
    "WordAdapter.cs",
  );
  const rustProtocol = read(
    "src-tauri",
    "src",
    "platforms",
    "pipe_protocol.rs",
  );
  const session = read("src-tauri", "src", "platforms", "session.rs");
  const command = read("src-tauri", "src", "commands", "native_office.rs");

  assert.match(csharpProtocol, /DesktopRequestReadFormula/);
  assert.match(csharpProtocol, /VstoFormulaSnapshot/);
  assert.match(wordAddIn, /case DesktopRequestReadFormula readFormulaCmd:/);
  assert.match(wordAddIn, /\["read_formula_by_id"\] = true/);
  assert.match(wordAddIn, /\["replace_result_revision"\] = true/);
  assert.match(
    wordAdapter,
    /FormulaPayload\? ReadFormulaById\(string formulaId\)/,
  );
  assert.match(rustProtocol, /RequestReadFormula \{/);
  assert.match(rustProtocol, /FormulaSnapshot \{/);
  assert.match(session, /"native-office-formula-snapshot"/);
  assert.match(command, /native_office_read_formula_by_id/);
});
