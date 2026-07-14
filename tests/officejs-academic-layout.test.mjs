import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { DOMParser } from "@xmldom/xmldom";

let office;

before(async () => {
  const output = path.join(
    os.tmpdir(),
    `latexsnipper-officejs-${process.pid}.mjs`,
  );
  await build({
    stdin: {
      contents: [
        'export * from "./apps/office-addin/src/model/formula-payload.ts";',
        'export * from "./apps/office-addin/src/model/equation-layout.ts";',
        'export * from "./apps/office-addin/src/adapters/word-ooxml.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
  });
  office = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
});

function payload(overrides = {}) {
  return {
    schemaVersion: 1,
    formulaId: "abc_123",
    latex: "x^2 + y^2",
    displayMode: "numbered",
    ...overrides,
  };
}

function parse(xml) {
  const errors = [];
  const document = new DOMParser({
    onError: (level, message) => errors.push(`${level}:${message}`),
  }).parseFromString(xml, "application/xml");
  assert.deepEqual(
    errors,
    [],
    `OOXML must be well formed: ${errors.join("; ")}`,
  );
  assert.equal(document.getElementsByTagName("parsererror").length, 0);
  return document;
}

test("formula metadata validates and round-trips Unicode", () => {
  const value = payload({ latex: "\\boldsymbol{α} + 中文" });
  const encoded = office.encodeFormulaMetadata(value);
  assert.deepEqual(office.decodeFormulaMetadata(encoded), value);
  assert.throws(
    () => office.validateFormulaPayload({ ...value, schemaVersion: 2 }),
    /schemaVersion/,
  );
  assert.throws(
    () => office.validateFormulaPayload({ ...value, formulaId: "bad id" }),
    /formulaId/,
  );
  assert.throws(
    () => office.validateFormulaPayload({ ...value, equationLabel: "1 bad" }),
    /label/,
  );
});

test("inline OOXML uses a run-level SDT and preserves semantic math properties", () => {
  const helper = new office.WordOoxmlHelper();
  const xml = helper.buildFormulaOoxml(
    payload({ displayMode: "inline" }),
    '<m:oMath><m:r><m:rPr><m:sty m:val="b"/></m:rPr><m:t>x</m:t></m:r></m:oMath>',
  );
  const document = parse(xml);
  assert.equal(
    document.getElementsByTagName("w:jc").length,
    0,
    "inline formula must not center its paragraph",
  );
  assert.equal(
    document.getElementsByTagName("m:rPr").length,
    1,
    "semantic m:rPr must be preserved",
  );
  const content = document.getElementsByTagName("w:sdtContent")[0];
  assert.equal(
    content.firstChild.nodeName,
    "m:oMath",
    "inline SDT content must be run-level math",
  );
  assert.equal(
    document.getElementsByTagName("lsn:payload").length,
    1,
    "persistent metadata must be present",
  );
  assert.equal(
    document.getElementsByTagName("w:temporary").length,
    0,
    "formula SDT must survive content edits",
  );
});

test("display OOXML centers locally without changing fonts or global styles", () => {
  const helper = new office.WordOoxmlHelper();
  const xml = helper.buildFormulaOoxml(
    payload({ displayMode: "block" }),
    "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>",
  );
  const document = parse(xml);
  assert.equal(
    document.getElementsByTagName("w:jc")[0].getAttribute("w:val"),
    "center",
  );
  assert.equal(
    document.getElementsByTagName("w:ind")[0].getAttribute("w:firstLine"),
    "0",
  );
  assert.equal(document.getElementsByTagName("w:rFonts").length, 0);
  assert.equal(document.getElementsByTagName("w:keepLines").length, 1);
});

for (const [profileId, visible] of [
  ["document-default", "1"],
  ["chapter-dot", "2.1"],
  ["chapter-hyphen", "2-1"],
]) {
  test(`numbered OOXML has fixed symmetric layout and complete fields: ${profileId}`, () => {
    const helper = new office.WordOoxmlHelper();
    const profile = office.getEquationLayoutProfile(profileId);
    const xml = helper.buildFormulaOoxml(
      payload({ layoutProfileId: profileId }),
      "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>",
      profile,
    );
    const document = parse(xml);
    const tableWidth = document.getElementsByTagName("w:tblW")[0];
    assert.equal(tableWidth.getAttribute("w:w"), "5000");
    assert.equal(tableWidth.getAttribute("w:type"), "pct");
    assert.equal(
      document.getElementsByTagName("w:tblLayout")[0].getAttribute("w:type"),
      "fixed",
    );
    const columns = [...document.getElementsByTagName("w:gridCol")];
    assert.equal(columns.length, 3);
    assert.equal(
      columns[0].getAttribute("w:w"),
      columns[2].getAttribute("w:w"),
    );
    assert.equal(document.getElementsByTagName("w:cantSplit").length, 1);
    assert.ok(
      [...document.getElementsByTagName("w:top")].some(
        (node) => node.getAttribute("w:val") === "nil",
      ),
    );
    const alignments = [...document.getElementsByTagName("w:jc")].map((node) =>
      node.getAttribute("w:val"),
    );
    assert.ok(alignments.includes("center"));
    assert.ok(alignments.includes("right"));
    const fieldTypes = [...document.getElementsByTagName("w:fldChar")].map(
      (node) => node.getAttribute("w:fldCharType"),
    );
    assert.ok(
      fieldTypes.includes("begin") &&
        fieldTypes.includes("separate") &&
        fieldTypes.includes("end"),
    );
    const instructions = [...document.getElementsByTagName("w:instrText")]
      .map((node) => node.textContent)
      .join(" ");
    assert.match(instructions, /LaTeXSnipperEquation/);
    const visibleText = [...document.getElementsByTagName("w:t")]
      .map((node) => node.textContent)
      .join("");
    assert.match(visibleText, new RegExp(visible.replace(".", "\\.")));
    assert.equal(
      document
        .getElementsByTagName("w:bookmarkStart")[0]
        .getAttribute("w:name"),
      "LSNEq_abc_123",
    );
  });
}

test("Excel and PowerPoint adapters contain no plain-text formula fallback", () => {
  for (const file of ["excel-adapter.ts", "powerpoint-adapter.ts"]) {
    const source = fs.readFileSync(
      path.join("apps", "office-addin", "src", "adapters", file),
      "utf8",
    );
    assert.doesNotMatch(source, /CoercionType\.Text|setSelectedDataAsync/);
    assert.match(source, /addImage/);
    assert.match(source, /encodeFormulaMetadata/);
  }
});
