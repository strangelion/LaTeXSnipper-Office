import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Word automation acquisition is guarded before Object access", () => {
  const adapter = readFileSync(
    "apps/native-office/LaTeXSnipper.Word/Host/WordAdapter.cs",
    "utf8",
  );
  assert.doesNotMatch(adapter, /\.OLEFormat\??\.Object/);
  assert.match(
    adapter,
    /AcquireOwnedAutomation\(\(\) => format\.ProgID,[\s\S]*?ReadSelectedWordStorageClass\(selected\.WordOpenXML\);[\s\S]*?\(\) => format\.Object\)/,
  );
  assert.match(
    adapter,
    /ReleaseLocalComObject\(selected\); ReleaseLocalComObject\(format\)/,
  );
  for (const shape of [
    "inlineShape",
    "shape",
    "candidateOleShape",
    "oleShape",
  ]) {
    assert.ok(adapter.includes(`GetOwnedOleAutomationObject(${shape})`));
  }
  const helper = readFileSync(
    "apps/native-office/LaTeXSnipper.Shared/OleFormulaInterop.cs",
    "utf8",
  );
  const start = helper.indexOf("public static object? AcquireOwnedAutomation");
  const body = helper.slice(start, helper.indexOf("/// <summary>", start));
  assert.ok(
    body.indexOf("string? progId = readProgId();") <
      body.indexOf("return acquire();"),
  );
  assert.match(body, /return null;[\s\S]*return acquire\(\);/);
  assert.doesNotMatch(body, /StartsWith|\.Trim\(/);
  assert.match(
    body,
    /readStorageClass\(\) != OleStorageIdentity\.FormulaClassId/,
  );
});
