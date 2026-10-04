import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  conversionChoices,
  conversionDocuments,
  collectConversionDocuments,
  prepareManagedFormatConversion,
  executeManagedFormatConversion,
  prepareFormatArtifact,
  prepareSelectionFormatExport,
} from "../src/services/office-format-conversion.js";

const target = {
  host: "word",
  sessionId: "session-a",
  documentContext: "doc-a",
};
const context = {
  native: true,
  connected: true,
  host: "word",
  documentContext: "doc-a",
  managed: true,
  editor: true,
  engine: true,
  ole: true,
};
test("native document enumeration invoke stays Windows-only", () => {
  const source = readFileSync(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /#\[cfg\(target_os = "windows"\)\]\s+commands::native_office::native_office_document_targets,/,
  );
});
test("all open Word documents retain distinct paths and per-document source state", async () => {
  const sessions = [
    {
      host_type: "word",
      session_id: "session-a",
      document_id: "doc-b",
      capabilities: ["open_documents"],
    },
  ];
  const calls = [];
  const documents = await collectConversionDocuments(
    sessions,
    {
      sessionId: "session-a",
      documentContextId: "doc-a",
      formula: { formulaId: "f", latex: "x" },
    },
    true,
    async (id) => {
      calls.push(id);
      return {
        documents: [
          {
            documentContextId: "doc-a",
            documentTitle: "same.docx",
            readOnly: false,
          },
          {
            documentContextId: "doc-b",
            documentTitle: "same.docx",
            readOnly: true,
          },
        ],
      };
    },
  );
  assert.deepEqual(calls, ["session-a"]);
  assert.equal(documents[0].managed, true);
  assert.equal(documents[1].managed, false);
  assert.equal(documents[1].readOnly, true);
  const choices = conversionDocuments({ documents });
  assert.notEqual(choices[0].value, choices[1].value);
  assert.ok(
    conversionChoices(
      { ...context, ...documents[1] },
      "selection",
    ).sources.find((item) => item.value === "selection").reason,
  );
});
test("legacy hosts use only their reported current document without enumeration", async () => {
  const documents = await collectConversionDocuments(
    [
      {
        host_type: "excel",
        session_id: "legacy",
        document_id: "workbook-a",
        document_title: "Book",
      },
      { host_type: "word", session_id: "empty" },
    ],
    undefined,
    true,
    async () => {
      throw new Error("unexpected enumeration");
    },
  );
  assert.equal(documents.length, 1);
  assert.equal(documents[0].documentContext, "workbook-a");
  assert.equal(documents[0].ole, false);
});
test("enumeration failures and malformed target lists fail closed", async () => {
  const sessions = [
    { host_type: "word", session_id: "s", capabilities: ["open_documents"] },
  ];
  for (const documents of [
    null,
    [null],
    [{}],
    [{ documentContextId: "" }],
    [{ documentContextId: "x".repeat(4097) }],
    Array(129).fill({ documentContextId: "x" }),
  ]) {
    await assert.rejects(
      collectConversionDocuments(sessions, undefined, false, async () => ({
        documents,
      })),
      /DOCUMENT_TARGET/,
    );
  }
  await assert.rejects(
    collectConversionDocuments(sessions, undefined, false, async () => {
      throw new Error("host timeout");
    }),
    /host timeout/,
  );
});
function fixture() {
  let formula = {
    formulaId: "formula-a",
    latex: String.raw`\frac{a}{b}`,
    display: "inline",
    storageMode: "native-omml",
    revision: 2,
    presentation: { color: "#123456" },
    numberingTemplate: "({n})",
    render: { png: "YQ==", svg: "<svg/>", widthPt: 30, heightPt: 18 },
  };
  const writes = [];
  const reads = [];
  const api = {
    read: async (bound, id) => {
      reads.push({ bound, id });
      return { success: true, formula: structuredClone(formula) };
    },
    omml: async () => "<m:oMath/>",
    oleAvailable: async () => true,
    render: async () => {
      throw new Error("Stored image should be reused");
    },
    replace: async (bound, payload) => {
      writes.push({ bound, payload: structuredClone(payload) });
      formula = { ...structuredClone(payload), revision: payload.revision + 1 };
      return {
        success: true,
        formulaId: formula.formulaId,
        actualStorageMode: formula.storageMode,
      };
    },
  };
  return {
    api,
    writes,
    reads,
    change: (patch) => Object.assign(formula, patch),
  };
}

test("format matrix allows raw copy exports but not raw/editor OLE", () => {
  for (const source of ["selection", "managed", "editor"]) {
    const { formats } = conversionChoices(context, source);
    assert.ok(formats.find((item) => item.value === "mathtype").reason);
    if (source === "selection")
      assert.deepEqual(
        formats.filter((item) => !item.reason).map((item) => item.value),
        ["omml", "svg", "png", "latex"],
      );
    if (source === "editor")
      assert.ok(formats.find((item) => item.value === "ole").reason);
  }
});
test("document choices pin distinct sessions even with identical titles", () => {
  const documents = [
    { ...target, documentTitle: "Same title", managed: true, ole: true },
    {
      ...target,
      sessionId: "session-b",
      documentContext: "doc-b",
      documentTitle: "Same title",
      managed: false,
      ole: true,
    },
  ];
  const choices = conversionDocuments({ ...context, documents });
  assert.notEqual(choices[0].value, choices[1].value);
  documents[0].documentContext = "changed";
  assert.equal(choices[0].documentContext, "doc-a");
  assert.ok(
    conversionChoices({ ...context, ...choices[1] }, "managed").sources.find(
      (item) => item.value === "managed",
    ).reason,
  );
  assert.deepEqual(conversionDocuments({ ...context, documents: [] }), []);
  assert.throws(
    () =>
      conversionDocuments({
        ...context,
        documents: [documents[1], documents[1]],
      }),
    /会话重复/,
  );
});
test("Office.js stays scoped to its document and supports raw copy exports", () => {
  const choices = conversionChoices({ ...context, native: false }, "selection");
  assert.deepEqual(
    choices.formats.filter((item) => !item.reason).map((item) => item.value),
    ["omml", "svg", "png", "latex"],
  );
  const pane = readFileSync(
    new URL("../apps/office-addin/src/taskpane/taskpane.ts", import.meta.url),
    "utf8",
  );
  const exec = pane.slice(
    pane.indexOf("async function exec("),
    pane.indexOf("Office.onReady("),
  );
  assert.doesNotMatch(exec, /formatConversionBtn/);
  const ready = pane.slice(
    pane.indexOf("Office.onReady("),
    pane.indexOf("async function initializeHost"),
  );
  assert.equal(
    (ready.match(/getElementById\("formatConversionBtn"\)/g) || []).length,
    1,
  );
});
test("Office.js raw copy export releases its range and never commits", async () => {
  for (const format of ["latex", "svg", "png"]) {
    let released = 0;
    const writes = [];
    const controller = {
      prepare: async () => ({ latex: "x^2", svg: "<svg/>" }),
      cancel: async () => {
        released++;
      },
      confirm: async () => {
        writes.push("unexpected write");
      },
    };
    const requests = [];
    const result = await prepareSelectionFormatExport(
      controller,
      format,
      async (...args) => {
        requests.push(args);
        return { content: "cG5n" };
      },
    );
    assert.equal(result.kind, "export");
    assert.equal(result.latex, "x^2");
    assert.equal(released, 1);
    assert.deepEqual(writes, []);
    assert.equal(
      result.artifact.content,
      format === "latex" ? "x^2" : format === "svg" ? "<svg/>" : "cG5n",
    );
    assert.deepEqual(
      requests,
      format === "png" ? [["latex", "png", "x^2", "inline"]] : [],
    );
  }
});
test("Office.js raw export failures release the selection without writing", async () => {
  for (const failAt of ["prepare", "convert"]) {
    let released = 0;
    const controller = {
      prepare: async () => {
        if (failAt === "prepare") throw new Error("invalid source");
        return { latex: "x^2", svg: "<svg/>" };
      },
      cancel: async () => {
        released++;
      },
    };
    await assert.rejects(
      prepareSelectionFormatExport(controller, "png", async () => {
        throw new Error("render failed");
      }),
      /invalid source|render failed/,
    );
    assert.equal(released, 1);
  }
});
test("Office.js cannot claim managed or OLE support", () => {
  const choices = conversionChoices({ ...context, native: false }, "managed");
  assert.ok(choices.sources.find((item) => item.value === "managed").reason);
  assert.ok(choices.formats.find((item) => item.value === "ole").reason);
});
test("offline editor can export LaTeX without an engine", () => {
  const choices = conversionChoices(
    { ...context, connected: false, engine: false },
    "editor",
  );
  assert.deepEqual(
    choices.formats.filter((item) => !item.reason).map((item) => item.value),
    ["latex"],
  );
});
test("preparation is readonly and pins document/source/style/numbering", async () => {
  const f = fixture();
  const plan = await prepareManagedFormatConversion(
    target,
    "formula-a",
    "ole",
    f.api,
  );
  assert.equal(f.writes.length, 0);
  assert.equal(plan.payload.formulaId, "formula-a");
  assert.deepEqual(plan.payload.presentation, { color: "#123456" });
  assert.equal(plan.payload.numberingTemplate, "({n})");
  assert.equal(plan.payload.storageMode, "ole");
  assert.notEqual(plan.target, target);
});
test("cancel does not write and successful execution awaits verified readback", async () => {
  const f = fixture();
  const plan = await prepareManagedFormatConversion(
    target,
    "formula-a",
    "ole",
    f.api,
  );
  assert.deepEqual(await executeManagedFormatConversion(plan, false, f.api), {
    cancelled: true,
  });
  assert.equal(f.writes.length, 0);
  const result = await executeManagedFormatConversion(plan, true, f.api);
  assert.equal(result.verified, true);
  assert.equal(result.formula.revision, 3);
  assert.equal(f.reads.length, 3);
  assert.deepEqual(f.writes[0].bound, target);
  await assert.rejects(
    executeManagedFormatConversion(plan, true, f.api),
    /已执行过/,
  );
  assert.equal(f.writes.length, 1);
});
for (const [name, patch] of Object.entries({
  revision: { revision: 3 },
  source: { latex: "x^2" },
  style: { presentation: { color: "#ffffff" } },
  numbering: { numberingTemplate: "[{n}]" },
})) {
  test(`changed ${name} rejects commit without a write`, async () => {
    const f = fixture();
    const plan = await prepareManagedFormatConversion(
      target,
      "formula-a",
      "omml",
      f.api,
    );
    f.change(patch);
    await assert.rejects(
      executeManagedFormatConversion(plan, true, f.api),
      /已变化/,
    );
    assert.equal(f.writes.length, 0);
  });
}
test("wrong source identity, drawing objects, and missing revision fail preparation", async () => {
  for (const patch of [
    { formulaId: "other" },
    { contentKind: "drawing" },
    { revision: undefined },
  ]) {
    const f = fixture();
    f.change(patch);
    await assert.rejects(
      prepareManagedFormatConversion(target, "formula-a", "ole", f.api),
    );
    assert.equal(f.writes.length, 0);
  }
  await assert.rejects(
    prepareManagedFormatConversion(
      { ...target, documentContext: "" },
      "formula-a",
      "omml",
      fixture().api,
    ),
  );
});
test("unavailable OLE and strict OMML errors fail readonly preparation", async () => {
  const f = fixture();
  f.api.oleAvailable = async () => false;
  await assert.rejects(
    prepareManagedFormatConversion(target, "formula-a", "ole", f.api),
    /OLE 组件不可用/,
  );
  f.api.omml = async () => {
    throw new Error("Unsupported LaTeX");
  };
  await assert.rejects(
    prepareManagedFormatConversion(target, "formula-a", "omml", f.api),
    /Unsupported/,
  );
  assert.equal(f.writes.length, 0);
});
test("host failure and mismatched storage do not automatically retry", async () => {
  for (const response of [
    { success: false, error: "Host rejected" },
    { success: true, formulaId: "formula-a", actualStorageMode: "image" },
  ]) {
    const f = fixture();
    let calls = 0;
    f.api.replace = async () => {
      calls++;
      return response;
    };
    const plan = await prepareManagedFormatConversion(
      target,
      "formula-a",
      "ole",
      f.api,
    );
    await assert.rejects(executeManagedFormatConversion(plan, true, f.api));
    await assert.rejects(
      executeManagedFormatConversion(plan, true, f.api),
      /已执行过/,
    );
    assert.equal(calls, 1);
  }
});
test("unchanged revision after acknowledged write is not marked verified", async () => {
  const f = fixture();
  f.api.replace = async () => ({
    success: true,
    formulaId: "formula-a",
    actualStorageMode: "ole",
  });
  const plan = await prepareManagedFormatConversion(
    target,
    "formula-a",
    "ole",
    f.api,
  );
  await assert.rejects(
    executeManagedFormatConversion(plan, true, f.api),
    /回读未通过/,
  );
});
test("artifact export uses stored image and preserves exact LaTeX", async () => {
  const f = fixture();
  const plan = await prepareManagedFormatConversion(
    target,
    "formula-a",
    "svg",
    f.api,
  );
  assert.equal(plan.artifact.content, "<svg/>");
  assert.equal(f.writes.length, 0);
  const latex = String.raw`\unknown{x}`;
  assert.equal(
    (await prepareFormatArtifact(latex, "latex", "inline", {})).content,
    latex,
  );
});
test("numbered formulas reject in-place conversion until bookmark migration is verified", async () => {
  const f = fixture();
  f.change({ display: "displayNumbered" });
  await assert.rejects(
    prepareManagedFormatConversion(target, "formula-a", "ole", f.api),
    /交叉引用迁移尚未验收/,
  );
  assert.equal(f.writes.length, 0);
  assert.ok(
    (await prepareManagedFormatConversion(target, "formula-a", "latex", f.api))
      .artifact,
  );
});
test("altered prepared payload or destination fails before host writes", async () => {
  for (const field of ["latex", "target"]) {
    const f = fixture();
    const plan = await prepareManagedFormatConversion(
      target,
      "formula-a",
      "ole",
      f.api,
    );
    if (field === "latex") plan.payload.latex = "different";
    else plan.target.documentContext = "doc-b";
    await assert.rejects(
      executeManagedFormatConversion(plan, true, f.api),
      /计划或目标文档已被改动/,
    );
    assert.equal(f.writes.length, 0);
  }
});
test("OLE replacement embeds committed revision before automation readback", () => {
  const source = readFileSync(
    new URL(
      "../apps/native-office/LaTeXSnipper.Word/Host/WordAdapter.cs",
      import.meta.url,
    ),
    "utf8",
  );
  const replace = source.slice(
    source.indexOf("public InsertResult ReplaceFormula"),
    source.indexOf("private InsertResult RollbackCandidate"),
  );
  assert.ok(
    replace.indexOf("newPayload.Revision = Math.Max") <
      replace.indexOf("OleFormulaInterop.ReplacePayloadJson"),
  );
  assert.match(replace, /CONVERSION_TARGET_MISMATCH/);
  assert.match(replace, /if \(newPayload.StorageMode == "ole"\)/);
});
