import { strict as assert } from "node:assert";
import test from "node:test";
import {
  computeFittedViewBox,
  createDrawingWorkspaceController,
  fitPlotData,
  parsePlotDataTable,
  resolveDrawingAuthoringInput,
  resolveVisualProfile,
  visualToolsForLanguage,
} from "../src/features/drawing/workspace.js";
import { toPgfPlotsExpression } from "../src/features/drawing/math-expression.js";
import {
  MERMAID_RENDER_OPTIONS,
  normalizeBundledSvg,
  normalizeMermaidRenderId,
  renderTikz,
} from "../src/features/drawing/local-renderers.js";
import {
  createProfileDocument,
  evaluatePlotExpression,
  materializeVisualObjects,
  serializeVisualDrawing,
} from "../src/features/drawing/visual-editor.js";
import {
  parseVisualDocument,
  serializeVisualDocument,
} from "../src/features/drawing/source-adapters.js";

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

test("drawing previews fit actual ink bounds with stable padding", () => {
  assert.equal(
    computeFittedViewBox({ x: 100, y: 50, width: 200, height: 100 }),
    "84 34 232 132",
  );
  assert.equal(
    computeFittedViewBox({ x: 0, y: 0, width: 0, height: 10 }),
    null,
  );
});

test("Mermaid render ids always form valid CSS id selectors", () => {
  assert.equal(
    normalizeMermaidRenderId("6fc1da09-03be-4cd8"),
    "mermaid-6fc1da09-03be-4cd8",
  );
  assert.equal(normalizeMermaidRenderId("a/b"), "mermaid-a-b");
});

test("Mermaid output disables HTML labels before Core verification", () => {
  assert.equal(MERMAID_RENDER_OPTIONS.htmlLabels, false);
  assert.equal(MERMAID_RENDER_OPTIONS.flowchart.htmlLabels, false);
  const normalized = normalizeBundledSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml"><path d="M0 0"/></svg>',
    "Mermaid",
  );
  assert.doesNotMatch(normalized, /1999\/xhtml/);
  assert.throws(
    () => normalizeBundledSvg("<svg><foreignObject/></svg>", "Mermaid"),
    /不支持的嵌入内容/,
  );
});

test("each drawing language exposes a purpose-built visual toolset", () => {
  assert.equal(visualToolsForLanguage("svg_source").ellipse, "椭圆");
  assert.equal(visualToolsForLanguage("tikz").arrow, "向量");
  assert.equal(visualToolsForLanguage("graphviz_dot").node, "图节点");
  assert.equal(visualToolsForLanguage("mermaid").diamond, "判断节点");
  const pgf = visualToolsForLanguage("tikz", ["pgf_plots"]);
  assert.deepEqual(Object.keys(pgf), ["axes", "plot", "line", "label"]);
});

test("PGFPlots resolves to an independent visual profile", () => {
  assert.equal(resolveVisualProfile("tikz", []), "tikz");
  assert.equal(resolveVisualProfile("tikz", ["pgf_plots"]), "pgf_plots");
  assert.equal(resolveVisualProfile("mermaid", []), "mermaid");
});

test("PGFPlots parses pasted tables and fits supported models offline", () => {
  const points = parsePlotDataTable(
    "x,y\n0,1\n1\t3\n2 5\n# comment\ninvalid,row",
  );
  assert.deepEqual(points, [
    { x: 0, y: 1 },
    { x: 1, y: 3 },
    { x: 2, y: 5 },
  ]);
  const linear = fitPlotData(points, "linear");
  assert.ok(linear.rSquared > 0.999999);
  assert.equal(linear.expression, "(1)+(2)*x");
  assert.equal(evaluatePlotExpression(linear.expression, 4), 9);

  const quadratic = fitPlotData(
    [
      { x: -1, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 4 },
    ],
    "quadratic",
  );
  assert.ok(quadratic.rSquared > 0.999999);
  assert.ok(
    Math.abs(evaluatePlotExpression(quadratic.expression, 3) - 9) < 1e-6,
  );

  const exponential = fitPlotData(
    [
      { x: 0, y: 2 },
      { x: 1, y: 4 },
      { x: 2, y: 8 },
    ],
    "exponential",
  );
  assert.ok(exponential.rSquared > 0.999999);
  assert.ok(
    Math.abs(evaluatePlotExpression(exponential.expression, 3) - 16) < 1e-5,
  );
});

test("PGFPlots fitted data and curve share one native source contract", () => {
  const objects = createProfileDocument("pgf_plots", "plot", {
    expression: "cos(x)",
    legend: "余弦",
  });
  const plot = objects.find((object) => object.type === "plot");
  plot.lineStyle = "dashdotted";
  plot.dataPoints = [
    { x: 0, y: 1 },
    { x: 1, y: 0.54 },
  ];
  const source = serializeVisualDocument("pgf_plots", objects).source;
  assert.match(source, /table\[row sep=\\\\\]/);
  assert.match(source, /0 1 \\\\/);
  assert.match(source, /cos\(deg\(x\)\)/);
  assert.match(source, /dashdotted/);
  assert.match(source, /unbounded coords=jump/);
  assert.match(source, /\\addlegendentry\{samples\}/);
  assert.doesNotMatch(source, /采样点/);
  assert.equal(parseVisualDocument("pgf_plots", source).lossless, true);
});

test("PGFPlots presets share one parser for visual values and native TeX", () => {
  const presets = [
    ["sin(x)", /sin\(deg\(x\)\)/],
    ["cos(x)", /cos\(deg\(x\)\)/],
    ["tan(x)", /tan\(deg\(x\)\)/],
    ["x^2", /\(x\)\^\(2\)/],
    ["x^3", /\(x\)\^\(3\)/],
    ["exp(x)", /exp\(x\)/],
    ["ln(x)", /ln\(x\)/],
    ["1\/(1+exp(-x))", /exp\(-\(x\)\)/],
    ["exp(-x^2)", /exp\(-\(\(x\)\^\(2\)\)\)/],
    ["exp(-0.15*x)*sin(x)", /exp\(\(-\(0\.15\)\)\*\(x\)\).*sin\(deg\(x\)\)/],
  ];
  for (const [expression, expected] of presets) {
    assert.match(toPgfPlotsExpression(expression), expected, expression);
    assert.equal(
      Number.isFinite(evaluatePlotExpression(expression, 0.75)),
      true,
      expression,
    );
  }
  assert.throws(() => toPgfPlotsExpression("sin(x); shell"), /不支持/);
});

test("PGFPlots visual curves use the same axis range as native source", () => {
  const objects = createProfileDocument("pgf_plots", "plot", {
    expression: "x",
    xMin: -1,
    xMax: 1,
  });
  const axes = objects.find((object) => object.type === "axes");
  const plot = objects.find((object) => object.type === "plot");
  axes.yMin = -100;
  axes.yMax = 100;
  plot.yMin = -1;
  plot.yMax = 1;

  const svg = serializeVisualDrawing(objects);
  const source = serializeVisualDocument("pgf_plots", objects).source;
  assert.match(svg, /-150\.0,0\.8/);
  assert.match(source, /ymin=-100/);
  assert.match(source, /ymax=100/);
});

test("TikZ preview rejects unsupported CJK before an opaque DVI failure", async () => {
  await assert.rejects(
    renderTikz(String.raw`\\node {中文};`, { host: {} }),
    /不包含 CJK\/Unicode 数学字体/,
  );
});

test("language-specific documents expose different editing models", () => {
  const tikz = createProfileDocument("tikz", "geometry");
  const pgf = createProfileDocument("pgf_plots", "plot", {
    curve: "gaussian",
  });
  const graph = createProfileDocument("graphviz_dot", "hierarchy");
  const mermaid = createProfileDocument("mermaid", "sequence");
  const mindmap = createProfileDocument("mermaid", "mindmap", {
    root: "研究主题",
  });
  assert.ok(tikz.some((item) => item.text === "angle ABC"));
  assert.equal(pgf.find((item) => item.type === "plot")?.curve, "gaussian");
  assert.ok(graph.some((item) => item.text === "根"));
  assert.deepEqual(
    mermaid.filter((item) => item.type === "node").map((item) => item.text),
    ["用户", "应用", "Office"],
  );
  assert.ok(mindmap.some((item) => item.text === "研究主题"));
});

test("relationship documents use stable endpoint ids and edges follow nodes", () => {
  const graph = createProfileDocument("graphviz_dot", "hierarchy");
  const nodes = graph.filter((item) => item.type === "node");
  const edges = graph.filter((item) => item.type === "connector");
  assert.equal(edges.length, 2);
  assert.ok(edges.every((edge) => edge.fromId && edge.toId));
  assert.ok(
    edges.every(
      (edge) =>
        nodes.some((node) => node.id === edge.fromId) &&
        nodes.some((node) => node.id === edge.toId),
    ),
  );
  const before = materializeVisualObjects(graph).find(
    (item) => item.id === edges[0].id,
  );
  nodes[0].x += 90;
  const after = materializeVisualObjects(graph).find(
    (item) => item.id === edges[0].id,
  );
  assert.notEqual(after.x, before.x);
  const dot = serializeVisualDocument("graphviz_dot", graph).source;
  assert.match(dot, /n\d+ -> n\d+/);
});

test("purpose-built relation labels and mind-map hierarchy reach native source", () => {
  const sequence = createProfileDocument("mermaid", "sequence");
  const sequenceEdge = sequence.find((item) => item.type === "arrow");
  sequenceEdge.text = "提交公式";
  assert.match(
    serializeVisualDocument("mermaid", sequence).source,
    /->>.*: 提交公式/,
  );

  const mindMap = createProfileDocument("mermaid", "mindmap", {
    root: "研究",
  });
  const root = mindMap.find((item) => item.type === "ellipse");
  const children = mindMap.filter((item) => item.type === "node");
  const nested = {
    ...children[1],
    id: "nested-branch",
    text: "子主题",
    x: 650,
    y: 410,
    mindMapChild: true,
  };
  mindMap.push(nested, {
    id: "nested-edge",
    type: "connector",
    fromId: children[0].id,
    toId: nested.id,
    mindMapEdge: true,
    profile: "mermaid",
    x: 0,
    y: 0,
    width: 100,
    height: 36,
    rotation: 0,
    color: "#2563EB",
    fill: "#EFF6FF",
    strokeWidth: 4,
    text: "",
  });
  assert.ok(root);
  const source = serializeVisualDocument("mermaid", mindMap).source;
  assert.match(source, /^mindmap/m);
  assert.match(source, /^      子主题$/m);
});

test("visual authoring compiles the synchronized native source", () => {
  assert.deepEqual(
    resolveDrawingAuthoringInput({
      editorMode: "visual",
      language: "mermaid",
      nativeSource: "flowchart LR\nA --> B",
      packageProfiles: [],
    }),
    {
      language: "mermaid",
      source: "flowchart LR\nA --> B",
      packageProfiles: [],
      visual: true,
    },
  );
  assert.equal(
    resolveDrawingAuthoringInput({
      editorMode: "source",
      language: "mermaid",
      nativeSource: "flowchart LR\nA --> B",
    }).language,
    "mermaid",
  );
});

test("all visual profiles serialize to their native language and round-trip", () => {
  const expectations = {
    svg_source: /<svg\b/,
    tikz: /\\(?:draw|node)/,
    pgf_plots: /\\begin\{axis\}[\s\S]*\\addplot/,
    graphviz_dot: /digraph LaTeXSnipper/,
    mermaid: /(?:flowchart|sequenceDiagram|stateDiagram|mindmap)/,
  };
  for (const profile of Object.keys(expectations)) {
    const objects = createProfileDocument(profile);
    const serialized = serializeVisualDocument(profile, objects);
    assert.match(serialized.source, expectations[profile], profile);
    if (profile !== "svg_source") {
      assert.doesNotMatch(serialized.source, /^<svg\b/, profile);
    }
    const parsed = parseVisualDocument(profile, serialized.source);
    assert.equal(parsed.lossless, true, profile);
    assert.deepEqual(parsed.objects, objects, profile);
    assert.equal(
      serializeVisualDocument(profile, parsed.objects).source,
      serialized.source,
      profile,
    );
  }
});

test("visual contract rejects stale metadata instead of overwriting edited source", () => {
  const serialized = serializeVisualDocument(
    "graphviz_dot",
    createProfileDocument("graphviz_dot"),
  );
  const edited = serialized.source.replace(
    "digraph LaTeXSnipper",
    "digraph UserEdited",
  );
  const parsed = parseVisualDocument("graphviz_dot", edited);
  assert.equal(parsed.lossless, false);
  assert.equal(parsed.source, edited);
  assert.match(parsed.warning, /锁定|内容丢失/);
});

test("recognized native subsets stay locked unless round-trip is provably lossless", () => {
  const pgf = parseVisualDocument(
    "pgf_plots",
    "\\begin{axis}\\addplot[domain=-2:4]{x^2};\\end{axis}",
  );
  assert.equal(pgf.lossless, false);
  assert.equal(pgf.origin, "supported-subset");
  assert.equal(pgf.objects[0].expression, "x^2");
  assert.equal(pgf.objects[0].xMin, -2);
  assert.equal(pgf.objects[0].xMax, 4);

  const mermaid = parseVisualDocument(
    "mermaid",
    'flowchart LR\n  A["输入"]\n  B{"通过？"}',
  );
  assert.equal(mermaid.lossless, false);
  assert.deepEqual(
    mermaid.objects.map((object) => object.text),
    ["输入", "通过？"],
  );
});

test("LaTeX formula objects remain native and survive visual round-trip", () => {
  const objects = [
    {
      ...createProfileDocument("tikz")[0],
      id: "formula-native",
      type: "formula",
      text: "\\frac{a}{b}",
      formulaSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path d="M0 5H20"/></svg>',
    },
  ];
  const serialized = serializeVisualDocument("tikz", objects);
  assert.match(serialized.source, /\$\\frac\{a\}\{b\}\$/);
  assert.equal(
    parseVisualDocument("tikz", serialized.source).objects[0].formulaSvg,
    objects[0].formulaSvg,
  );
});

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
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};

function fixture() {
  const svgButton = new FakeElement({ drawingLanguage: "svg_source" });
  const tikzButton = new FakeElement({
    drawingLanguage: "tikz",
    drawingProfile: "pgf_plots",
  });
  const graphvizButton = new FakeElement({ drawingLanguage: "graphviz_dot" });
  return {
    formulaTab: new FakeElement(),
    drawingTab: new FakeElement(),
    formulaWorkspace: new FakeElement(),
    drawingWorkspace: new FakeElement(),
    languageButtons: [svgButton, tikzButton, graphvizButton],
    source: new FakeElement(),
    compileButton: new FakeElement(),
    insertButton: new FakeElement(),
    copyButton: new FakeElement(),
    sendPlatformButton: new FakeElement(),
    status: new FakeElement(),
    preview: new FakeElement(),
    previewSource: new FakeElement(),
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

test("drawing copy rasterizes the verified SVG into a real PNG clipboard payload", async () => {
  const elements = fixture();
  elements.source.value = '<svg viewBox="0 0 144 72"/>';
  const copies = [];
  const controller = createDrawingWorkspaceController({
    elements,
    compileDrawing: async (request) => ({
      success: true,
      svg: request.source,
      payload: { drawingId: "png-1", widthPoints: 144, heightPoints: 72 },
    }),
    rasterizeDrawing: async (svg, width, height) => {
      assert.match(svg, /<svg/);
      assert.equal(width, 144);
      assert.equal(height, 72);
      return "data:image/png;base64,iVBORw0KGgo=";
    },
    copyDrawing: async (request) => {
      copies.push(request);
      return { writtenFormats: ["image/svg+xml", "image/png"] };
    },
    insertDrawing: async () => null,
    loadReadiness: async () => ({ adapters: [] }),
  });
  await controller.compile();
  await controller.copy();
  assert.equal(copies[0].pngBase64, "data:image/png;base64,iVBORw0KGgo=");
  assert.match(elements.status.textContent, /已复制 2 种格式/);
});

test("drawing platform delivery sends a rasterized PNG attachment", async () => {
  const elements = fixture();
  elements.source.value = '<svg viewBox="0 0 144 72"/>';
  const sent = [];
  const controller = createDrawingWorkspaceController({
    elements,
    compileDrawing: async (request) => ({
      success: true,
      svg: request.source,
      payload: { drawingId: "platform-1", widthPoints: 144, heightPoints: 72 },
    }),
    rasterizeDrawing: async () => "data:image/png;base64,iVBORw0KGgo=",
    sendDrawingToPlatform: async (request) => {
      sent.push(request);
      return { status: "completed" };
    },
    insertDrawing: async () => null,
    loadReadiness: async () => ({ adapters: [] }),
  });
  await controller.compile();
  await controller.sendPlatform();
  assert.equal(sent[0].pngBase64, "data:image/png;base64,iVBORw0KGgo=");
  assert.match(elements.status.textContent, /目标平台保存并插入/);
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
  assert.match(elements.source.value, /\\addplot/);
  elements.compileButton.click();
  await settle();
  assert.equal(compileRequests[0].language, "tikz");
  assert.equal(compileRequests[0].source, elements.source.value);
  assert.doesNotMatch(compileRequests[0].source, /^<svg\b/);
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
  assert.match(elements.readiness.textContent, /tikz: 内置离线/);
});

test("local preview remains visible but insertion stays disabled without Core", async () => {
  const elements = fixture();
  const controller = createDrawingWorkspaceController({
    elements,
    renderLocal: async () => '<svg viewBox="0 0 20 10"/>',
    compileDrawing: async () => {
      throw new Error("__TAURI_INTERNALS__ unavailable");
    },
    insertDrawing: async () => null,
    loadReadiness: async () => ({ adapters: [] }),
  });
  elements.languageButtons[1].click();
  const result = await controller.compile();
  assert.equal(result.localPreviewOnly, true);
  assert.equal(elements.preview.innerHTML, '<svg viewBox="0 0 20 10"/>');
  assert.equal(elements.insertButton.disabled, true);
  assert.match(elements.status.textContent, /本地预览已生成/);
  assert.match(elements.status.textContent, /尚未完成 Core 安全校验/);
});

test("stale drawing work cannot overwrite a newer language generation", async () => {
  const elements = fixture();
  const firstRender = deferred();
  const compileRequests = [];
  const controller = createDrawingWorkspaceController({
    elements,
    renderLocal: async ({ language }) => {
      if (language === "tikz") return firstRender.promise;
      return '<svg data-generation="graphviz" viewBox="0 0 20 10"/>';
    },
    compileDrawing: async (request) => {
      compileRequests.push(request);
      return {
        success: true,
        svg: request.source,
        payload: {
          drawingId: request.drawingId,
          widthPoints: 20,
          heightPoints: 10,
        },
      };
    },
    insertDrawing: async () => null,
    loadReadiness: async () => ({ adapters: [] }),
  });

  elements.languageButtons[1].click();
  const oldCompile = controller.compile();
  await settle();
  elements.languageButtons[2].click();
  firstRender.resolve('<svg data-generation="tikz" viewBox="0 0 10 10"/>');
  assert.equal(await oldCompile, null);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(elements.preview.innerHTML, /data-generation="graphviz"/);
  assert.doesNotMatch(elements.preview.innerHTML, /data-generation="tikz"/);
  assert.equal(controller.state.lastResult?.originalLanguage, "graphviz_dot");
  assert.equal(compileRequests.length, 1);
  assert.equal(elements.insertButton.disabled, false);
});

test("switching drawing language immediately invalidates stale preview evidence", () => {
  const elements = fixture();
  elements.preview.innerHTML = '<svg data-generation="old"/>';
  const controller = createDrawingWorkspaceController({
    elements,
    compileDrawing: async () => null,
    insertDrawing: async () => null,
    loadReadiness: async () => ({ adapters: [] }),
  });
  controller.chooseLanguage(elements.languageButtons[2]);
  assert.equal(elements.preview.innerHTML, "");
  assert.equal(elements.preview.dataset.previewLanguage, "graphviz_dot");
  assert.equal(elements.preview.dataset.previewState, "pending");
  assert.match(elements.previewSource.textContent, /Graphviz.*待生成/);
});

test("visual-editor output excludes canvas grid and editing controls", () => {
  const svg = serializeVisualDrawing([
    {
      id: "node-1",
      type: "node",
      x: 320,
      y: 220,
      width: 240,
      height: 110,
      rotation: 15,
      color: "#2563EB",
      fill: "#EFF6FF",
      strokeWidth: 4,
      text: "节点",
    },
  ]);
  assert.match(svg, /viewBox="0 0 800 520"/);
  assert.match(svg, /data-drawing-object="node-1"/);
  assert.match(svg, /vector-effect="non-scaling-stroke"/);
  assert.match(svg, /markerUnits="userSpaceOnUse"/);
  assert.doesNotMatch(
    svg,
    /drawing-object-controls|drawing-selection-frame|show-grid|background-image/,
  );
  assert.doesNotMatch(svg, /script|foreignObject|href=/i);
});

test("rendered LaTeX can be serialized as an independent safe vector object", () => {
  const svg = serializeVisualDrawing([
    {
      id: "formula-1",
      type: "formula",
      profile: "tikz",
      x: 400,
      y: 260,
      width: 240,
      height: 90,
      rotation: 0,
      color: "#0F766E",
      fill: "#FFFFFF",
      strokeWidth: 2,
      text: "\\frac{a}{b}",
      formulaSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M0 20H100"/></svg>',
    },
  ]);
  assert.match(svg, /scale\(/);
  assert.match(svg, /M0 20H100/);
  assert.doesNotMatch(svg, /foreignObject|script/i);
});
