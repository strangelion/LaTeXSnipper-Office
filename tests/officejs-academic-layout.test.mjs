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
        'export * from "./apps/office-addin/src/adapters/word-adapter.ts";',
        'export * from "./apps/office-addin/src/adapters/word-selection-latex.ts";',
        'export * from "./apps/office-addin/src/adapters/excel-adapter.ts";',
        'export * from "./apps/office-addin/src/adapters/powerpoint-adapter.ts";',
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

test("Office.js explicit selection parser accepts math and rejects ambiguous source", () => {
  for (const source of [
    String.raw`\frac{a}{b}`,
    "x^2+y_1=0",
    String.raw`\begin{matrix}a&b\\c&d\end{matrix}`,
  ]) {
    assert.equal(office.selectionLatex(source), source);
  }
  for (const wrapper of [
    "$x^2$",
    "$$x^2$$",
    String.raw`\(x^2\)`,
    String.raw`\[x^2\]`,
  ]) {
    assert.equal(office.selectionLatex(wrapper), "x^2");
  }
  for (const source of [
    "",
    "ordinary prose",
    String.raw`C:\Users\x^2`,
    "x^2\r",
    "a^2\nb^2",
    String.raw`\frac{a}{b`,
    "$x^2",
    "x^2\\",
    "before $x^2$ after",
    "x^2\u0007y^2",
  ]) {
    assert.throws(() => office.selectionLatex(source), source);
  }
});

function trackedSelectionHarness() {
  const state = {
    text: String.raw`\frac{a}{b}`,
    xml: "<w:r><w:t>original</w:t></w:r>",
    insertions: 0,
    selections: 0,
    tracks: 0,
    releases: 0,
    metadataAdds: 0,
    metadataDeletes: 0,
  };
  const range = {
    get text() {
      return state.text;
    },
    load() {},
    parentContentControlOrNullObject: { isNullObject: true, load() {} },
    contentControls: { items: [], load() {} },
    getOoxml() {
      return { value: state.xml };
    },
    track() {
      state.tracks++;
    },
    untrack() {
      state.releases++;
    },
    insertOoxml(xml) {
      state.insertions++;
      state.insertedXml = xml;
    },
  };
  const context = {
    document: {
      getSelection() {
        state.selections++;
        return range;
      },
    },
    async sync() {},
  };
  globalThis.Word = {
    InsertLocation: { replace: "Replace" },
    run: async (...args) => args.at(-1)(context),
  };
  globalThis.Office = {
    AsyncResultStatus: { Succeeded: "succeeded" },
    context: {
      document: {
        customXmlParts: {
          addAsync(_xml, done) {
            state.metadataAdds++;
            done({
              status: "succeeded",
              value: {
                deleteAsync(callback) {
                  state.metadataDeletes++;
                  callback({ status: "succeeded" });
                },
              },
            });
          },
        },
      },
    },
  };
  const bridge = {
    async convert(_source, format) {
      return {
        content:
          format === "svg"
            ? '<svg xmlns="http://www.w3.org/2000/svg"/>'
            : '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>',
      };
    },
  };
  return { state, controller: new office.WordSelectionLatex(bridge) };
}

test("Office.js selection prepare/cancel is read-only and confirm uses the tracked range once", async () => {
  let { controller, state } = trackedSelectionHarness();
  await controller.prepare();
  assert.equal(state.insertions, 0);
  assert.equal(state.metadataAdds, 0);
  await controller.cancel();
  assert.equal(state.releases, 1);
  assert.equal(state.insertions, 0);

  ({ controller, state } = trackedSelectionHarness());
  await controller.prepare();
  const converted = await controller.confirm();
  assert.equal(converted.latex, state.text);
  assert.equal(state.insertions, 1);
  assert.equal(
    state.selections,
    1,
    "confirmation must not read the newly active selection",
  );
  assert.equal(state.metadataAdds, 1);
  assert.equal(state.metadataDeletes, 0);
  assert.equal(state.releases, 1);
  assert.match(state.insertedXml, /<w:sdt/);
  await assert.rejects(controller.confirm(), /预览/);
});

test("Office.js rejects stale text/format, cleans staged metadata and releases failed previews", async () => {
  for (const key of ["text", "xml"]) {
    const { controller, state } = trackedSelectionHarness();
    await controller.prepare();
    state[key] += "changed";
    await assert.rejects(controller.confirm(), /变化/);
    assert.equal(state.insertions, 0);
    assert.equal(state.metadataDeletes, 1);
    assert.equal(state.releases, 1);
  }
  const { state } = trackedSelectionHarness();
  const controller = new office.WordSelectionLatex({
    async convert() {
      throw new Error("unsupported macro");
    },
  });
  await assert.rejects(controller.prepare(), /unsupported macro/);
  assert.equal(state.insertions, 0);
  assert.equal(state.metadataAdds, 0);
  assert.equal(state.releases, 1);
});

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
    /revision/,
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
    document.getElementsByTagName("w:p").length,
    0,
    "inline insertion fragment must not introduce a paragraph",
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

test("numbered OOXML applies custom delimiters and field numeral styles", () => {
  const helper = new office.WordOoxmlHelper();
  const value = payload({
    numbering: {
      scheme: "global",
      template: "式〔{n}〕",
      numberStyle: "roman-upper",
    },
  });
  const xml = helper.buildFormulaOoxml(
    value,
    "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>",
  );
  const document = parse(xml);
  assert.match(
    [...document.getElementsByTagName("w:instrText")]
      .map((node) => node.textContent)
      .join(" "),
    /\\\* ROMAN/,
  );
  assert.match(
    [...document.getElementsByTagName("w:t")]
      .map((node) => node.textContent)
      .join(""),
    /式〔1〕/,
  );
  assert.deepEqual(
    office.decodeFormulaMetadata(office.encodeFormulaMetadata(value)),
    value,
  );
  assert.throws(
    () =>
      office.validateFormulaPayload({
        ...value,
        numbering: { ...value.numbering, template: "无占位符" },
      }),
    /template/,
  );
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
    const bookmarkStart = document.getElementsByTagName("w:bookmarkStart")[0];
    const bookmarkEnd = document.getElementsByTagName("w:bookmarkEnd")[0];
    assert.notEqual(bookmarkStart.getAttribute("w:id"), "1");
    assert.equal(
      bookmarkStart.getAttribute("w:id"),
      bookmarkEnd.getAttribute("w:id"),
    );
    const cellWidths = [...document.getElementsByTagName("w:tcW")];
    assert.ok(
      cellWidths.every((node) => node.getAttribute("w:type") === "pct"),
    );
  });
}

test("bookmark numeric IDs are stable per formula and distinct across formulas", () => {
  assert.equal(
    office.bookmarkNumericIdForFormula("abc_123"),
    office.bookmarkNumericIdForFormula("abc_123"),
  );
  assert.notEqual(
    office.bookmarkNumericIdForFormula("abc_123"),
    office.bookmarkNumericIdForFormula("def_456"),
  );
});

test("Excel adapter uses official active-shape API and split requirement gates", () => {
  const source = fs.readFileSync(
    path.join("apps", "office-addin", "src", "adapters", "excel-adapter.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /getSelectedShapes|declare const Excel:\s*any/);
  assert.match(source, /getActiveShapeOrNullObject/);
  assert.match(source, /EXCEL_INSERT_API = "1\.10"/);
  assert.match(source, /EXCEL_LIFECYCLE_API = "1\.19"/);
});

test("PowerPoint adapter uses preview addPicture without unsupported shape properties", () => {
  const source = fs.readFileSync(
    path.join(
      "apps",
      "office-addin",
      "src",
      "adapters",
      "powerpoint-adapter.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\.addImage|lockAspectRatio|declare const PowerPoint:\s*any/,
  );
  assert.match(source, /addPicture/);
  assert.match(source, /POWERPOINT_PREVIEW_API_REQUIRED/);
});

test("capabilities split Excel insertion from lifecycle support", async () => {
  globalThis.Office = {
    context: {
      requirements: {
        isSetSupported: (name, version) =>
          name === "ExcelApi" && version === "1.10",
      },
    },
  };
  globalThis.Excel = {
    run: async () => {
      throw new Error("not called");
    },
  };
  const capabilities = await new office.ExcelFormulaAdapter(
    {},
  ).getCapabilities();
  assert.equal(capabilities.insertFormula, true);
  assert.equal(capabilities.readFormula, false);
  assert.equal(capabilities.replaceFormula, false);
  assert.equal(capabilities.deleteFormula, false);
});

test("PowerPoint insert calls preview addPicture with aspect-preserving dimensions", async () => {
  globalThis.Office = {
    context: {
      requirements: {
        isSetSupported: (name, version) =>
          name === "PowerPointApi" && version === "1.10",
      },
    },
  };
  const pictureCalls = [];
  const shapes = {
    addPicture(base64, options) {
      pictureCalls.push({ base64, options });
      return {};
    },
  };
  globalThis.PowerPoint = {
    run: async (callback) =>
      callback({
        presentation: {
          slides: { getItemAt: () => ({ shapes }) },
          getSelectedSlides: () => ({
            items: [{ id: "slide-1", shapes }],
            load() {},
          }),
        },
        async sync() {},
      }),
  };
  const adapter = new office.PowerPointFormulaAdapter({
    convert: async () => ({
      content: "iVBORw0KGgo=",
      widthPt: 1200,
      heightPt: 300,
    }),
  });
  const result = await adapter.insertFormula(payload({ displayMode: "block" }));
  assert.equal(result.ok, true);
  assert.equal(pictureCalls.length, 1);
  assert.equal(pictureCalls[0].options.width, 600);
  assert.equal(pictureCalls[0].options.height, 150);
});

test("inline Word insertion keeps surrounding paragraph structure", async () => {
  let inserted = "";
  let stagedDeleted = false;
  globalThis.Office = {
    context: {
      document: {
        customXmlParts: {
          addAsync: (_xml, callback) =>
            callback({
              status: "succeeded",
              value: {
                deleteAsync: (done) => {
                  stagedDeleted = true;
                  done({ status: "succeeded" });
                },
              },
            }),
        },
      },
    },
  };
  globalThis.Word = {
    run: async (callback) =>
      callback({
        document: {
          getSelection: () => ({
            insertOoxml: (xml) => {
              inserted = xml;
            },
          }),
        },
        async sync() {},
      }),
  };
  const adapter = new office.WordFormulaAdapter({
    convert: async () => ({
      content: "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>",
    }),
  });
  const result = await adapter.insertFormula(
    payload({ displayMode: "inline" }),
  );
  assert.equal(result.ok, true);
  assert.doesNotMatch(inserted, /<w:p[ >]/);
  assert.match(inserted, /<w:sdt/);
  assert.equal(stagedDeleted, false);
});

test("Word replacement failure removes staged metadata and preserves old metadata", async () => {
  const current = payload({ displayMode: "inline" });
  const encoded = office.encodeFormulaMetadata(current);
  const currentXml = `<w:sdt xmlns:w="urn:w"><w:sdtPr><w:tag w:val="latexsnipper:formula:${current.formulaId}"/></w:sdtPr><w:sdtContent><m:oMath xmlns:m="urn:m"/></w:sdtContent><lsn:payload xmlns:lsn="urn:lsn">${encoded}</lsn:payload></w:sdt>`;
  let oldDeletes = 0;
  let stagedDeletes = 0;
  const oldPart = {
    getXmlAsync: (done) =>
      done({
        status: "succeeded",
        value: `<lsn:formula formulaId="${current.formulaId}"><lsn:payload>${encoded}</lsn:payload></lsn:formula>`,
      }),
    deleteAsync: (done) => {
      oldDeletes += 1;
      done({ status: "succeeded" });
    },
  };
  const stagedPart = {
    deleteAsync: (done) => {
      stagedDeletes += 1;
      done({ status: "succeeded" });
    },
  };
  globalThis.Office = {
    context: {
      document: {
        customXmlParts: {
          getByNamespaceAsync: (_namespace, done) =>
            done({ status: "succeeded", value: [oldPart] }),
          addAsync: (_xml, done) =>
            done({ status: "succeeded", value: stagedPart }),
        },
      },
    },
  };
  const parent = {
    tag: `latexsnipper:formula:${current.formulaId}`,
    title: "LaTeXSnipper Formula",
    isNullObject: false,
    load() {},
    getOoxml: () => ({ value: currentXml }),
    getRange: () => ({
      insertOoxml: () => {
        throw new Error("simulated replace failure");
      },
    }),
  };
  globalThis.Word = {
    run: async (callback) =>
      callback({
        document: {
          getSelection: () => ({
            parentContentControlOrNullObject: parent,
            contentControls: { items: [], load() {} },
          }),
        },
        async sync() {},
      }),
  };
  const adapter = new office.WordFormulaAdapter({
    convert: async () => ({
      content: "<m:oMath><m:r><m:t>y</m:t></m:r></m:oMath>",
    }),
  });
  const result = await adapter.replaceSelectedFormula({
    ...current,
    latex: "y",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "WORD_REPLACE_FAILED");
  assert.equal(stagedDeletes, 1);
  assert.equal(oldDeletes, 0);
});

test("Native Word numbering owns a fixed three-column table and is transactional", () => {
  const source = fs.readFileSync(
    path.join(
      "apps",
      "native-office",
      "LaTeXSnipper.Word",
      "Host",
      "WordAdapter.cs",
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /TabStops\.ClearAll\s*\(/);
  assert.match(source, /PrepareNumberedOleInsertionRange\(doc, range\)/);
  assert.match(source, /doc\.Tables\.Add\(insertionRange, 1, 3\)/);
  assert.match(source, /layoutTable\.Cell\(1, 3\)\.Range\.Duplicate/);
  assert.match(source, /var ownedRange = layoutTable\.Range\.Duplicate/);
  assert.match(source, /cc\.Delete\(false\)/);
  assert.match(source, /hide-numbered-ole-content-control/);
  assert.match(source, /recover-numbered-ole-content-control/);
  assert.match(source, /rollback-numbered-ole/);
  assert.match(source, /ErrorCode = "OLE_NUMBERING_FAILED"/);
  assert.doesNotMatch(source, /Numbering is best-effort/);
  assert.match(source, /BookmarkNumericId\(formulaId\)/);
  assert.doesNotMatch(source, /w:bookmarkStart w:id=""1""/);
  assert.match(source, /GetContainerWidthTwips\(range\)/);
});

test("Native Office install failure is attributed to office-native", () => {
  const source = fs.readFileSync(
    path.join("src-tauri", "src", "platforms", "integrations.rs"),
    "utf8",
  );
  assert.match(
    source,
    /if !ole\.success[\s\S]*?PlatformIntegrationResult::fail\(\s*"office-native",\s*"native-stack"/,
  );
});

test("generic Office registration delegates operating-system routing to Rust", () => {
  const source = fs.readFileSync(path.join("src", "main.js"), "utf8");
  const registerStart = source.indexOf("  async registerPlatform(platform)");
  const unregisterStart = source.indexOf(
    "  async unregisterPlatform(platform)",
    registerStart,
  );
  assert.notEqual(registerStart, -1);
  assert.notEqual(unregisterStart, -1);
  const registerSource = source.slice(registerStart, unregisterStart);

  assert.match(
    registerSource,
    /invoke\("install_platform_integration",\s*\{\s*platformId: "office"/,
  );
  assert.doesNotMatch(registerSource, /getOfficeStatus\(\)/);
  assert.doesNotMatch(registerSource, /detect_office/);
  assert.doesNotMatch(registerSource, /if\s*\(\s*!status\.installed\s*\)/);
});

test("generic Office status and macOS host discovery are platform-aware", () => {
  const frontend = fs.readFileSync(path.join("src", "main.js"), "utf8");
  const officeBackend = fs.readFileSync(
    path.join("src-tauri", "src", "platforms", "office.rs"),
    "utf8",
  );

  assert.match(frontend, /getPlatformIntegrationStatus\("office"\)/);
  assert.doesNotMatch(frontend, /invoke\("native_office_status"\)/);
  assert.match(officeBackend, /fn detect_windows_office\(\)/);
  assert.match(officeBackend, /fn detect_macos_office\(\)/);
  assert.match(officeBackend, /Microsoft Word\.app/);
  assert.match(officeBackend, /Microsoft Excel\.app/);
  assert.match(officeBackend, /Microsoft PowerPoint\.app/);
  assert.match(officeBackend, /home\.join\("Applications"\)/);
});
