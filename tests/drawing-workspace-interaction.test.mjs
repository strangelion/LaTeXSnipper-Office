import { strict as assert } from "node:assert";
import test from "node:test";
import { createDrawingWorkspaceController } from "../src/features/drawing/workspace.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement extends EventTarget {
  constructor(dataset = {}) {
    super();
    this.dataset = dataset;
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.tabIndex = 0;
    this.focused = false;
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  getAttribute(name) {
    return this.attributes.get(name);
  }
  focus() {
    this.focused = true;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture() {
  const svgButton = new FakeElement({ drawingLanguage: "svg_source" });
  const tikzButton = new FakeElement({
    drawingLanguage: "tikz",
    drawingProfile: "pgf_plots",
  });
  return {
    formulaTab: new FakeElement(),
    drawingTab: new FakeElement(),
    formulaWorkspace: new FakeElement(),
    drawingWorkspace: new FakeElement(),
    languageButtons: [svgButton, tikzButton],
    source: new FakeElement(),
    compileButton: new FakeElement(),
    insertButton: new FakeElement(),
    status: new FakeElement(),
    preview: new FakeElement(),
    readiness: new FakeElement(),
  };
}

test("clicking Drawing changes panels and aria state", () => {
  const elements = fixture();
  const controller = createDrawingWorkspaceController({
    elements,
    compileDrawing: async () => null,
    insertDrawing: async () => null,
    loadReadiness: async () => ({ adapters: [] }),
  });
  assert.equal(elements.drawingWorkspace.hidden, true);
  elements.drawingTab.click();
  assert.equal(controller.state.mode, "drawing");
  assert.equal(elements.formulaWorkspace.hidden, true);
  assert.equal(elements.drawingWorkspace.hidden, false);
  assert.equal(elements.drawingTab.getAttribute("aria-selected"), "true");
  assert.equal(elements.formulaTab.getAttribute("aria-selected"), "false");
});

test("clicking compile transitions state and enables real insert", async () => {
  const elements = fixture();
  const compileRequests = [];
  const inserted = [];
  createDrawingWorkspaceController({
    elements,
    compileDrawing: async (request) => {
      compileRequests.push(request);
      return {
        success: true,
        svg: '<svg viewBox="0 0 10 10"/>',
        payload: { drawingId: "d1", widthPoints: 10, heightPoints: 10 },
      };
    },
    insertDrawing: async (result) => inserted.push(result.payload.drawingId),
    loadReadiness: async () => ({ adapters: [] }),
  });
  elements.languageButtons[1].click();
  assert.match(elements.source.value, /\\draw/);
  elements.compileButton.click();
  await settle();
  assert.equal(compileRequests[0].language, "tikz");
  assert.deepEqual(compileRequests[0].packageProfiles, ["pgf_plots"]);
  assert.equal(elements.preview.innerHTML, '<svg viewBox="0 0 10 10"/>');
  assert.equal(elements.insertButton.disabled, false);
  elements.insertButton.click();
  await settle();
  assert.deepEqual(inserted, ["d1"]);
  assert.equal(elements.status.textContent, "已发送到 Office");
});

test("readiness fields remain truthful after UI mapping", async () => {
  const elements = fixture();
  const controller = createDrawingWorkspaceController({
    elements,
    compileDrawing: async () => null,
    insertDrawing: async () => null,
    loadReadiness: async () => ({
      adapters: [
        {
          language: "tikz",
          level: "declared",
          capabilities: { svgOutput: true },
          experimental: false,
          blocked: false,
          requiresSetup: true,
          diagnostic: "compiler not pinned",
        },
      ],
    }),
  });
  const adapters = await controller.refreshReadiness();
  assert.equal(adapters[0].requiresSetup, true);
  assert.match(elements.readiness.textContent, /tikz: 需要设置/);
});
