import { strict as assert } from "node:assert";
import test from "node:test";
import {
  computeFittedViewBox,
  computePlotYRange,
  createDrawingWorkspaceController,
  fitAndSerializeDrawingPreview,
  fitPlotData,
  migrateLegacyPlotLegend,
  parsePlotDataTable,
  resolveDrawingAuthoringInput,
  resolveVisualProfile,
  tablePayloadToPlotData,
  visualCanvasToolsForLanguage,
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
  pointerInsideDrawingViewport,
  serializeVisualDrawing,
  smoothFreehandPath,
  visualTransformCapabilities,
} from "../src/features/drawing/visual-editor.js";
import {
  parseVisualDocument,
  serializeVisualDocument,
} from "../src/features/drawing/source-adapters.js";

test("Excel TablePayload maps its first two numeric columns to PGFPlots", () => {
  const cell = (text) => ({ inlines: [{ type: "text", text }] });
  const payload = {
    tableId: "excel-1",
    table: {
      rows: [
        { cells: [cell("time"), cell("voltage"), cell("ignored")] },
        { cells: [cell("0"), cell("1.25"), cell("a")] },
        { cells: [cell("1"), cell("2.5"), cell("b")] },
        { cells: [cell("bad"), cell("3"), cell("c")] },
      ],
    },
  };

  assert.deepEqual(tablePayloadToPlotData(payload), {
    headers: ["time", "voltage"],
    points: [
      { x: 0, y: 1.25 },
      { x: 1, y: 2.5 },
    ],
    source: "time,voltage\n0,1.25\n1,2.5",
  });
});

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
    "84 42 232 116",
  );
  assert.equal(
    computeFittedViewBox({ x: 0, y: 0, width: 0, height: 10 }),
    null,
  );
});

test("fitted preview geometry is serialized before Core and Office delivery", () => {
  const attributes = new Map([
    ["viewBox", "0 0 800 520"],
    ["width", "800"],
    ["height", "520"],
  ]);
  const svg = {
    getBBox: () => ({ x: 100, y: 50, width: 200, height: 100 }),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    get outerHTML() {
      return `<svg viewBox="${attributes.get("viewBox")}" preserveAspectRatio="${attributes.get("preserveAspectRatio")}"></svg>`;
    },
  };
  const preview = { querySelector: () => svg };

  const serialized = fitAndSerializeDrawingPreview(
    preview,
    '<svg viewBox="0 0 800 520"></svg>',
  );

  assert.match(serialized, /viewBox="84 42 232 116"/);
  assert.match(serialized, /preserveAspectRatio="xMidYMid meet"/);
  assert.equal(attributes.has("width"), false);
  assert.equal(attributes.has("height"), false);
});

test("freehand canvas tool is exposed only by lossless SVG editing", () => {
  assert.equal(visualCanvasToolsForLanguage("svg_source").freehand, true);
  assert.equal(visualCanvasToolsForLanguage("tikz").freehand, false);
  assert.equal(visualCanvasToolsForLanguage("graphviz_dot").freehand, false);
  assert.equal(visualCanvasToolsForLanguage("mermaid").freehand, false);
  assert.equal(
    visualCanvasToolsForLanguage("tikz", ["pgf_plots"]).freehand,
    false,
  );
  assert.equal(visualCanvasToolsForLanguage("mermaid").pan, true);
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

test("PGFPlots auto Y range follows every visible curve and ignores hidden curves", () => {
  const objects = createProfileDocument("pgf_plots", "plot", {
    expression: "x",
    xMin: -2,
    xMax: 2,
  });
  const plot = objects.find((object) => object.type === "plot");
  objects.push({
    ...structuredClone(plot),
    id: "hidden-outlier",
    expression: "1000*x",
    visible: false,
  });
  const range = computePlotYRange(objects);
  assert.ok(range.min < -2);
  assert.ok(range.max > 2);
  assert.ok(range.max < 10);
  assert.ok(range.tick > 0);
});

test("PGFPlots curve visibility and legend layout serialize to native source", () => {
  const objects = createProfileDocument("pgf_plots", "plot", {
    expression: "sin(x)",
  });
  const axes = objects.find((object) => object.type === "axes");
  const plot = objects.find((object) => object.type === "plot");
  axes.yTick = 0.25;
  axes.legendColumns = 2;
  axes.legendFontSize = 8;
  axes.legendOpacity = 0.75;
  objects.push({
    ...structuredClone(plot),
    id: "hidden-curve",
    expression: "12345*x^3",
    visible: false,
  });
  const source = serializeVisualDocument("pgf_plots", objects).source;
  assert.match(source, /ytick distance=0\.25/);
  assert.match(source, /legend columns=2/);
  assert.match(source, /\\fontsize\{8pt\}/);
  assert.match(source, /fill opacity=0\.75/);
  assert.match(source, /axis description cs:0\.5,-0\.16/);
  assert.doesNotMatch(source, /12345/);
  assert.equal(parseVisualDocument("pgf_plots", source).lossless, true);
});

test("legacy multi-curve PGFPlots legends migrate outside without overriding an explicit choice", () => {
  const legacy = createProfileDocument("pgf_plots", "plot", {
    expression: "sin(x)",
  });
  const axes = legacy.find((object) => object.type === "axes");
  const plot = legacy.find((object) => object.type === "plot");
  axes.legendPosition = "north east";
  legacy.push({ ...structuredClone(plot), id: "second-curve" });

  const migrated = migrateLegacyPlotLegend(legacy);
  assert.equal(migrated.migrated, true);
  assert.equal(
    migrated.objects.find((object) => object.type === "axes").legendPosition,
    "outer south",
  );
  assert.equal(axes.legendPosition, "north east", "input must stay immutable");

  axes.legendPositionUserSet = true;
  const explicit = migrateLegacyPlotLegend(legacy);
  assert.equal(explicit.migrated, false);
  assert.equal(
    explicit.objects.find((object) => object.type === "axes").legendPosition,
    "north east",
  );
});

test("TikZ visual contracts render CJK offline while raw CJK fails clearly", async () => {
  const chinese = serializeVisualDocument(
    "tikz",
    createProfileDocument("tikz", "chinese"),
  ).source;
  const rendered = await renderTikz(chinese, { host: {} });
  assert.match(rendered, /中文 TikZ 流程图/);
  assert.match(rendered, /输入/);

  const plotObjects = createProfileDocument("pgf_plots", "plot");
  plotObjects.find((object) => object.type === "plot").legend = "中文曲线";
  plotObjects.find((object) => object.type === "label").text = "中文曲线";
  const chinesePlot = serializeVisualDocument("pgf_plots", plotObjects).source;
  const renderedPlot = await renderTikz(chinesePlot, {
    host: {},
    packageProfiles: ["pgf_plots"],
  });
  assert.match(renderedPlot, /中文曲线/);

  await assert.rejects(
    renderTikz(String.raw`\\node {中文};`, { host: {} }),
    /不能直接编译未结构化的 CJK 源码/,
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

test("object appearance and typography reach each supported native source", () => {
  const graph = createProfileDocument("graphviz_dot", "hierarchy");
  const graphNode = graph.find((item) => item.type === "node");
  Object.assign(graphNode, {
    color: "#DC2626",
    fill: "#FEF2F2",
    textColor: "#7F1D1D",
    opacity: 0.75,
    fillOpacity: 0.6,
    lineStyle: "dashed",
    fontFamily: "Georgia",
    fontSize: 34,
    cornerRadius: 18,
  });
  const dot = serializeVisualDocument("graphviz_dot", graph).source;
  assert.match(dot, /color="#DC2626BF"/);
  assert.match(dot, /fillcolor="#FEF2F273"/);
  assert.match(dot, /fontcolor="#7F1D1DBF"/);
  assert.match(dot, /style="filled,dashed,rounded"/);
  assert.match(dot, /fontname="Georgia"/);

  const flow = createProfileDocument("mermaid", "flow");
  const flowNode = flow.find((item) => item.type === "node");
  Object.assign(flowNode, {
    color: "#059669",
    fill: "#ECFDF5",
    textColor: "#064E3B",
    lineStyle: "dotted",
    fontFamily: "Arial",
    fontSize: 28,
  });
  const mermaid = serializeVisualDocument("mermaid", flow).source;
  assert.match(
    mermaid,
    /style n\d+ fill:#ECFDF5,stroke:#059669,stroke-width:4px,stroke-dasharray:2 5,color:#064E3B,font-family:Arial/,
  );
});

test("Mermaid node movement is editor layout metadata, not fake native coordinates", () => {
  const objects = createProfileDocument("mermaid", "mindmap");
  const node = objects.find((item) => item.type === "node");
  node.x = 731;
  node.y = 417;
  assert.deepEqual(visualTransformCapabilities(node), {
    move: true,
    resize: false,
    rotate: false,
  });
  const serialized = serializeVisualDocument("mermaid", objects).source;
  const body = serialized.replace(
    /^%% latexsnipper-visual-v1:[^\r\n]+\r?\n/,
    "",
  );
  assert.doesNotMatch(body, /731|417|pos=/);
  const parsed = parseVisualDocument("mermaid", serialized);
  assert.equal(parsed.lossless, true);
  assert.equal(parsed.objects.find((item) => item.id === node.id).x, 731);
  assert.equal(parsed.objects.find((item) => item.id === node.id).y, 417);
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

test("professional SVG freehand objects round-trip without editor overlays", () => {
  const object = {
    ...createProfileDocument("svg_source")[0],
    id: "freehand-contract",
    type: "freehand",
    x: 400,
    y: 260,
    width: 320,
    height: 120,
    pathWidth: 320,
    pathHeight: 120,
    points: [
      { x: 0, y: 80 },
      { x: 80, y: 10 },
      { x: 180, y: 105 },
      { x: 320, y: 40 },
    ],
    color: "#0F172A",
    fill: "none",
    strokeWidth: 5,
    locked: false,
  };
  const serialized = serializeVisualDocument("svg_source", [object]);
  const parsed = parseVisualDocument("svg_source", serialized.source);

  assert.equal(parsed.lossless, true);
  assert.deepEqual(parsed.objects[0].points, object.points);
  assert.match(serialized.source, /<path\b/);
  assert.doesNotMatch(serialized.source, /resize-handle|rotation-handle/);
});

test("locked SVG objects cannot move, resize or rotate", () => {
  const capabilities = visualTransformCapabilities({
    ...createProfileDocument("svg_source")[0],
    locked: true,
  });
  assert.deepEqual(capabilities, {
    move: false,
    resize: false,
    rotate: false,
  });
});

test("professional canvas ignores WebView edge sentinel pointer coordinates", () => {
  assert.equal(pointerInsideDrawingViewport(640, 400, 1280, 800), true);
  assert.equal(pointerInsideDrawingViewport(0, 400, 1280, 800), false);
  assert.equal(pointerInsideDrawingViewport(640, 0, 1280, 800), false);
  assert.equal(pointerInsideDrawingViewport(1280, 400, 1280, 800), false);
  assert.equal(pointerInsideDrawingViewport(640, 800, 1280, 800), false);
});

test("professional SVG freehand paths use midpoint smoothing", () => {
  assert.equal(
    smoothFreehandPath([
      { x: 0, y: 0 },
      { x: 20, y: 30 },
      { x: 50, y: 10 },
      { x: 80, y: 20 },
    ]),
    "M0 0Q20 30 35 20Q50 10 65 15T80 20",
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

test("manual compile is queued behind stale work when live preview is off", async () => {
  const elements = fixture();
  const firstRender = deferred();
  const renderedLanguages = [];
  const controller = createDrawingWorkspaceController({
    elements,
    renderLocal: async ({ language }) => {
      renderedLanguages.push(language);
      if (language === "tikz") return firstRender.promise;
      return '<svg data-generation="graphviz-manual" viewBox="0 0 20 10"/>';
    },
    compileDrawing: async (request) => ({
      success: true,
      svg: request.source,
      payload: {
        drawingId: request.drawingId,
        widthPoints: 20,
        heightPoints: 10,
      },
    }),
    insertDrawing: async () => null,
    loadReadiness: async () => ({ adapters: [] }),
  });

  controller.state.autoPreview = false;
  controller.chooseLanguage(elements.languageButtons[1]);
  const oldCompile = controller.compile();
  await settle();
  controller.chooseLanguage(elements.languageButtons[2]);
  assert.equal(await controller.compile(), null);
  assert.match(elements.status.textContent, /已排队生成最新绘图/);
  firstRender.resolve('<svg data-generation="tikz-old" viewBox="0 0 10 10"/>');
  assert.equal(await oldCompile, null);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(renderedLanguages, ["tikz", "graphviz_dot"]);
  assert.match(elements.preview.innerHTML, /data-generation="graphviz-manual"/);
  assert.doesNotMatch(elements.preview.innerHTML, /tikz-old/);
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
