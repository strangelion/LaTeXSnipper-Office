import assert from "node:assert/strict";
import test from "node:test";

import { FormulaStyleModule } from "../src/modules/office-plugin/formula-style.js";

test("formula formatting never reports success without a host formatter", async () => {
  const module = new FormulaStyleModule();

  const selection = await module.formatSelection();
  const document = await module.formatAll();

  assert.deepEqual(selection, {
    success: false,
    code: "FORMAT_UNSUPPORTED",
    message: "当前 Office 主机尚未提供所选公式格式化能力",
  });
  assert.deepEqual(document, {
    success: false,
    code: "FORMAT_UNSUPPORTED",
    message: "当前 Office 主机尚未提供全文公式格式化能力",
  });
});

test("formula formatting delegates a copy of the configured style", async () => {
  const received = [];
  const formatter = {
    async formatSelection(style) {
      received.push(style);
      style.fontSize = 99;
      return { success: true, message: "selection formatted" };
    },
    async formatAll(style) {
      received.push(style);
      return { success: true, message: "document formatted" };
    },
  };
  const module = new FormulaStyleModule(formatter);
  module.setDefaultStyle({ fontSize: 14, color: "#2563eb" });

  assert.equal((await module.formatSelection()).success, true);
  assert.equal((await module.formatAll()).success, true);
  assert.equal(received[0].fontSize, 99);
  assert.equal(received[1].fontSize, 14);
  assert.equal(module.getDefaultStyle().fontSize, 14);
});

test("formula formatting converts thrown and negative results to explicit failures", async () => {
  const module = new FormulaStyleModule({
    async formatSelection() {
      throw new Error("host unavailable");
    },
    async formatAll() {
      return { success: false, code: "NO_DOCUMENT", message: "no document" };
    },
  });

  assert.deepEqual(await module.formatSelection(), {
    success: false,
    code: "FORMAT_FAILED",
    message: "host unavailable",
  });
  assert.deepEqual(await module.formatAll(), {
    success: false,
    code: "NO_DOCUMENT",
    message: "no document",
  });
});
