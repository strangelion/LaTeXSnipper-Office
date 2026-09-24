import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BUILTIN_FORMULA_STYLES,
  FormulaStyleStore,
  formulaStyleSnapshot,
  normalizeFormulaStyleProfile,
} from "../src/features/formula-style/profile.js";
import { OfficeCommitController } from "../src/features/office-live-edit/office-commit-controller.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("formula style normalization validates imported values", () => {
  const normalized = normalizeFormulaStyleProfile({
    id: "unsafe id/../",
    name: "  Custom  ",
    math: {
      rendererFont: "remote-font",
      officeFont: "Cambria Math",
      textFont: "Microsoft YaHei",
      fontSizePt: 900,
      fontWeight: "heavy",
      mathVariant: "script",
      color: "red",
    },
    layout: {
      displayMode: "floating",
      alignment: "outside",
      paragraphBeforePt: -1,
      paragraphAfterPt: 999,
      baselineShiftPt: 99,
      maxWidthPt: 12,
    },
    output: { strategy: "remote", background: "url(example)" },
    resources: { customSymbolIds: ["one", "", "two"] },
  });

  assert.equal(normalized.id, "unsafe-id----");
  assert.equal(normalized.name, "Custom");
  assert.equal(normalized.math.rendererFont, "mathjax-tex");
  assert.equal(normalized.math.fontSizePt, 72);
  assert.equal(normalized.math.fontWeight, "normal");
  assert.equal(normalized.math.mathVariant, "tex");
  assert.equal(normalized.math.color, "#000000");
  assert.equal(normalized.layout.paragraphBeforePt, 0);
  assert.equal(normalized.layout.paragraphAfterPt, 144);
  assert.equal(normalized.layout.baselineShiftPt, 36);
  assert.equal(normalized.layout.maxWidthPt, 72);
  assert.equal(normalized.output.strategy, "editable");
  assert.equal(normalized.output.background, "transparent");
  assert.deepEqual(normalized.resources.customSymbolIds, ["one", "two"]);
});

test("custom formula styles persist without mutating built-in profiles", () => {
  const storage = new MemoryStorage();
  const store = new FormulaStyleStore(storage);
  const originalBuiltin = structuredClone(BUILTIN_FORMULA_STYLES[0]);
  const saved = store.saveAs("蓝色讲义", {
    ...store.active(),
    math: {
      ...store.active().math,
      color: "#2563EB",
      mathVariant: "roman",
    },
  });

  assert.equal(saved.builtIn, false);
  assert.equal(saved.math.color, "#2563EB");
  assert.equal(saved.math.mathVariant, "roman");
  assert.deepEqual(BUILTIN_FORMULA_STYLES[0], originalBuiltin);

  const restored = new FormulaStyleStore(storage);
  assert.equal(restored.active().id, saved.id);
  assert.equal(restored.active().name, "蓝色讲义");
  const updated = restored.update(saved.id, {
    ...restored.active(),
    math: { ...restored.active().math, fontSizePt: 16 },
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.math.fontSizePt, 16);
  assert.equal(restored.update("builtin-inline", restored.active()), null);
});

test("formula style bundle export and import are validated and detached", () => {
  const source = new FormulaStyleStore(new MemoryStorage());
  const saved = source.saveAs("投影片", {
    ...source.active(),
    math: { ...source.active().math, fontSizePt: 28 },
  });
  const bundle = source.exportBundle();

  const target = new FormulaStyleStore(new MemoryStorage());
  const [imported] = target.importBundle(bundle);
  assert.notEqual(imported.id, saved.id);
  assert.equal(imported.name, "投影片");
  assert.equal(imported.math.fontSizePt, 28);
  assert.throws(
    () => target.importBundle('{"kind":"unknown","profiles":[]}'),
    /STYLE_BUNDLE_UNSUPPORTED/,
  );
  assert.throws(() => target.importBundle("not json"), /INVALID_JSON/);

  const snapshot = formulaStyleSnapshot(imported);
  imported.math.color = "#FFFFFF";
  assert.notEqual(snapshot.math.color, imported.math.color);
});

test("Office replace requests retain the complete style snapshot", async () => {
  const calls = [];
  const controller = new OfficeCommitController({
    invokeTauri: async (command, args) => {
      calls.push({ command, args });
      if (command === "native_office_replace_formula") {
        return { success: true, formulaId: "f-1", revision: 2 };
      }
      return {};
    },
  });
  const styleProfile = formulaStyleSnapshot({
    ...BUILTIN_FORMULA_STYLES[1],
    math: { ...BUILTIN_FORMULA_STYLES[1].math, color: "#2563EB" },
  });
  const presentation = {
    alignment: "center",
    fontScale: 1.2,
    color: "#2563EB",
    styleProfile,
  };

  const result = await controller.commit(
    "tx-1",
    "session-1",
    "f-1",
    "doc-1",
    "x^2",
    "<m:oMath/>",
    "block",
    null,
    "ole",
    1,
    presentation,
  );

  assert.equal(result.success, true);
  const replace = calls.find(
    ({ command }) => command === "native_office_replace_formula",
  );
  assert.deepEqual(replace.args.presentation, presentation);
});

test("Rust and Native Office protocols both expose styleProfile", () => {
  const rustProtocol = readFileSync(
    new URL("../src-tauri/src/platforms/pipe_protocol.rs", import.meta.url),
    "utf8",
  );
  const rustCommands = readFileSync(
    new URL("../src-tauri/src/commands/native_office.rs", import.meta.url),
    "utf8",
  );
  const nativeProtocol = readFileSync(
    new URL(
      "../apps/native-office/LaTeXSnipper.Shared/Protocol.cs",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(rustProtocol, /rename = "styleProfile"/);
  assert.match(rustProtocol, /style_profile: Option<serde_json::Value>/);
  assert.match(nativeProtocol, /JsonPropertyName\("styleProfile"\)/);
  assert.match(nativeProtocol, /JsonElement\? StyleProfile/);
  assert.equal(
    (rustCommands.match(/presentation: Option<Presentation>/g) || []).length,
    2,
  );
  assert.equal((rustCommands.match(/\n\s*presentation,\n/g) || []).length, 2);
});
