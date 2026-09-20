import {
  drawingAdapterReadiness,
  planDrawingOfficeRoute,
  selectDrawingOfficeRoute,
} from "./office-routing.js";
import { renderDrawingLocally } from "./local-renderers.js";
import {
  createVisualDrawingEditor,
  visualTransformCapabilities,
} from "./visual-editor.js";
import {
  evaluatePlotExpression,
  parsePlotExpression,
} from "./math-expression.js";
import {
  parseVisualDocument,
  serializeVisualDocument,
  visualProfileKey,
} from "./source-adapters.js";

const DEFAULT_SOURCES = Object.freeze({
  svg_source:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="12" y="12" width="296" height="156" rx="18" fill="#eef2ff" stroke="#4f46e5" stroke-width="4"/><path d="M72 112 L140 52 L248 126" fill="none" stroke="#0f172a" stroke-width="6"/><circle cx="140" cy="52" r="9" fill="#4f46e5"/></svg>',
  tikz: "\\draw[->, thick] (0,0) -- (3,0) node[right] {$x$};\n\\draw[->, thick] (0,0) -- (0,2) node[above] {$y$};",
  pgf_plots:
    "\\begin{axis}[grid=major, xlabel={$x$}, ylabel={$f(x)$}]\n  \\addplot[blue, thick, domain=-3:3, samples=100] {x^2};\n\\end{axis}",
  graphviz_dot: "digraph G { rankdir=LR; Input -> Parse -> Office; }",
  mermaid:
    "flowchart LR\n  A[输入] --> B{验证}\n  B -->|通过| C[Office]\n  B -->|失败| D[诊断]",
});

const TOOL_SNIPPETS = Object.freeze({
  line: {
    svg_source:
      '<line x1="40" y1="40" x2="220" y2="120" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\draw[thick] (0,0) -- (3,1);",
  },
  arrow: {
    svg_source:
      '<path d="M40 120 H240 M220 100 L240 120 L220 140" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\draw[-{Stealth}, thick] (0,0) -- (3,0);",
    graphviz_dot: "A -> B;",
    mermaid: "A --> B",
  },
  connector: {
    svg_source:
      '<path d="M40 100 C120 20 200 180 280 100" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\draw[-{Stealth}, thick] (A) to[bend left=25] (B);",
    graphviz_dot: 'A -> B [label="关系"];',
    mermaid: "A -->|关系| B",
  },
  freehand: {
    svg_source:
      '<path d="M40 120 C90 35 170 185 280 80" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  },
  node: {
    svg_source:
      '<rect x="60" y="50" width="160" height="80" rx="16" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\node[draw, rounded corners] (A) at (0,0) {Node};",
    graphviz_dot: 'A [label="节点", shape=box];',
    mermaid: "A[节点]",
  },
  rectangle: {
    svg_source:
      '<rect x="60" y="50" width="200" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\node[draw, minimum width=3cm, minimum height=1.5cm] {Rectangle};",
  },
  ellipse: {
    svg_source:
      '<ellipse cx="160" cy="100" rx="100" ry="55" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\node[draw, ellipse, minimum width=3cm] {Ellipse};",
  },
  diamond: {
    svg_source:
      '<path d="M160 35 L270 100 L160 165 L50 100 Z" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\node[draw, diamond, aspect=2] {Decision};",
    mermaid: "A{判断}",
  },
  triangle: {
    svg_source:
      '<polygon points="160,30 285,165 35,165" fill="none" stroke="currentColor" stroke-width="4"/>',
  },
  star: {
    svg_source:
      '<polygon points="160,25 190,105 278,108 208,160 230,245 160,196 90,245 112,160 42,108 130,105" fill="none" stroke="currentColor" stroke-width="4"/>',
  },
  axes: {
    tikz: "\\draw[->] (-3,0) -- (3,0) node[right] {$x$};\n\\draw[->] (0,-2) -- (0,2) node[above] {$y$};",
    svg_source:
      '<path d="M30 150 H290 M270 135 L290 150 L270 165 M160 175 V20 M145 40 L160 20 L175 40" fill="none" stroke="currentColor" stroke-width="3"/>',
  },
  plot: {
    tikz: "\\begin{axis}[grid=major]\\addplot[domain=-3:3,samples=100]{sin(deg(x))};\\end{axis}",
    mermaid: "xychart-beta\n  x-axis [1, 2, 3, 4]\n  line [2, 5, 3, 8]",
  },
  label: {
    svg_source:
      '<text x="80" y="100" font-size="32" fill="currentColor">标签</text>',
    tikz: "\\node at (0,0) {$f(x)$};",
    graphviz_dot: 'label="图标题";',
    mermaid: "title 图标题",
  },
});

const VISUAL_TOOLSETS = Object.freeze({
  svg_source: {
    freehand: "自由画笔",
    line: "线段",
    arrow: "箭头",
    connector: "连接线",
    node: "节点",
    rectangle: "矩形",
    ellipse: "椭圆",
    diamond: "菱形",
    triangle: "三角形",
    star: "星形",
    axes: "坐标轴",
    plot: "函数图",
    label: "标签",
  },
  tikz: {
    line: "几何线",
    arrow: "向量",
    connector: "曲线路径",
    node: "TikZ 节点",
    rectangle: "矩形",
    ellipse: "椭圆",
    diamond: "判定形",
    axes: "坐标轴",
    label: "数学标注",
  },
  pgf_plots: {
    axes: "坐标系",
    plot: "函数曲线",
    line: "辅助线",
    label: "图例标注",
  },
  graphviz_dot: {
    node: "图节点",
    connector: "有向边",
    arrow: "直连边",
    diamond: "判定节点",
    rectangle: "矩形节点",
    label: "图标题",
  },
  mermaid: {
    node: "流程节点",
    diamond: "判断节点",
    connector: "流程关系",
    arrow: "直接流程",
    rectangle: "矩形节点",
    label: "图表标题",
  },
});

export function visualToolsForLanguage(language, packageProfiles = []) {
  const key = resolveVisualProfile(language, packageProfiles);
  return { ...(VISUAL_TOOLSETS[key] || VISUAL_TOOLSETS.svg_source) };
}

export function visualCanvasToolsForLanguage(language, packageProfiles = []) {
  const profile = resolveVisualProfile(language, packageProfiles);
  return Object.freeze({
    select: true,
    pan: true,
    freehand: profile === "svg_source",
  });
}

export function resolveVisualProfile(language, packageProfiles = []) {
  return packageProfiles.includes("pgf_plots") ? "pgf_plots" : language;
}

const VISUAL_PROFILE_NAMES = Object.freeze({
  svg_source: "SVG 自由画板",
  tikz: "TikZ 数学构图",
  pgf_plots: "PGFPlots 数据曲线",
  graphviz_dot: "Graphviz 关系图",
  mermaid: "Mermaid 图表设计",
});

const VISUAL_PROFILE_GUIDANCE = Object.freeze({
  svg_source:
    "路径与图层编辑 · 拖动、独立宽高、连续旋转均直接写入 SVG transform",
  tikz: "数学构图 · 几何对象与 LaTeX 标注直接写入 TikZ；ASCII 由内置 TeX 编译，中文由同一源码契约离线生成一致 SVG",
  pgf_plots:
    "函数与数据工作台 · 曲线、采样点和坐标设置直接生成 axis / addplot 源码",
  graphviz_dot:
    "关系图工作台 · 节点坐标与端口关系直接写入 DOT；视觉模式固定 Neato 坐标",
  mermaid:
    "语义图表工作台 · 节点可移动以观察连接，位置保存在编辑契约中；流程、状态和思维层级写入 Mermaid，最终排版由引擎决定",
});

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function parsePlotDataTable(source) {
  const points = [];
  for (const line of String(source || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const values = trimmed.split(/[\t,;\s]+/).filter(Boolean);
    if (values.length < 2) continue;
    const x = finiteNumber(values[0]);
    const y = finiteNumber(values[1]);
    if (x === null || y === null) continue;
    points.push({ x, y });
  }
  return points;
}

const tableCellText = (cell, formulas = {}) =>
  (cell?.inlines || [])
    .map((inline) => {
      if (inline?.type === "formula") {
        return (
          inline.formula?.latex || formulas[inline.formulaRef]?.latex || ""
        );
      }
      return inline?.text || "";
    })
    .join(" ")
    .trim();

export function tablePayloadToPlotData(payload) {
  const table = payload?.table || payload;
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const formulas = payload?.formulas || {};
  const values = rows.map((row) =>
    (row?.cells || []).slice(0, 2).map((cell) => tableCellText(cell, formulas)),
  );
  const first = values[0] || [];
  const firstIsHeader =
    first.length >= 2 &&
    (finiteNumber(first[0]) === null || finiteNumber(first[1]) === null);
  const headers = firstIsHeader
    ? [first[0] || "x", first[1] || "y"]
    : ["x", "y"];
  const points = values.slice(firstIsHeader ? 1 : 0).flatMap((row) => {
    if (row.length < 2) return [];
    const x = finiteNumber(row[0]);
    const y = finiteNumber(row[1]);
    return x === null || y === null ? [] : [{ x, y }];
  });
  if (points.length < 2) {
    throw new Error("Excel 选区至少需要两行有效的 x/y 数值");
  }
  return {
    headers,
    points,
    source: `${headers.join(",")}\n${points.map(({ x, y }) => `${x},${y}`).join("\n")}`,
  };
}

const nicePlotStep = (value) => {
  const positive = Math.abs(Number(value));
  if (!Number.isFinite(positive) || positive <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(positive));
  const normalized = positive / exponent;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * exponent;
};

export function computePlotYRange(objects, sampleCount = 161) {
  const plots = (objects || []).filter(
    (object) => object.type === "plot" && object.visible !== false,
  );
  const values = [];
  for (const plot of plots) {
    for (const point of plot.dataPoints || []) {
      const value = Number(point?.y);
      if (Number.isFinite(value)) values.push(value);
    }
    const xMin = Number(plot.xMin ?? -6.28);
    const xMax = Number(plot.xMax ?? 6.28);
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax)
      continue;
    try {
      for (let index = 0; index < sampleCount; index += 1) {
        const x = xMin + ((xMax - xMin) * index) / (sampleCount - 1);
        const value = evaluatePlotExpression(plot.expression || "sin(x)", x);
        if (Number.isFinite(value) && Math.abs(value) <= 1e12)
          values.push(value);
      }
    } catch {
      // The expression validator reports the actionable error when applied.
    }
  }
  if (!values.length) throw new Error("没有可用于自动适配的可见曲线");
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (Math.abs(max - min) < 1e-10) {
    const spread = Math.max(1, Math.abs(max) * 0.1);
    min -= spread;
    max += spread;
  }
  const padding = Math.max((max - min) * 0.08, 1e-6);
  const paddedMin = min - padding;
  const paddedMax = max + padding;
  const tick = nicePlotStep((paddedMax - paddedMin) / 6);
  return {
    min: Number(paddedMin.toPrecision(8)),
    max: Number(paddedMax.toPrecision(8)),
    tick: Number(tick.toPrecision(8)),
  };
}

export function migrateLegacyPlotLegend(objects) {
  const migratedObjects = structuredClone(
    Array.isArray(objects) ? objects : [],
  );
  const visiblePlotCount = migratedObjects.filter(
    (object) => object.type === "plot" && object.visible !== false,
  ).length;
  const axes = migratedObjects.find((object) => object.type === "axes");
  const migrated = Boolean(
    visiblePlotCount > 1 &&
    axes?.legendPosition === "north east" &&
    axes.legendPositionUserSet !== true,
  );
  if (migrated) {
    axes.legendPosition = "outer south";
    axes.legendPositionMigrated = true;
  }
  return { objects: migratedObjects, migrated };
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) {
      throw new Error("数据无法形成稳定拟合，请增加不同的 x 样本");
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index <= size; index += 1) {
      rows[column][index] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= size; index += 1) {
        rows[row][index] -= factor * rows[column][index];
      }
    }
  }
  return rows.map((row) => row[size]);
}

function polynomialFit(points, degree) {
  const size = degree + 1;
  const matrix = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) =>
      points.reduce((sum, point) => sum + point.x ** (row + column), 0),
    ),
  );
  const vector = Array.from({ length: size }, (_, power) =>
    points.reduce((sum, point) => sum + point.y * point.x ** power, 0),
  );
  return solveLinearSystem(matrix, vector);
}

const compactCoefficient = (value) => {
  const normalized = Math.abs(value) < 1e-10 ? 0 : value;
  return Number(normalized.toPrecision(7)).toString();
};

function polynomialExpression(coefficients) {
  return coefficients
    .map((coefficient, power) => {
      const value = compactCoefficient(coefficient);
      if (power === 0) return `(${value})`;
      if (power === 1) return `(${value})*x`;
      return `(${value})*x^${power}`;
    })
    .join("+");
}

function regressionQuality(points, predict) {
  const mean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const residual = points.reduce(
    (sum, point) => sum + (point.y - predict(point.x)) ** 2,
    0,
  );
  const total = points.reduce((sum, point) => sum + (point.y - mean) ** 2, 0);
  return total <= 1e-12 ? (residual <= 1e-12 ? 1 : 0) : 1 - residual / total;
}

export function fitPlotData(points, model = "linear") {
  const samples = (points || []).map(({ x, y }) => ({
    x: Number(x),
    y: Number(y),
  }));
  if (
    !samples.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )
  ) {
    throw new Error("表格包含无效数字");
  }
  if (samples.length < 2) throw new Error("至少需要两个有效的 x/y 数据点");
  const polynomialDegrees = { linear: 1, quadratic: 2, cubic: 3 };
  let coefficients;
  let expression;
  let predict;
  if (Object.hasOwn(polynomialDegrees, model)) {
    const degree = polynomialDegrees[model];
    if (samples.length < degree + 1) {
      throw new Error(`${degree} 次拟合至少需要 ${degree + 1} 个有效数据点`);
    }
    coefficients = polynomialFit(samples, degree);
    expression = polynomialExpression(coefficients);
    predict = (x) =>
      coefficients.reduce(
        (sum, coefficient, power) => sum + coefficient * x ** power,
        0,
      );
  } else if (model === "exponential") {
    const transformed = samples.filter((point) => point.y > 0);
    if (transformed.length !== samples.length || samples.length < 2) {
      throw new Error("指数拟合要求至少两个 y > 0 的数据点");
    }
    const [intercept, slope] = polynomialFit(
      transformed.map((point) => ({ x: point.x, y: Math.log(point.y) })),
      1,
    );
    coefficients = [Math.exp(intercept), slope];
    expression = `(${compactCoefficient(coefficients[0])})*exp((${compactCoefficient(coefficients[1])})*x)`;
    predict = (x) => coefficients[0] * Math.exp(coefficients[1] * x);
  } else if (model === "logarithmic") {
    if (samples.length < 2 || samples.some((point) => point.x <= 0)) {
      throw new Error("对数拟合要求至少两个 x > 0 的数据点");
    }
    coefficients = polynomialFit(
      samples.map((point) => ({ x: Math.log(point.x), y: point.y })),
      1,
    );
    expression = `(${compactCoefficient(coefficients[0])})+(${compactCoefficient(coefficients[1])})*ln(x)`;
    predict = (x) => coefficients[0] + coefficients[1] * Math.log(x);
  } else if (model === "power") {
    if (
      samples.length < 2 ||
      samples.some((point) => point.x <= 0 || point.y <= 0)
    ) {
      throw new Error("幂函数拟合要求至少两个 x > 0 且 y > 0 的数据点");
    }
    const [intercept, exponent] = polynomialFit(
      samples.map((point) => ({
        x: Math.log(point.x),
        y: Math.log(point.y),
      })),
      1,
    );
    coefficients = [Math.exp(intercept), exponent];
    expression = `(${compactCoefficient(coefficients[0])})*x^(${compactCoefficient(coefficients[1])})`;
    predict = (x) => coefficients[0] * x ** coefficients[1];
  } else {
    throw new Error(`不支持的拟合模型：${model}`);
  }
  const xValues = samples.map((point) => point.x);
  return {
    model,
    coefficients,
    expression,
    rSquared: regressionQuality(samples, predict),
    xMin: Math.min(...xValues),
    xMax: Math.max(...xValues),
    points: samples,
  };
}

export function computeFittedViewBox(bounds, paddingRatio = 0.08) {
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const paddingX = Math.max(4, width * paddingRatio);
  const paddingY = Math.max(4, height * paddingRatio);
  return [
    x - paddingX,
    y - paddingY,
    width + paddingX * 2,
    height + paddingY * 2,
  ]
    .map((value) => Math.round(value * 100) / 100)
    .join(" ");
}

export function fitDrawingPreview(preview) {
  const svg =
    preview?.querySelector?.(":scope > svg") || preview?.querySelector?.("svg");
  if (!svg || typeof svg.getBBox !== "function") return false;
  let bounds;
  try {
    bounds = svg.getBBox({ fill: true, stroke: true, markers: true });
  } catch {
    bounds = svg.getBBox();
  }
  const viewBox = computeFittedViewBox(bounds);
  if (!viewBox) return false;
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return true;
}

export function fitAndSerializeDrawingPreview(preview, fallbackSvg = "") {
  const fitted = fitDrawingPreview(preview);
  if (!fitted) return fallbackSvg;
  const svg =
    preview?.querySelector?.(":scope > svg") || preview?.querySelector?.("svg");
  return typeof svg?.outerHTML === "string" && svg.outerHTML
    ? svg.outerHTML
    : fallbackSvg;
}

export function resolveDrawingAuthoringInput({
  editorMode,
  language,
  nativeSource,
  packageProfiles = [],
}) {
  return {
    language,
    source: nativeSource,
    packageProfiles: [...packageProfiles],
    visual: editorMode === "visual",
  };
}

export async function rasterizeDrawingSvg(
  svg,
  widthPoints,
  heightPoints,
  { targetDpi = 192, maxEdge = 4096, maxPixels = 16 * 1024 * 1024 } = {},
) {
  if (!svg || typeof Image === "undefined" || typeof document === "undefined")
    throw new Error("DRAWING_PNG_RENDER_UNAVAILABLE");
  const width = Math.max(1, (Number(widthPoints) / 72) * targetDpi || 1);
  const height = Math.max(1, (Number(heightPoints) / 72) * targetDpi || 1);
  const scale = Math.min(
    1,
    maxEdge / width,
    maxEdge / height,
    Math.sqrt(maxPixels / (width * height)),
  );
  const widthPx = Math.max(1, Math.round(width * scale));
  const heightPx = Math.max(1, Math.round(height * scale));
  const image = await new Promise((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => resolve(candidate);
    candidate.onerror = () => reject(new Error("DRAWING_SVG_DECODE_FAILED"));
    candidate.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("DRAWING_CANVAS_UNAVAILABLE");
  context.clearRect(0, 0, widthPx, heightPx);
  context.drawImage(image, 0, 0, widthPx, heightPx);
  return canvas.toDataURL("image/png");
}

function setSelected(element, selected) {
  element?.classList?.toggle("active", selected);
  element?.setAttribute?.("aria-selected", String(selected));
  if (element) element.tabIndex = selected ? 0 : -1;
}

function controlValue(element, fallback = "") {
  const customValue = element?.querySelector?.(".custom-select-trigger")
    ?.dataset?.value;
  return customValue ?? element?.value ?? fallback;
}

function setControlValue(element, value) {
  if (!element) return;
  const trigger = element.querySelector?.(".custom-select-trigger");
  if (!trigger) {
    element.value = String(value);
    return;
  }
  const option = [...element.querySelectorAll(".custom-select-option")].find(
    (candidate) => candidate.dataset.value === String(value),
  );
  trigger.dataset.value = String(value);
  if (element._selectInstance) element._selectInstance.value = String(value);
  const label = trigger.querySelector("span");
  if (label && option) label.textContent = option.textContent.trim();
  for (const candidate of element.querySelectorAll(".custom-select-option")) {
    candidate.classList.toggle("selected", candidate === option);
    candidate.setAttribute("aria-selected", String(candidate === option));
  }
}

function setControlDisabled(element, disabled) {
  if (!element) return;
  if ("disabled" in element) element.disabled = Boolean(disabled);
  element.classList?.toggle("is-disabled", Boolean(disabled));
  const trigger = element.querySelector?.(".custom-select-trigger");
  trigger?.setAttribute?.("aria-disabled", String(Boolean(disabled)));
  if (trigger) trigger.tabIndex = disabled ? -1 : 0;
}

function userFacingError(error) {
  const message = String(error?.message || error || "未知错误");
  if (message.includes("__TAURI_INTERNALS__") || message.includes("invoke")) {
    return "桌面后端未连接";
  }
  return message;
}

export function createDrawingWorkspaceController({
  elements,
  compileDrawing,
  renderLocal,
  insertDrawing,
  copyDrawing,
  sendDrawingToPlatform,
  rasterizeDrawing = rasterizeDrawingSvg,
  loadReadiness,
  formulaRenderer,
  readSpreadsheetTable,
}) {
  const state = {
    mode: "formula",
    language: "svg_source",
    packageProfiles: [],
    compiling: false,
    lastResult: null,
    autoPreview: true,
    revision: 0,
    previewTimer: null,
    pendingPreview: false,
    compileSequence: 0,
    activeCompileId: null,
    editorMode: "visual",
    visualLocked: false,
    sourceByProfile: new Map(),
  };

  const status = (message) => {
    if (elements.status) elements.status.textContent = message;
  };

  const previewLabel = () =>
    VISUAL_PROFILE_NAMES[
      resolveVisualProfile(state.language, state.packageProfiles)
    ] || state.language;
  const markPreviewPending = (message = "等待生成当前绘图预览") => {
    if (elements.preview) {
      elements.preview.innerHTML = "";
      elements.preview.textContent = message;
      elements.preview.dataset.previewLanguage = state.language;
      elements.preview.dataset.previewState = "pending";
    }
    if (elements.previewSource)
      elements.previewSource.textContent = `${previewLabel()} · 待生成`;
  };
  const markPreviewReady = (verified) => {
    if (elements.preview) {
      elements.preview.dataset.previewLanguage = state.language;
      elements.preview.dataset.previewState = verified ? "verified" : "local";
    }
    if (elements.previewSource)
      elements.previewSource.textContent = `${previewLabel()} · ${verified ? "Core 已验证" : "本地待校验"}`;
  };

  const invalidateCompilation = () => {
    state.revision += 1;
    state.lastResult = null;
    if (state.compiling && state.autoPreview) state.pendingPreview = true;
    if (elements.insertButton) elements.insertButton.disabled = true;
    if (elements.sendPlatformButton)
      elements.sendPlatformButton.disabled = true;
    markPreviewPending();
  };

  const activateMode = (mode) => {
    state.mode = ["drawing", "symbol-composer"].includes(mode)
      ? mode
      : "formula";
    const drawing = state.mode === "drawing";
    const composing = state.mode === "symbol-composer";
    setSelected(elements.formulaTab, !drawing && !composing);
    setSelected(elements.drawingTab, drawing);
    setSelected(elements.symbolComposerTab, composing);
    if (elements.formulaWorkspace)
      elements.formulaWorkspace.hidden = drawing || composing;
    if (elements.drawingWorkspace) elements.drawingWorkspace.hidden = !drawing;
    if (elements.symbolComposerWorkspace)
      elements.symbolComposerWorkspace.hidden = !composing;
  };

  const chooseLanguage = (button) => {
    const language = button?.dataset?.drawingLanguage;
    if (!language) return;
    const previousProfile = visualProfileKey(
      state.language,
      state.packageProfiles,
    );
    if (elements.source)
      state.sourceByProfile.set(previousProfile, elements.source.value);
    state.language = language;
    state.packageProfiles = button.dataset.drawingProfile
      ? [button.dataset.drawingProfile]
      : [];
    for (const candidate of elements.languageButtons) {
      candidate.classList?.toggle("active", candidate === button);
    }
    const toolset = visualToolsForLanguage(language, state.packageProfiles);
    const profile = resolveVisualProfile(language, state.packageProfiles);
    for (const tool of elements.toolButtons || []) {
      const type = tool.dataset.drawingTool;
      tool.hidden = !Object.hasOwn(toolset, type);
      if (toolset[type]) tool.textContent = toolset[type];
    }
    const storedSource = state.sourceByProfile.get(profile);
    if (visualEditor) {
      visualEditor.setProfile(profile, { commit: !storedSource });
      if (storedSource && elements.source) {
        elements.source.value = storedSource;
        const parsed = parseVisualDocument(profile, storedSource);
        state.visualLocked = !parsed.lossless;
        if (parsed.lossless)
          visualEditor.replaceDocument(profile, parsed.objects, {
            commit: false,
          });
      }
    } else if (elements.source) {
      const preset = button.dataset.drawingProfile || language;
      elements.source.value =
        storedSource ||
        DEFAULT_SOURCES[preset] ||
        DEFAULT_SOURCES[language] ||
        "";
      state.visualLocked = !parseVisualDocument(profile, elements.source.value)
        .lossless;
    }
    const canvasTools = visualCanvasToolsForLanguage(
      language,
      state.packageProfiles,
    );
    const hadUnsupportedActiveTool = (elements.canvasToolButtons || []).some(
      (tool) =>
        tool.classList.contains("active") &&
        !canvasTools[tool.dataset.drawingCanvasTool],
    );
    if (hadUnsupportedActiveTool) visualEditor?.setTool("select");
    for (const tool of elements.canvasToolButtons || []) {
      const type = tool.dataset.drawingCanvasTool;
      const supported = Boolean(canvasTools[type]);
      const selected =
        supported &&
        (hadUnsupportedActiveTool
          ? type === "select"
          : tool.classList.contains("active"));
      tool.hidden = !supported;
      tool.classList.toggle("active", selected);
      tool.setAttribute("aria-pressed", String(selected));
    }
    for (const panel of elements.profilePanels || []) {
      const selected = panel.dataset.drawingWorkbench === profile;
      panel.hidden = !selected;
      panel.classList?.toggle("active", selected);
    }
    invalidateCompilation();
    setEditorMode(state.editorMode);
    status(
      state.editorMode === "visual"
        ? `已切换到 ${VISUAL_PROFILE_NAMES[profile]}；该语言的画布状态已恢复`
        : "源码已切换，本地安全预览已排队",
    );
    schedulePreview();
  };

  const compile = async ({ automatic = false } = {}) => {
    if (state.compiling) {
      if (state.autoPreview) state.pendingPreview = true;
      return null;
    }
    const revision = state.revision;
    const compileId = ++state.compileSequence;
    state.activeCompileId = compileId;
    state.pendingPreview = false;
    state.compiling = true;
    state.lastResult = null;
    if (elements.compileButton) elements.compileButton.disabled = true;
    if (elements.insertButton) elements.insertButton.disabled = true;
    status("正在安全编译…");
    const isCurrent = () =>
      state.activeCompileId === compileId && state.revision === revision;
    try {
      const drawingId =
        globalThis.crypto?.randomUUID?.() || `drawing-${Date.now()}`;
      const authored = resolveDrawingAuthoringInput({
        editorMode: state.editorMode,
        language: state.language,
        nativeSource: elements.source?.value || "",
        packageProfiles: state.packageProfiles,
      });
      const originalSource = authored.source;
      const authoredLanguage = authored.language;
      let renderedSvg = renderLocal
        ? await renderLocal({
            language: authoredLanguage,
            source: originalSource,
            packageProfiles: authored.packageProfiles,
            graphvizEngine: controlValue(elements.graphvizEngine, "dot"),
            previewHost: elements.preview,
            renderId: drawingId,
          })
        : null;
      if (!isCurrent()) return null;
      if (renderedSvg && elements.preview) {
        elements.preview.innerHTML = renderedSvg;
        renderedSvg = fitAndSerializeDrawingPreview(
          elements.preview,
          renderedSvg,
        );
        markPreviewReady(false);
        status("本地预览已生成，正在由 Core 执行安全校验…");
      }
      let result;
      try {
        result = await compileDrawing({
          drawingId,
          language: renderedSvg ? "svg_source" : authoredLanguage,
          source: renderedSvg || originalSource,
          packageProfiles: renderedSvg ? [] : authored.packageProfiles,
          packageLockSha256: null,
          rendererId: renderedSvg ? `bundled-${state.language}@1` : null,
        });
      } catch (error) {
        if (!isCurrent()) return null;
        if (!renderedSvg) throw error;
        status(
          `本地预览已生成；${userFacingError(error)}，尚未完成 Core 安全校验，插入已禁用`,
        );
        return {
          success: false,
          localPreviewOnly: true,
          svg: renderedSvg,
          originalSource,
          originalLanguage: state.language,
        };
      }
      if (!isCurrent()) return null;
      if (!result?.success || !result.payload || !result.svg) {
        if (renderedSvg) {
          status(
            `本地预览已生成；Core 安全校验未通过：${result?.error || "DRAWING_COMPILE_FAILED"}，插入已禁用`,
          );
          return {
            success: false,
            localPreviewOnly: true,
            svg: renderedSvg,
            originalSource,
            originalLanguage: state.language,
          };
        }
        throw new Error(result?.error || "DRAWING_COMPILE_FAILED");
      }
      result.originalSource = originalSource;
      result.originalLanguage = authoredLanguage;
      result.originalPackageProfiles = [...authored.packageProfiles];
      state.lastResult = result;
      if (elements.preview) {
        elements.preview.innerHTML = result.svg;
        fitDrawingPreview(elements.preview);
        markPreviewReady(true);
      }
      if (elements.insertButton) elements.insertButton.disabled = false;
      if (elements.sendPlatformButton)
        elements.sendPlatformButton.disabled = false;
      status(
        `${automatic ? "实时预览" : "编译完成"} · ${result.payload.widthPoints} × ${result.payload.heightPoints} pt · 本地离线`,
      );
      return result;
    } catch (error) {
      if (!isCurrent()) return null;
      status(`编译失败：${userFacingError(error)}`);
      return null;
    } finally {
      if (state.activeCompileId === compileId) {
        state.activeCompileId = null;
        state.compiling = false;
        if (elements.compileButton) elements.compileButton.disabled = false;
        if (state.pendingPreview && state.autoPreview) schedulePreview(0);
      }
    }
  };

  function schedulePreview(delay = 520) {
    if (!state.autoPreview) return;
    if (state.compiling) {
      state.pendingPreview = true;
      return;
    }
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(
      () => void compile({ automatic: true }),
      delay,
    );
  }

  let visualEditor = null;
  let quickConnectionType = "arrow";
  let appendNextFit = false;
  const objectTypeNames = Object.freeze({
    line: "线段",
    arrow: "箭头",
    connector: "连接线",
    freehand: "自由路径",
    node: "节点",
    rectangle: "矩形",
    ellipse: "椭圆",
    diamond: "判断节点",
    triangle: "三角形",
    star: "星形",
    axes: "坐标轴",
    plot: "函数曲线",
    label: "文本标注",
    formula: "LaTeX 数学标注",
  });
  const objectDisplayName = (object, index = 0) =>
    String(object?.text || "").trim() ||
    `${objectTypeNames[object?.type] || "对象"} ${index + 1}`;
  const syncInspector = (object, context = {}) => {
    const contextObjects = context.objects || [];
    const managerVisible = ["svg_source", "tikz"].includes(context.profile);
    if (elements.objectManagerSection)
      elements.objectManagerSection.hidden = !managerVisible;
    if (managerVisible && elements.objectManagerList) {
      elements.objectManagerList.replaceChildren();
      if (!contextObjects.length) {
        const empty = document.createElement("p");
        empty.className = "drawing-object-manager-empty";
        empty.textContent = "画板为空。可从上方工具栏添加图形或自由绘制。";
        elements.objectManagerList.appendChild(empty);
      }
      [...contextObjects].reverse().forEach((candidate) => {
        const originalIndex = contextObjects.findIndex(
          (entry) => entry.id === candidate.id,
        );
        const row = document.createElement("div");
        row.className = "drawing-object-manager-row";
        row.classList.toggle("is-selected", candidate.id === object?.id);
        row.classList.toggle("is-hidden", candidate.visible === false);
        row.classList.toggle("is-locked", candidate.locked === true);
        const select = document.createElement("button");
        select.type = "button";
        select.className = "drawing-object-manager-select";
        const title = document.createElement("strong");
        title.textContent = objectDisplayName(candidate, originalIndex);
        const detail = document.createElement("span");
        detail.textContent = `${objectTypeNames[candidate.type] || candidate.type} · 第 ${originalIndex + 1} 层`;
        select.append(title, detail);
        select.addEventListener("click", () =>
          visualEditor?.selectObject(candidate.id),
        );
        const actions = document.createElement("div");
        actions.className = "drawing-object-manager-actions";
        const action = (label, titleText, handler, pressed = null) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.title = titleText;
          if (pressed !== null)
            button.setAttribute("aria-pressed", String(Boolean(pressed)));
          button.addEventListener("click", handler);
          actions.appendChild(button);
        };
        action(
          candidate.visible === false ? "显示" : "隐藏",
          candidate.visible === false ? "显示对象" : "隐藏对象",
          () =>
            visualEditor?.updateObject(candidate.id, {
              visible: candidate.visible === false,
            }),
          candidate.visible !== false,
        );
        action(
          candidate.locked ? "解锁" : "锁定",
          candidate.locked ? "允许编辑对象" : "锁定对象位置和尺寸",
          () =>
            visualEditor?.updateObject(candidate.id, {
              locked: !candidate.locked,
            }),
          candidate.locked === true,
        );
        action("上移", "向前移动一层", () =>
          visualEditor?.moveObjectLayer(candidate.id, "forward"),
        );
        action("下移", "向后移动一层", () =>
          visualEditor?.moveObjectLayer(candidate.id, "back"),
        );
        row.append(select, actions);
        elements.objectManagerList.appendChild(row);
      });
    }
    if (elements.inspectorEmpty)
      elements.inspectorEmpty.hidden = Boolean(object);
    if (elements.inspectorControls) elements.inspectorControls.hidden = !object;
    if (!object) return;
    const capabilities = visualTransformCapabilities(object);
    const isNode = [
      "node",
      "rectangle",
      "ellipse",
      "diamond",
      "triangle",
      "star",
    ].includes(object.type);
    const isEdge = ["line", "arrow", "connector"].includes(object.type);
    const hasText = isNode || isEdge || object.type === "label";
    const contextNodes = contextObjects.filter((candidate) =>
      ["node", "rectangle", "ellipse", "diamond", "triangle", "star"].includes(
        candidate.type,
      ),
    );
    const mermaidUsesSpecialLayout =
      context.profile === "mermaid" &&
      (contextObjects.some(
        (candidate) => candidate.mindMapChild || candidate.mindMapEdge,
      ) ||
        (contextNodes[0]?.type === "ellipse" &&
          contextObjects.filter((candidate) => candidate.type === "connector")
            .length >= 3) ||
        (contextNodes.length >= 3 &&
          contextNodes.every((candidate) => Number(candidate.y) < 170) &&
          contextObjects.filter((candidate) => candidate.type === "arrow")
            .length >= 2) ||
        contextNodes.filter((candidate) => candidate.type === "ellipse")
          .length >= 2);
    const supportsPerObjectStyle = !mermaidUsesSpecialLayout;
    const supportsFill = isNode && supportsPerObjectStyle;
    if (elements.inspectorType) {
      elements.inspectorType.textContent =
        objectTypeNames[object.type] || object.type || "对象";
    }
    for (const [element, value] of [
      [elements.inspectorX, object.x],
      [elements.inspectorY, object.y],
      [elements.inspectorWidth, object.width],
      [elements.inspectorHeight, object.height],
      [elements.inspectorRotation, object.rotation],
      [elements.inspectorStroke, object.strokeWidth],
      [elements.inspectorCornerRadius, object.cornerRadius ?? 0],
      [elements.inspectorFontSize, object.fontSize ?? 30],
      [elements.inspectorOpacity, Math.round((object.opacity ?? 1) * 100)],
      [
        elements.inspectorFillOpacity,
        Math.round((object.fillOpacity ?? 1) * 100),
      ],
    ]) {
      if (element && document.activeElement !== element)
        element.value = String(Math.round(Number(value) * 10) / 10);
    }
    if (elements.inspectorX) elements.inspectorX.disabled = !capabilities.move;
    if (elements.inspectorY) elements.inspectorY.disabled = !capabilities.move;
    if (elements.inspectorWidth)
      elements.inspectorWidth.disabled = !capabilities.resize;
    if (elements.inspectorHeight)
      elements.inspectorHeight.disabled = !capabilities.resize;
    if (elements.inspectorRotation)
      elements.inspectorRotation.disabled = !capabilities.rotate;
    if (elements.inspectorCornerRadius)
      elements.inspectorCornerRadius.disabled = !isNode;
    if (elements.inspectorFill) elements.inspectorFill.disabled = !supportsFill;
    if (elements.inspectorFillOpacity)
      elements.inspectorFillOpacity.disabled = !supportsFill;
    if (elements.inspectorStroke)
      elements.inspectorStroke.disabled = !supportsPerObjectStyle;
    if (elements.inspectorStrokeColor)
      elements.inspectorStrokeColor.disabled = !supportsPerObjectStyle;
    if (elements.inspectorOpacity)
      elements.inspectorOpacity.disabled = !supportsPerObjectStyle;
    if (elements.inspectorTextSection)
      elements.inspectorTextSection.hidden = !hasText;
    if (elements.inspectorColor)
      elements.inspectorColor.textContent = object.color || "#2563EB";
    const syncColor = (input, preview, value) => {
      const color = /^#[0-9a-f]{6}$/i.test(value || "")
        ? String(value).toUpperCase()
        : "#2563EB";
      if (input && document.activeElement !== input) input.value = color;
      preview?.style?.setProperty("--drawing-current-color", color);
    };
    syncColor(
      elements.inspectorStrokeColor,
      elements.inspectorStrokePreview,
      object.color,
    );
    syncColor(
      elements.inspectorFill,
      elements.inspectorFillPreview,
      object.fill,
    );
    syncColor(
      elements.inspectorTextColor,
      elements.inspectorTextColorPreview,
      object.textColor,
    );
    if (
      elements.inspectorText &&
      document.activeElement !== elements.inspectorText
    ) {
      elements.inspectorText.value = object.text || "";
      elements.inspectorText.disabled = object.type === "formula";
      elements.inspectorText.title =
        object.type === "formula"
          ? "数学标注请在 TikZ 专项工具中重新渲染"
          : "直接修改当前对象文字";
    }
    const syncField = (element, value) => {
      if (
        element &&
        document.activeElement !== element &&
        value !== undefined
      ) {
        setControlValue(element, value);
      }
    };
    syncField(elements.inspectorFontFamily, object.fontFamily || "Segoe UI");
    syncField(elements.inspectorFontWeight, object.fontWeight || 500);
    syncField(elements.inspectorFontStyle, object.fontStyle || "normal");
    syncField(elements.inspectorLineStyle, object.lineStyle || "solid");
    setControlDisabled(
      elements.inspectorFontFamily,
      !hasText || !supportsPerObjectStyle,
    );
    setControlDisabled(
      elements.inspectorFontWeight,
      !hasText || !supportsPerObjectStyle,
    );
    setControlDisabled(
      elements.inspectorFontStyle,
      !hasText || !supportsPerObjectStyle,
    );
    setControlDisabled(elements.inspectorLineStyle, !supportsPerObjectStyle);
    if (elements.inspectorFontSize)
      elements.inspectorFontSize.disabled = !hasText || !supportsPerObjectStyle;
    if (elements.inspectorTextColor)
      elements.inspectorTextColor.disabled =
        !hasText || !supportsPerObjectStyle;

    const nodes = contextNodes;
    const renderNodePicker = (container, currentId, property) => {
      if (!container) return;
      container.replaceChildren();
      for (const node of nodes) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = node.text || "未命名节点";
        button.classList.toggle("active", node.id === currentId);
        button.disabled =
          property === "fromId"
            ? node.id === object.toId
            : node.id === object.fromId;
        button.addEventListener("click", () =>
          visualEditor?.updateSelected({ [property]: node.id }),
        );
        container.appendChild(button);
      }
    };
    if (elements.inspectorRelation) elements.inspectorRelation.hidden = !isEdge;
    renderNodePicker(elements.inspectorFromNodes, object.fromId, "fromId");
    renderNodePicker(elements.inspectorToNodes, object.toId, "toId");
    if (elements.inspectorQuickConnectSection)
      elements.inspectorQuickConnectSection.hidden = !isNode;
    if (elements.inspectorQuickTargets) {
      elements.inspectorQuickTargets.replaceChildren();
      for (const node of nodes.filter(
        (candidate) => candidate.id !== object.id,
      )) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `连接到 ${node.text || "未命名节点"}`;
        button.addEventListener("click", () => {
          visualEditor?.connectSelectedTo(node.id, quickConnectionType);
          status("连接已建立，起点和终点已写入原生源码");
        });
        elements.inspectorQuickTargets.appendChild(button);
      }
    }
    const relationProfile = ["graphviz_dot", "mermaid"].includes(
      context.profile,
    );
    if (elements.inspectorRelationOverviewSection) {
      elements.inspectorRelationOverviewSection.hidden = !relationProfile;
    }
    if (relationProfile && elements.inspectorRelationOverview) {
      const nameOf = (node) => node?.text?.trim() || "未命名节点";
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const edges = contextObjects.filter(
        (candidate) =>
          ["line", "arrow", "connector"].includes(candidate.type) &&
          candidate.fromId &&
          candidate.toId,
      );
      elements.inspectorRelationOverview.replaceChildren();
      if (!edges.length) {
        const empty = document.createElement("p");
        empty.className = "drawing-relation-empty";
        empty.textContent = "当前图还没有已绑定的连接。";
        elements.inspectorRelationOverview.appendChild(empty);
      }
      for (const edge of edges) {
        const row = document.createElement("div");
        row.className = "drawing-relation-row";
        const summary = document.createElement("div");
        summary.className = "drawing-relation-summary";
        const title = document.createElement("strong");
        title.textContent = `${nameOf(nodeById.get(edge.fromId))} → ${nameOf(nodeById.get(edge.toId))}`;
        const detail = document.createElement("span");
        detail.textContent = `${edge.type === "connector" ? "曲线连接" : "箭头连接"}${edge.text ? ` · ${edge.text}` : " · 无标签"}`;
        summary.append(title, detail);
        const actions = document.createElement("div");
        actions.className = "drawing-relation-row-actions";
        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.textContent = "选择";
        selectButton.addEventListener("click", () =>
          visualEditor?.selectObject(edge.id),
        );
        const disconnectButton = document.createElement("button");
        disconnectButton.type = "button";
        disconnectButton.className = "danger";
        disconnectButton.textContent = "断开";
        disconnectButton.addEventListener("click", () => {
          visualEditor?.deleteObject(edge.id);
          status("连接已断开，原生源码同步更新");
        });
        actions.append(selectButton, disconnectButton);
        row.append(summary, actions);
        elements.inspectorRelationOverview.appendChild(row);
      }
      if (elements.inspectorRelationCreate) {
        elements.inspectorRelationCreate.replaceChildren();
        const existingPairs = new Set(
          edges.map((edge) => `${edge.fromId}\u0000${edge.toId}`),
        );
        for (const from of nodes) {
          const targets = nodes.filter(
            (to) =>
              to.id !== from.id &&
              !existingPairs.has(`${from.id}\u0000${to.id}`),
          );
          if (!targets.length) continue;
          const row = document.createElement("div");
          row.className = "drawing-relation-create-row";
          const summary = document.createElement("div");
          summary.className = "drawing-relation-summary";
          const title = document.createElement("strong");
          title.textContent = nameOf(from);
          const detail = document.createElement("span");
          detail.textContent = "选择要连接的目标节点";
          summary.append(title, detail);
          const targetList = document.createElement("div");
          targetList.className = "drawing-relation-create-targets";
          for (const to of targets) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `→ ${nameOf(to)}`;
            button.title = `${nameOf(from)} 连接到 ${nameOf(to)}`;
            button.addEventListener("click", () => {
              visualEditor?.connectNodes(from.id, to.id, quickConnectionType);
              status(`${nameOf(from)} → ${nameOf(to)} 已写入原生源码`);
            });
            targetList.appendChild(button);
          }
          row.append(summary, targetList);
          elements.inspectorRelationCreate.appendChild(row);
        }
      }
    }
    if (context.profile === "pgf_plots" && elements.plotManagerList) {
      const plots = contextObjects.filter(
        (candidate) => candidate.type === "plot",
      );
      elements.plotManagerList.replaceChildren();
      if (!plots.length) {
        const empty = document.createElement("p");
        empty.className = "drawing-plot-manager-empty";
        empty.textContent = "暂无曲线；可使用预设、新增曲线或表格拟合。";
        elements.plotManagerList.appendChild(empty);
      }
      plots.forEach((plot, index) => {
        const row = document.createElement("div");
        row.className = "drawing-plot-manager-row";
        row.classList.toggle("is-selected", plot.id === object.id);
        row.classList.toggle("is-hidden", plot.visible === false);
        const color = document.createElement("span");
        color.className = "drawing-plot-manager-color";
        color.style.setProperty("--plot-color", plot.color || "#2563EB");
        const summary = document.createElement("div");
        summary.className = "drawing-plot-manager-summary";
        const name = document.createElement("strong");
        name.textContent = plot.legend || `曲线 ${index + 1}`;
        const kind = document.createElement("span");
        kind.textContent = plot.fitModel
          ? `拟合 · ${plot.fitModel}${Number.isFinite(plot.fitRSquared) ? ` · R² ${plot.fitRSquared.toFixed(4)}` : ""}`
          : plot.dataPoints?.length
            ? `数据曲线 · ${plot.dataPoints.length} 点`
            : "函数曲线";
        summary.append(name, kind);
        const expression = document.createElement("code");
        expression.textContent = plot.expression || "sin(x)";
        const actions = document.createElement("div");
        actions.className = "drawing-plot-manager-actions";
        const addAction = (label, handler, className = "") => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.className = className;
          button.addEventListener("click", handler);
          actions.appendChild(button);
        };
        addAction("编辑", () => visualEditor?.selectObject(plot.id));
        addAction(plot.visible === false ? "显示" : "隐藏", () => {
          visualEditor?.selectObject(plot.id);
          visualEditor?.updateSelected({ visible: plot.visible === false });
          status(
            `${plot.legend || `曲线 ${index + 1}`}已${plot.visible === false ? "显示" : "隐藏"}`,
          );
        });
        addAction("复制", () => {
          visualEditor?.selectObject(plot.id);
          visualEditor?.duplicateSelected();
          status("曲线副本已创建并写入原生源码");
        });
        addAction(
          "删除",
          () => {
            visualEditor?.deleteObject(plot.id);
            status("曲线已删除并从原生源码移除");
          },
          "danger",
        );
        row.append(color, summary, expression, actions);
        elements.plotManagerList.appendChild(row);
      });
    }
    if (object.type === "plot") {
      syncField(elements.plotCurve, object.curve || "sin");
      syncField(elements.plotExpression, object.expression || "sin(x)");
      syncField(
        elements.plotLegend,
        object.legend || object.expression || "curve",
      );
      syncField(elements.plotStyle, object.lineStyle || "solid");
      syncField(elements.plotMin, object.xMin ?? -6.28);
      syncField(elements.plotMax, object.xMax ?? 6.28);
      syncField(elements.plotSamples, object.samples ?? 120);
    } else if (object.type === "axes") {
      syncField(elements.plotXLabel, object.xLabel || "x");
      syncField(elements.plotYLabel, object.yLabel || "f(x)");
      syncField(elements.plotYMin, object.yMin ?? -1.5);
      syncField(elements.plotYMax, object.yMax ?? 1.5);
      syncField(elements.plotYTick, object.yTick ?? 0.5);
      syncField(elements.plotGrid, object.grid || "major");
      syncField(
        elements.plotLegendPosition,
        object.legendPosition || "outer south",
      );
      syncField(elements.plotLegendColumns, object.legendColumns ?? 1);
      syncField(elements.plotLegendFontSize, object.legendFontSize ?? 9);
      syncField(
        elements.plotLegendOpacity,
        Math.round((object.legendOpacity ?? 0.92) * 100),
      );
    }
  };
  const setEditorMode = (mode) => {
    const requestedVisual = mode === "visual";
    const profile = resolveVisualProfile(state.language, state.packageProfiles);
    let parsed = null;
    if (requestedVisual && elements.source) {
      parsed = parseVisualDocument(profile, elements.source.value);
      state.visualLocked = !parsed.lossless;
      if (parsed.lossless && visualEditor) {
        const parsedObjects =
          profile === "pgf_plots"
            ? migrateLegacyPlotLegend(parsed.objects).objects
            : structuredClone(parsed.objects);
        visualEditor.replaceDocument(profile, parsedObjects, {
          commit: false,
        });
      }
    }
    state.editorMode =
      requestedVisual && !state.visualLocked ? "visual" : "source";
    const visual = state.editorMode === "visual";
    if (visual && profile === "graphviz_dot" && elements.graphvizEngine) {
      setControlValue(elements.graphvizEngine, "neato");
    }
    if (elements.graphvizEngine) {
      const fixedGraphviz = visual && profile === "graphviz_dot";
      setControlDisabled(elements.graphvizEngine, fixedGraphviz);
      elements.graphvizEngine.title = fixedGraphviz
        ? "可视化模式使用 Neato 固定坐标，确保节点距离与源码输出一致"
        : "源码模式可选择自动布局引擎";
    }
    if (elements.visualEditor) elements.visualEditor.hidden = !visual;
    if (elements.sourceEditor) elements.sourceEditor.hidden = visual;
    elements.visualModeButton?.classList?.toggle("active", visual);
    elements.sourceModeButton?.classList?.toggle("active", !visual);
    elements.visualModeButton?.setAttribute("aria-selected", String(visual));
    elements.sourceModeButton?.setAttribute("aria-selected", String(!visual));
    if (elements.visualModeButton) {
      elements.visualModeButton.title = `使用 ${VISUAL_PROFILE_NAMES[profile]}；源码模式仍保留原生语言`;
      elements.visualModeButton.disabled = state.visualLocked;
    }
    if (elements.editorModeHint)
      elements.editorModeHint.textContent = visual
        ? VISUAL_PROFILE_GUIDANCE[profile] ||
          `${VISUAL_PROFILE_NAMES[profile]}结构编辑 · 下方安全预览是实际编译效果`
        : state.visualLocked
          ? parsed?.warning ||
            "源码包含不能无损反解析的语法；视觉编辑已锁定，源码与预览保持不变"
          : `正在编辑 ${state.language} 原生源码 · 可无损返回可视化编辑`;
    visualEditor?.setEnabled(visual);
    if (visual) visualEditor?.commit();
    if (requestedVisual && state.visualLocked) {
      status(
        parsed?.warning ||
          "当前源码不能无损转为可视对象，已保留源码并锁定可视化编辑",
      );
    }
  };

  if (elements.visualCanvas) {
    visualEditor = createVisualDrawingEditor({
      canvas: elements.visualCanvas,
      onSourceChange: (_visualSvg, document) => {
        if (!document?.objects) return;
        const serialized = serializeVisualDocument(
          document.profile,
          document.objects,
        );
        if (elements.source) elements.source.value = serialized.source;
        state.sourceByProfile.set(document.profile, serialized.source);
        state.visualLocked = false;
        if (
          document.profile === "graphviz_dot" &&
          elements.graphvizEngine &&
          serialized.graphvizEngine
        ) {
          setControlValue(elements.graphvizEngine, serialized.graphvizEngine);
        }
        if (elements.visualModeButton)
          elements.visualModeButton.disabled = false;
        invalidateCompilation();
        status("可视化修改已写入原生源码，安全预览已排队");
        schedulePreview();
      },
      onSelectionChange: syncInspector,
      onViewportChange: (viewport) => {
        if (elements.canvasZoomValue) {
          elements.canvasZoomValue.textContent = `${viewport.zoom}%`;
        }
      },
      onHistoryChange: ({ canUndo, canRedo }) => {
        if (elements.canvasUndo) elements.canvasUndo.disabled = !canUndo;
        if (elements.canvasRedo) elements.canvasRedo.disabled = !canRedo;
      },
    });
    const setCanvasTool = (tool) => {
      const active = visualEditor.setTool(tool);
      for (const button of elements.canvasToolButtons || []) {
        const selected = button.dataset.drawingCanvasTool === active;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
      status(
        active === "freehand"
          ? "自由画笔已开启：按住并拖动绘制连续路径，Esc 返回选择工具"
          : active === "pan"
            ? "抓手工具已开启：拖动画板调整观察位置"
            : "选择工具已开启：可选择、移动、缩放和编辑对象",
      );
    };
    for (const button of elements.canvasToolButtons || []) {
      button.addEventListener("click", () =>
        setCanvasTool(button.dataset.drawingCanvasTool),
      );
    }
    elements.canvasUndo?.addEventListener("click", () => visualEditor.undo());
    elements.canvasRedo?.addEventListener("click", () => visualEditor.redo());
    elements.canvasGridToggle?.addEventListener("change", () => {
      elements.visualCanvas.classList.toggle(
        "show-grid",
        elements.canvasGridToggle.checked,
      );
    });
    elements.canvasSnapToggle?.addEventListener("change", () => {
      visualEditor.setSnapToGrid(elements.canvasSnapToggle.checked);
      status(
        elements.canvasSnapToggle.checked
          ? "已开启 20 像素网格吸附"
          : "已关闭网格吸附",
      );
    });
    for (const button of elements.alignButtons || []) {
      button.addEventListener("click", () => {
        if (visualEditor.alignSelected(button.dataset.drawingAlign)) {
          status("对象已相对画板对齐，原生源码同步更新");
        }
      });
    }
    elements.canvasZoomOut?.addEventListener("click", () =>
      visualEditor.zoomOut(),
    );
    elements.canvasZoomIn?.addEventListener("click", () =>
      visualEditor.zoomIn(),
    );
    elements.canvasReset?.addEventListener("click", () =>
      visualEditor.resetViewport(),
    );
    elements.canvasFit?.addEventListener("click", () =>
      visualEditor.fitViewport(),
    );
    setCanvasTool("select");
  }

  const insert = async () => {
    if (!state.lastResult) {
      status("请先完成编译");
      return null;
    }
    if (elements.insertButton) elements.insertButton.disabled = true;
    status("正在插入 Office…");
    try {
      const result = await insertDrawing(state.lastResult);
      status("已发送到 Office");
      return result;
    } catch (error) {
      status(`插入失败：${userFacingError(error)}`);
      return null;
    } finally {
      if (elements.insertButton) elements.insertButton.disabled = false;
    }
  };

  const copy = async () => {
    if (!state.lastResult || !copyDrawing) {
      status("请先生成有效预览");
      return null;
    }
    try {
      let pngBase64 = null;
      try {
        pngBase64 = await rasterizeDrawing?.(
          state.lastResult.svg,
          state.lastResult.payload?.widthPoints,
          state.lastResult.payload?.heightPoints,
        );
      } catch (error) {
        console.warn("[Drawing] PNG clipboard rendering unavailable", error);
      }
      const report = await copyDrawing({
        source: state.lastResult.originalSource || elements.source?.value || "",
        svg: state.lastResult.svg,
        pngBase64,
        protocolJson: JSON.stringify(state.lastResult.payload),
      });
      status(
        `已复制 ${report?.writtenFormats?.length || 0} 种格式到系统剪贴板`,
      );
      return report;
    } catch (error) {
      status(`复制失败：${userFacingError(error)}`);
      return null;
    }
  };

  const sendPlatform = async () => {
    if (!state.lastResult || !sendDrawingToPlatform) {
      status("请先生成有效预览");
      return null;
    }
    if (elements.sendPlatformButton)
      elements.sendPlatformButton.disabled = true;
    try {
      status("正在生成平台图片…");
      const pngBase64 = await rasterizeDrawing(
        state.lastResult.svg,
        state.lastResult.payload?.widthPoints,
        state.lastResult.payload?.heightPoints,
      );
      const result = await sendDrawingToPlatform({
        pngBase64,
        svg: state.lastResult.svg,
        source: state.lastResult.originalSource || elements.source?.value || "",
      });
      status("图片已由目标平台保存并插入");
      return result;
    } catch (error) {
      status(`发送失败：${userFacingError(error)}`);
      return null;
    } finally {
      if (elements.sendPlatformButton)
        elements.sendPlatformButton.disabled = false;
    }
  };

  const refreshReadiness = async () => {
    try {
      const readiness = await loadReadiness();
      const adapters = drawingAdapterReadiness(readiness);
      if (elements.readiness) {
        elements.readiness.textContent = adapters
          .map((adapter) => {
            const bundled = [
              "tikz",
              "graphviz_dot",
              "mermaid",
              "svg_source",
            ].includes(adapter.language);
            const stateLabel = bundled
              ? "内置离线"
              : adapter.blocked
                ? "已禁用"
                : adapter.requiresSetup
                  ? "需要设置"
                  : "可用";
            return `${adapter.language}: ${stateLabel}`;
          })
          .join(" · ");
      }
      return adapters;
    } catch (error) {
      if (elements.readiness) {
        elements.readiness.textContent = `核心就绪状态不可用：${userFacingError(error)}`;
      }
      return [];
    }
  };

  elements.formulaTab?.addEventListener("click", () => activateMode("formula"));
  elements.drawingTab?.addEventListener("click", () => activateMode("drawing"));
  elements.symbolComposerTab?.addEventListener("click", () =>
    activateMode("symbol-composer"),
  );
  const modeTabs = [
    elements.formulaTab,
    elements.drawingTab,
    elements.symbolComposerTab,
  ].filter(Boolean);
  for (const tab of modeTabs) {
    tab?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = modeTabs.indexOf(tab);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next =
        modeTabs[(index + offset + modeTabs.length) % modeTabs.length];
      activateMode(next.dataset.editorMode);
      next?.focus?.();
    });
  }
  for (const button of elements.languageButtons) {
    button.addEventListener("click", () => chooseLanguage(button));
  }
  elements.visualModeButton?.addEventListener("click", () => {
    setEditorMode("visual");
    invalidateCompilation();
    schedulePreview(0);
  });
  elements.sourceModeButton?.addEventListener("click", () => {
    setEditorMode("source");
    invalidateCompilation();
    schedulePreview(0);
  });
  elements.compileButton?.addEventListener("click", compile);
  elements.insertButton?.addEventListener("click", insert);
  elements.copyButton?.addEventListener("click", copy);
  elements.sendPlatformButton?.addEventListener("click", sendPlatform);
  elements.source?.addEventListener("input", () => {
    const profile = resolveVisualProfile(state.language, state.packageProfiles);
    const parsed = parseVisualDocument(profile, elements.source.value);
    state.sourceByProfile.set(profile, elements.source.value);
    state.visualLocked = !parsed.lossless;
    if (parsed.lossless && visualEditor) {
      visualEditor.replaceDocument(profile, parsed.objects, { commit: false });
    }
    if (elements.visualModeButton) {
      elements.visualModeButton.disabled = state.visualLocked;
      elements.visualModeButton.title = state.visualLocked
        ? parsed.warning
        : `使用 ${VISUAL_PROFILE_NAMES[profile]}；当前源码可无损可视化`;
    }
    if (elements.editorModeHint) {
      elements.editorModeHint.textContent = state.visualLocked
        ? parsed.warning
        : parsed.warning ||
          `正在编辑 ${state.language} 原生源码 · 已同步可视对象`;
    }
    invalidateCompilation();
    status(
      state.visualLocked
        ? "源码已保留；检测到高级语法，视觉编辑暂时锁定"
        : "源码已同步到可视对象，正在等待输入稳定…",
    );
    schedulePreview();
  });
  elements.autoPreview?.addEventListener("change", () => {
    state.autoPreview = elements.autoPreview.checked;
    if (state.autoPreview) schedulePreview();
  });
  elements.graphvizEngine?.addEventListener("change", () => {
    invalidateCompilation();
    status("布局引擎已切换，本地安全预览已排队");
    schedulePreview();
  });
  elements.zoom?.addEventListener("input", () => {
    elements.preview?.style?.setProperty?.(
      "--drawing-preview-zoom",
      `${elements.zoom.value}%`,
    );
    if (elements.zoomValue)
      elements.zoomValue.textContent = `${elements.zoom.value}%`;
  });
  elements.gridToggle?.addEventListener("change", () => {
    elements.preview?.classList?.toggle(
      "show-grid",
      elements.gridToggle.checked,
    );
    elements.visualCanvas?.classList?.toggle(
      "show-grid",
      elements.gridToggle.checked,
    );
  });
  elements.helpButton?.addEventListener("click", () => {
    const open = elements.helpPanel?.hidden !== false;
    if (elements.helpPanel) elements.helpPanel.hidden = !open;
    elements.helpButton?.setAttribute("aria-expanded", String(open));
  });
  for (const preset of elements.presetButtons || []) {
    preset.addEventListener("click", () => {
      setEditorMode("visual");
      if (visualEditor?.applyPreset(preset.dataset.drawingPreset)) {
        status("方向模板已载入；可继续调整对象、线宽与配色");
      }
    });
  }
  for (const button of elements.profileTemplateButtons || []) {
    button.addEventListener("click", () => {
      const panel = button.closest?.("[data-drawing-workbench]");
      const profile = panel?.dataset?.drawingWorkbench;
      if (
        !profile ||
        profile !== resolveVisualProfile(state.language, state.packageProfiles)
      )
        return;
      setEditorMode("visual");
      visualEditor?.applyProfileTemplate(
        profile,
        button.dataset.drawingProfileTemplate,
        {
          curve: controlValue(elements.plotCurve, "sin"),
          expression: elements.plotExpression?.value || "sin(x)",
          xMin: Number(elements.plotMin?.value || -6.28),
          xMax: Number(elements.plotMax?.value || 6.28),
          root: elements.mindRoot?.value || "主题",
        },
      );
      status(`${VISUAL_PROFILE_NAMES[profile]}模板已应用，可继续拖动和精调`);
    });
  }
  const plotPatch = () => {
    const expression = String(elements.plotExpression?.value || "sin(x)")
      .trim()
      .toLowerCase();
    parsePlotExpression(expression);
    const xMin = Number(elements.plotMin?.value || -6.28);
    const xMax = Number(elements.plotMax?.value || 6.28);
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) {
      throw new Error("函数定义域需要满足：最小 x < 最大 x");
    }
    const finiteSamples = Array.from({ length: 33 }, (_, index) => {
      const x = xMin + ((xMax - xMin) * index) / 32;
      return evaluatePlotExpression(expression, x);
    }).filter(Number.isFinite);
    if (!finiteSamples.length) {
      throw new Error("当前定义域内没有可绘制的有限函数值");
    }
    const yMin = Number(elements.plotYMin?.value ?? -1.5);
    const yMax = Number(elements.plotYMax?.value ?? 1.5);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin >= yMax) {
      throw new Error("纵轴范围需要满足：最小 y < 最大 y");
    }
    let curve = controlValue(elements.plotCurve, "custom");
    if (!curve || curve === "custom") {
      curve = /gauss|exp\s*\(\s*-?x\s*\^\s*2/.test(expression)
        ? "gaussian"
        : /x\s*\^\s*2|x\s*\*\s*x|quadratic/.test(expression)
          ? "quadratic"
          : /^\s*[+-]?\s*(?:\d+(?:\.\d+)?)?\s*\*?\s*x\s*$/.test(expression)
            ? "linear"
            : /^cos\s*\(/.test(expression)
              ? "cos"
              : /^sin\s*\(/.test(expression)
                ? "sin"
                : "custom";
      setControlValue(elements.plotCurve, curve);
    }
    return {
      curve,
      expression: elements.plotExpression?.value || "sin(x)",
      legend:
        elements.plotLegend?.value || elements.plotExpression?.value || "curve",
      xMin,
      xMax,
      samples: Number(elements.plotSamples?.value || 120),
      lineStyle: controlValue(elements.plotStyle, "solid"),
      yMin,
      yMax,
    };
  };
  elements.plotCurve?.addEventListener("change", () => {
    const presets = {
      sin: "sin(x)",
      cos: "cos(x)",
      quadratic: "x^2",
      gaussian: "exp(-x^2)",
      linear: "x",
    };
    const selectedCurve = controlValue(elements.plotCurve, "sin");
    if (selectedCurve === "custom") return;
    const expression = presets[selectedCurve] || "sin(x)";
    if (elements.plotExpression) elements.plotExpression.value = expression;
    if (elements.plotLegend) elements.plotLegend.value = expression;
  });
  const applyPlotBuilder = ({ create = false } = {}) => {
    try {
      const patch = plotPatch();
      setEditorMode("visual");
      if (state.editorMode !== "visual") return;
      if (create) {
        visualEditor?.add("plot", {
          ...patch,
          x: 385,
          y: 260,
          width: 300,
          height: 160,
        });
      } else {
        visualEditor?.updateProfileObject("plot", patch, {
          createIfMissing: true,
        });
      }
      const currentLegendPosition = controlValue(
        elements.plotLegendPosition,
        "outer south",
      );
      const legendPosition =
        create && currentLegendPosition === "north east"
          ? "outer south"
          : currentLegendPosition;
      setControlValue(elements.plotLegendPosition, legendPosition);
      visualEditor?.updateProfileObject(
        "axes",
        {
          yMin: patch.yMin,
          yMax: patch.yMax,
          legendPosition,
        },
        { createIfMissing: true },
      );
      status(
        `${create ? "新曲线已加入" : "当前曲线已更新"}：${elements.plotExpression?.value || "sin(x)"}；原生 axis 源码已同步`,
      );
    } catch (error) {
      status(`函数未写入：${userFacingError(error)}`);
    }
  };
  elements.plotApply?.addEventListener("click", () => applyPlotBuilder());
  elements.plotAdd?.addEventListener("click", () =>
    applyPlotBuilder({ create: true }),
  );
  const applyAxesBuilder = () => {
    const yMin = Number(elements.plotYMin?.value || -1.5);
    const yMax = Number(elements.plotYMax?.value || 1.5);
    const yTick = Number(elements.plotYTick?.value || 0.5);
    const legendColumns = Number(elements.plotLegendColumns?.value || 1);
    const legendFontSize = Number(elements.plotLegendFontSize?.value || 9);
    const legendOpacity = Number(elements.plotLegendOpacity?.value ?? 92) / 100;
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin >= yMax) {
      status("坐标设置未写入：最小 y 必须小于最大 y");
      return;
    }
    if (!Number.isFinite(yTick) || yTick <= 0) {
      status("坐标设置未写入：Y 轴主刻度必须大于 0");
      return;
    }
    if (
      !Number.isInteger(legendColumns) ||
      legendColumns < 1 ||
      legendColumns > 6 ||
      !Number.isFinite(legendFontSize) ||
      legendFontSize < 5 ||
      legendFontSize > 24 ||
      !Number.isFinite(legendOpacity) ||
      legendOpacity < 0 ||
      legendOpacity > 1
    ) {
      status("图例设置未写入：请检查列数、字号与背景透明度");
      return;
    }
    setEditorMode("visual");
    if (state.editorMode !== "visual") return;
    visualEditor?.updateProfileObject(
      "axes",
      {
        xLabel: elements.plotXLabel?.value || "x",
        yLabel: elements.plotYLabel?.value || "f(x)",
        yMin,
        yMax,
        yTick,
        grid: controlValue(elements.plotGrid, "major"),
        legendPosition: controlValue(
          elements.plotLegendPosition,
          "outer south",
        ),
        legendPositionUserSet: true,
        legendColumns,
        legendFontSize,
        legendOpacity,
      },
      { createIfMissing: true },
    );
    status("Y 轴范围、主刻度、网格与图例位置已写入 PGFPlots 源码");
  };
  elements.plotAxesApply?.addEventListener("click", applyAxesBuilder);
  elements.plotAutoY?.addEventListener("click", () => {
    try {
      const range = computePlotYRange(visualEditor?.state?.objects || []);
      if (elements.plotYMin) elements.plotYMin.value = String(range.min);
      if (elements.plotYMax) elements.plotYMax.value = String(range.max);
      if (elements.plotYTick) elements.plotYTick.value = String(range.tick);
      applyAxesBuilder();
      status(
        `Y 轴已适配全部可见曲线：${range.min} 至 ${range.max}，主刻度 ${range.tick}`,
      );
    } catch (error) {
      status(`无法自动适配 Y 轴：${userFacingError(error)}`);
    }
  });
  for (const preset of elements.plotPresetButtons || []) {
    preset.addEventListener("click", () => {
      if (elements.plotExpression)
        elements.plotExpression.value = preset.dataset.plotExpression || "";
      if (elements.plotLegend)
        elements.plotLegend.value =
          preset.dataset.plotLegend || preset.dataset.plotExpression || "";
      if (elements.plotMin && preset.dataset.plotXMin)
        elements.plotMin.value = preset.dataset.plotXMin;
      if (elements.plotMax && preset.dataset.plotXMax)
        elements.plotMax.value = preset.dataset.plotXMax;
      if (elements.plotYMin && preset.dataset.plotYMin)
        elements.plotYMin.value = preset.dataset.plotYMin;
      if (elements.plotYMax && preset.dataset.plotYMax)
        elements.plotYMax.value = preset.dataset.plotYMax;
      setControlValue(elements.plotCurve, "custom");
      status(
        "函数及适配坐标范围已填入；点击“更新当前曲线”后写入原生 PGFPlots 源码",
      );
    });
  }
  elements.plotFitAppend?.addEventListener("click", () => {
    appendNextFit = !appendNextFit;
    elements.plotFitAppend.setAttribute("aria-pressed", String(appendNextFit));
    elements.plotFitAppend.textContent = appendNextFit
      ? "将另存为新拟合曲线"
      : "本次另存为新拟合曲线";
  });
  elements.plotImportExcel?.addEventListener("click", async () => {
    if (typeof readSpreadsheetTable !== "function") {
      status("Excel 选区读取仅在桌面应用中可用");
      return;
    }
    try {
      elements.plotImportExcel.disabled = true;
      status("正在从 Excel 读取当前选区…");
      await readSpreadsheetTable();
    } catch (error) {
      status(`读取 Excel 选区失败：${userFacingError(error)}`);
    } finally {
      elements.plotImportExcel.disabled = false;
    }
  });
  elements.plotFit?.addEventListener("click", () => {
    try {
      const points = parsePlotDataTable(elements.plotData?.value || "");
      const model = controlValue(elements.plotFitModel, "linear");
      const fitted = fitPlotData(points, model);
      const modelNames = {
        linear: "Linear",
        quadratic: "Quadratic",
        cubic: "Cubic",
        exponential: "Exponential",
        logarithmic: "Logarithmic",
        power: "Power",
      };
      const legend = `${modelNames[model] || model} fit R2=${fitted.rSquared.toFixed(4)}`;
      if (elements.plotExpression)
        elements.plotExpression.value = fitted.expression;
      if (elements.plotLegend) elements.plotLegend.value = legend;
      if (elements.plotMin) elements.plotMin.value = String(fitted.xMin);
      if (elements.plotMax) elements.plotMax.value = String(fitted.xMax);
      setControlValue(elements.plotCurve, "custom");
      setEditorMode("visual");
      if (state.editorMode !== "visual") return;
      const yValues = fitted.points.map((point) => point.y);
      const yLow = Math.min(...yValues);
      const yHigh = Math.max(...yValues);
      const yPadding = Math.max(0.25, (yHigh - yLow) * 0.08);
      if (elements.plotYMin) elements.plotYMin.value = String(yLow - yPadding);
      if (elements.plotYMax) elements.plotYMax.value = String(yHigh + yPadding);
      const fittedPlot = {
        ...plotPatch(),
        curve: "custom",
        expression: fitted.expression,
        legend,
        fitModel: fitted.model,
        fitCoefficients: fitted.coefficients,
        fitRSquared: fitted.rSquared,
        dataPoints: fitted.points,
        dataLegend: `${modelNames[model] || model} samples`,
        xMin: fitted.xMin,
        xMax: fitted.xMax,
        yMin: yLow - yPadding,
        yMax: yHigh + yPadding,
        samples: Math.max(160, Number(elements.plotSamples?.value || 160)),
        x: 385,
        y: 260,
        width: 300,
        height: 160,
        visible: true,
      };
      const existingFit = appendNextFit
        ? null
        : [...(visualEditor?.state?.objects || [])]
            .reverse()
            .find(
              (candidate) => candidate.type === "plot" && candidate.fitModel,
            );
      if (existingFit) {
        visualEditor?.selectObject(existingFit.id);
        visualEditor?.updateSelected(fittedPlot);
      } else {
        visualEditor?.add("plot", fittedPlot);
      }
      const currentLegendPosition = controlValue(
        elements.plotLegendPosition,
        "outer south",
      );
      const fittedLegendPosition =
        currentLegendPosition === "north east"
          ? "outer south"
          : currentLegendPosition;
      setControlValue(elements.plotLegendPosition, fittedLegendPosition);
      visualEditor?.updateProfileObject(
        "axes",
        {
          xLabel: elements.plotXLabel?.value || "x",
          yLabel: elements.plotYLabel?.value || "f(x)",
          yMin: yLow - yPadding,
          yMax: yHigh + yPadding,
          yTick: nicePlotStep((yHigh - yLow + yPadding * 2) / 6),
          grid: controlValue(elements.plotGrid, "major"),
          legendPosition: fittedLegendPosition,
        },
        { createIfMissing: true },
      );
      if (elements.plotFitStatus) {
        elements.plotFitStatus.textContent = `${points.length} 个点 · ${existingFit ? "已更新现有拟合" : "已建立拟合"} · ${legend} · ${fitted.expression}`;
        elements.plotFitStatus.dataset.state = "success";
      }
      appendNextFit = false;
      elements.plotFitAppend?.setAttribute("aria-pressed", "false");
      if (elements.plotFitAppend)
        elements.plotFitAppend.textContent = "本次另存为新拟合曲线";
      status(
        `${existingFit ? "拟合曲线已更新" : "采样点与拟合曲线已建立"}并写入 PGFPlots 源码`,
      );
    } catch (error) {
      if (elements.plotFitStatus) {
        elements.plotFitStatus.textContent = userFacingError(error);
        elements.plotFitStatus.dataset.state = "error";
      }
      status(`拟合失败：${userFacingError(error)}`);
    }
  });
  elements.graphNodeAdd?.addEventListener("click", () => {
    setEditorMode("visual");
    visualEditor?.addGraphNode(
      elements.graphNodeLabel?.value || "新节点",
      controlValue(elements.graphNodeShape, "node"),
    );
    status("Graphviz 节点已写入 DOT；选中节点后可继续添加，自动形成父子关系");
  });
  elements.graphConnect?.addEventListener("click", () => {
    setEditorMode("visual");
    visualEditor?.beginConnection(
      controlValue(elements.graphRelationType, "arrow"),
      elements.graphRelationLabel?.value || "",
    );
    elements.visualCanvas?.focus?.();
    status("关系模式已开启：从起点端口拖到目标节点，名称将写入 DOT 边标签");
  });
  elements.mindRootCreate?.addEventListener("click", () => {
    setEditorMode("visual");
    visualEditor?.applyProfileTemplate("mermaid", "mindmap", {
      root: elements.mindRoot?.value || "主题",
    });
    status("思维导图骨架已创建；使用“快速添加分支”继续扩展");
  });
  elements.mindChildAdd?.addEventListener("click", () => {
    setEditorMode("visual");
    visualEditor?.addMindMapChild(elements.mindChild?.value || "新分支");
    status("思维导图分支已挂到当前选中节点；层级已写入 Mermaid 缩进源码");
  });
  elements.mermaidNodeAdd?.addEventListener("click", () => {
    setEditorMode("visual");
    visualEditor?.addGraphNode(
      elements.mermaidNodeLabel?.value || "新步骤",
      controlValue(elements.mermaidNodeShape, "node"),
    );
    status("Mermaid 语义节点已添加；节点形状会直接写入 Mermaid 原生语法");
  });
  elements.mermaidConnect?.addEventListener("click", () => {
    setEditorMode("visual");
    visualEditor?.beginConnection(
      controlValue(elements.mermaidRelationType, "arrow"),
      elements.mermaidRelationLabel?.value || "",
    );
    elements.visualCanvas?.focus?.();
    status("Mermaid 关系模式已开启：拖动两个端口建立带语义标签的关系");
  });
  elements.tikzChineseAdd?.addEventListener("click", () => {
    const text = String(elements.tikzChineseText?.value || "").trim();
    if (!text) {
      if (elements.tikzChineseStatus)
        elements.tikzChineseStatus.textContent = "请先输入中文标签";
      return;
    }
    setEditorMode("visual");
    const requested = controlValue(elements.tikzChineseType, "label");
    const type = ["label", "node", "rectangle", "ellipse", "diamond"].includes(
      requested,
    )
      ? requested
      : "label";
    visualEditor?.add(type, {
      text,
      fontFamily: "Microsoft YaHei",
      fontSize: type === "label" ? 34 : 28,
      textColor: "#172033",
      fill: "#F8FAFC",
    });
    if (elements.tikzChineseStatus)
      elements.tikzChineseStatus.textContent =
        "中文标签已写入 TikZ 源码契约；预览和 Office 插入由同一对象模型离线生成";
    status("TikZ 中文标签已加入画布并同步原生源码");
  });
  elements.tikzLatexAdd?.addEventListener("click", async () => {
    const latex = String(elements.tikzLatex?.value || "").trim();
    if (!latex) {
      if (elements.tikzLatexStatus)
        elements.tikzLatexStatus.textContent = "请先输入 LaTeX 公式";
      return;
    }
    if (!formulaRenderer?.renderFormulaSvg) {
      if (elements.tikzLatexStatus)
        elements.tikzLatexStatus.textContent = "公式渲染器尚未就绪";
      return;
    }
    try {
      if (elements.tikzLatexStatus)
        elements.tikzLatexStatus.textContent = "正在生成矢量公式…";
      const rendered = await formulaRenderer.renderFormulaSvg(latex, {
        display: true,
        color: "#0F172A",
      });
      setEditorMode("visual");
      const added = visualEditor?.addFormula({
        latex,
        svg: rendered.svg,
        width: Math.max(150, Number(rendered.widthPt || 120) * 2.4),
        height: Math.max(64, Number(rendered.heightPt || 36) * 2.4),
      });
      if (!added) throw new Error("公式 SVG 不符合绘图安全约束");
      if (elements.tikzLatexStatus)
        elements.tikzLatexStatus.textContent =
          "公式已作为独立矢量对象加入，可缩放、旋转和分层";
      status("LaTeX 数学标注已加入 TikZ 画布");
    } catch (error) {
      if (elements.tikzLatexStatus)
        elements.tikzLatexStatus.textContent = `生成失败：${userFacingError(error)}`;
    }
  });
  const inspectorUpdates = [
    [elements.inspectorX, "x"],
    [elements.inspectorY, "y"],
    [elements.inspectorWidth, "width"],
    [elements.inspectorHeight, "height"],
    [elements.inspectorRotation, "rotation"],
    [elements.inspectorStroke, "strokeWidth"],
    [elements.inspectorCornerRadius, "cornerRadius"],
    [elements.inspectorFontSize, "fontSize"],
  ];
  for (const [input, property] of inspectorUpdates) {
    input?.addEventListener("input", () => {
      visualEditor?.updateSelected({ [property]: Number(input.value) });
    });
  }
  elements.inspectorText?.addEventListener("input", () => {
    visualEditor?.updateSelected({ text: elements.inspectorText.value });
  });
  const bindCustomInspector = (
    element,
    property,
    transform = (value) => value,
  ) => {
    element?.addEventListener("change", () => {
      visualEditor?.updateSelected({
        [property]: transform(controlValue(element)),
      });
    });
  };
  bindCustomInspector(elements.inspectorFontFamily, "fontFamily");
  bindCustomInspector(elements.inspectorFontWeight, "fontWeight", Number);
  bindCustomInspector(elements.inspectorFontStyle, "fontStyle");
  bindCustomInspector(elements.inspectorLineStyle, "lineStyle");
  const bindColorInput = (element, property) => {
    element?.addEventListener("input", () => {
      const value = element.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        visualEditor?.updateSelected({ [property]: value });
      }
    });
  };
  bindColorInput(elements.inspectorStrokeColor, "color");
  bindColorInput(elements.inspectorFill, "fill");
  bindColorInput(elements.inspectorTextColor, "textColor");
  elements.inspectorOpacity?.addEventListener("input", () => {
    visualEditor?.updateSelected({
      opacity: Number(elements.inspectorOpacity.value) / 100,
    });
  });
  elements.inspectorFillOpacity?.addEventListener("input", () => {
    visualEditor?.updateSelected({
      fillOpacity: Number(elements.inspectorFillOpacity.value) / 100,
    });
  });
  for (const swatch of elements.inspectorSwatches || []) {
    swatch.addEventListener("click", () => {
      visualEditor?.updateSelected({ color: swatch.dataset.drawingColor });
    });
  }
  elements.inspectorDisconnect?.addEventListener("click", () => {
    const selectedEdge = visualEditor?.selected();
    if (
      selectedEdge &&
      ["line", "arrow", "connector"].includes(selectedEdge.type)
    ) {
      visualEditor?.deleteObject(selectedEdge.id);
      status("当前连接已断开并从原生源码移除");
    }
  });
  elements.inspectorQuickArrow?.addEventListener("click", () => {
    quickConnectionType = "arrow";
    visualEditor?.beginConnection("arrow");
    status("箭头连接已开启，可点选目标按钮或从端口拖到目标节点");
  });
  elements.inspectorQuickConnector?.addEventListener("click", () => {
    quickConnectionType = "connector";
    visualEditor?.beginConnection("connector");
    status("曲线连接已开启，可点选目标按钮或从端口拖到目标节点");
  });
  elements.inspectorCancelConnect?.addEventListener("click", () => {
    visualEditor?.cancelConnection();
    status("连接模式已取消");
  });
  elements.inspectorDuplicate?.addEventListener("click", () =>
    visualEditor?.duplicateSelected(),
  );
  elements.inspectorForward?.addEventListener("click", () =>
    visualEditor?.moveLayer("forward"),
  );
  elements.inspectorBack?.addEventListener("click", () =>
    visualEditor?.moveLayer("back"),
  );
  elements.inspectorDelete?.addEventListener("click", () =>
    visualEditor?.deleteSelected(),
  );
  for (const tool of elements.toolButtons || []) {
    tool.addEventListener("click", () => {
      if (state.editorMode === "visual" && visualEditor) {
        const type = tool.dataset.drawingTool;
        if (type === "freehand") {
          visualEditor.setTool("freehand");
          for (const button of elements.canvasToolButtons || []) {
            const active = button.dataset.drawingCanvasTool === "freehand";
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
          }
          status("自由画笔已开启：按住并拖动即可绘制平滑矢量路径");
        } else if (["arrow", "connector"].includes(type)) {
          visualEditor.setTool("select");
          for (const button of elements.canvasToolButtons || []) {
            const active = button.dataset.drawingCanvasTool === "select";
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
          }
          visualEditor.beginConnection(type);
          status("连接模式已开启：从起点端口拖到目标节点即可建立关系");
        } else {
          visualEditor.setTool("select");
          for (const button of elements.canvasToolButtons || []) {
            const active = button.dataset.drawingCanvasTool === "select";
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
          }
          visualEditor.add(type);
          status("对象已添加；可直接拖动、缩放或旋转");
        }
        return;
      }
      const snippet = TOOL_SNIPPETS[tool.dataset.drawingTool]?.[state.language];
      if (!snippet || !elements.source) {
        status("当前绘图语言暂不提供该工具的源码片段");
        return;
      }
      const start =
        elements.source.selectionStart ?? elements.source.value.length;
      const end = elements.source.selectionEnd ?? start;
      elements.source.value = `${elements.source.value.slice(0, start)}\n${snippet}\n${elements.source.value.slice(end)}`;
      elements.source.focus?.();
      invalidateCompilation();
      schedulePreview();
    });
  }
  const initialToolset = visualToolsForLanguage(
    state.language,
    state.packageProfiles,
  );
  for (const tool of elements.toolButtons || []) {
    const type = tool.dataset.drawingTool;
    tool.hidden = !Object.hasOwn(initialToolset, type);
    if (initialToolset[type]) tool.textContent = initialToolset[type];
  }
  setEditorMode("visual");
  activateMode("formula");

  const exportEditableState = () => ({
    schemaVersion: 1,
    kind: "drawing",
    language: state.language,
    packageProfiles: [...state.packageProfiles],
    source: String(elements.source?.value || ""),
  });

  const loadEditableState = (editorState) => {
    if (
      editorState?.schemaVersion !== 1 ||
      editorState?.kind !== "drawing" ||
      typeof editorState.language !== "string" ||
      typeof editorState.source !== "string"
    ) {
      throw new Error("EDITABLE_MEDIA_DRAWING_STATE_INVALID");
    }
    const profiles = Array.isArray(editorState.packageProfiles)
      ? editorState.packageProfiles.filter((value) => typeof value === "string")
      : [];
    const profile = resolveVisualProfile(editorState.language, profiles);
    const button = elements.languageButtons.find((candidate) => {
      if (candidate.dataset.drawingLanguage !== editorState.language)
        return false;
      const candidateProfile =
        candidate.dataset.drawingProfile || candidate.dataset.drawingLanguage;
      return candidateProfile === profile || profiles.length === 0;
    });
    if (button) chooseLanguage(button);
    state.language = editorState.language;
    state.packageProfiles = profiles;
    state.sourceByProfile.set(profile, editorState.source);
    if (elements.source) elements.source.value = editorState.source;
    const parsed = parseVisualDocument(profile, editorState.source);
    state.visualLocked = !parsed.lossless;
    if (visualEditor) {
      visualEditor.setProfile(profile, { commit: false });
      if (parsed.lossless) {
        visualEditor.replaceDocument(profile, parsed.objects, {
          commit: false,
        });
      }
    }
    activateMode("drawing");
    invalidateCompilation();
    setEditorMode(parsed.lossless ? "visual" : "source");
    status("已从 Office 可编辑对象恢复绘图源码；请确认预览后保存");
    schedulePreview();
    return exportEditableState();
  };

  const loadPlotTable = (tablePayload) => {
    const imported = tablePayloadToPlotData(tablePayload);
    const pgfButton = elements.languageButtons.find(
      (button) =>
        (button.dataset.drawingProfile || button.dataset.drawingLanguage) ===
        "pgf_plots",
    );
    if (pgfButton) chooseLanguage(pgfButton);
    activateMode("drawing");
    if (elements.plotData) elements.plotData.value = imported.source;
    if (elements.plotXLabel) elements.plotXLabel.value = imported.headers[0];
    if (elements.plotYLabel) elements.plotYLabel.value = imported.headers[1];
    if (elements.plotFitStatus) {
      elements.plotFitStatus.textContent = `已从 Excel 导入 ${imported.points.length} 个有效数据点；请选择模型后执行拟合`;
      elements.plotFitStatus.dataset.state = "success";
    }
    status(`Excel 选区已导入 PGFPlots：${imported.points.length} 个数据点`);
    return imported;
  };

  return {
    state,
    activateMode,
    chooseLanguage,
    compile,
    insert,
    copy,
    sendPlatform,
    refreshReadiness,
    setEditorMode,
    visualEditor,
    exportEditableState,
    loadEditableState,
    loadPlotTable,
  };
}

export function drawingWorkspaceElements(root = document) {
  return {
    formulaTab: root.getElementById("formulaModeTab"),
    drawingTab: root.getElementById("drawingModeTab"),
    symbolComposerTab: root.getElementById("symbolComposerModeTab"),
    formulaWorkspace: root.getElementById("formulaWorkspace"),
    drawingWorkspace: root.getElementById("drawingWorkspace"),
    symbolComposerWorkspace: root.getElementById("symbolComposerWorkspace"),
    languageButtons: [...root.querySelectorAll("[data-drawing-language]")],
    source: root.getElementById("drawingSource"),
    visualModeButton: root.getElementById("drawingVisualModeBtn"),
    sourceModeButton: root.getElementById("drawingSourceModeBtn"),
    visualEditor: root.getElementById("drawingVisualEditor"),
    sourceEditor: root.getElementById("drawingSourceEditor"),
    visualCanvas: root.getElementById("drawingVisualCanvas"),
    canvasZoomOut: root.getElementById("drawingCanvasZoomOut"),
    canvasZoomIn: root.getElementById("drawingCanvasZoomIn"),
    canvasReset: root.getElementById("drawingCanvasReset"),
    canvasFit: root.getElementById("drawingCanvasFit"),
    canvasZoomValue: root.getElementById("drawingCanvasZoomValue"),
    canvasUndo: root.getElementById("drawingCanvasUndo"),
    canvasRedo: root.getElementById("drawingCanvasRedo"),
    canvasGridToggle: root.getElementById("drawingCanvasGridToggle"),
    canvasSnapToggle: root.getElementById("drawingCanvasSnapToggle"),
    canvasToolButtons: [...root.querySelectorAll("[data-drawing-canvas-tool]")],
    alignButtons: [...root.querySelectorAll("[data-drawing-align]")],
    editorModeHint: root.getElementById("drawingEditorModeHint"),
    compileButton: root.getElementById("drawingCompileBtn"),
    insertButton: root.getElementById("drawingInsertBtn"),
    copyButton: root.getElementById("drawingCopyBtn"),
    sendPlatformButton: root.getElementById("drawingSendPlatformBtn"),
    autoPreview: root.getElementById("drawingAutoPreview"),
    gridToggle: root.getElementById("drawingGridToggle"),
    zoom: root.getElementById("drawingZoom"),
    zoomValue: root.getElementById("drawingZoomValue"),
    graphvizEngine: root.getElementById("drawingGraphvizEngine"),
    plotCurve: root.getElementById("drawingPlotCurve"),
    plotLegend: root.getElementById("drawingPlotLegend"),
    plotStyle: root.getElementById("drawingPlotStyle"),
    plotSamples: root.getElementById("drawingPlotSamples"),
    plotApply: root.getElementById("drawingPlotApply"),
    plotAdd: root.getElementById("drawingPlotAdd"),
    plotXLabel: root.getElementById("drawingPlotXLabel"),
    plotYLabel: root.getElementById("drawingPlotYLabel"),
    plotYMin: root.getElementById("drawingPlotYMin"),
    plotYMax: root.getElementById("drawingPlotYMax"),
    plotYTick: root.getElementById("drawingPlotYTick"),
    plotAutoY: root.getElementById("drawingPlotAutoY"),
    plotGrid: root.getElementById("drawingPlotGrid"),
    plotLegendPosition: root.getElementById("drawingPlotLegendPosition"),
    plotLegendColumns: root.getElementById("drawingPlotLegendColumns"),
    plotLegendFontSize: root.getElementById("drawingPlotLegendFontSize"),
    plotLegendOpacity: root.getElementById("drawingPlotLegendOpacity"),
    plotAxesApply: root.getElementById("drawingPlotAxesApply"),
    plotPresetButtons: [...root.querySelectorAll("[data-plot-expression]")],
    plotData: root.getElementById("drawingPlotData"),
    plotImportExcel: root.getElementById("drawingPlotImportExcel"),
    plotFitModel: root.getElementById("drawingPlotFitModel"),
    plotFit: root.getElementById("drawingPlotFit"),
    plotFitAppend: root.getElementById("drawingPlotFitAppend"),
    plotFitStatus: root.getElementById("drawingPlotFitStatus"),
    plotManagerSection: root.getElementById("drawingPlotManagerSection"),
    plotManagerList: root.getElementById("drawingPlotManagerList"),
    profilePanels: [...root.querySelectorAll("[data-drawing-workbench]")],
    profileTemplateButtons: [
      ...root.querySelectorAll("[data-drawing-profile-template]"),
    ],
    toolButtons: [...root.querySelectorAll("[data-drawing-tool]")],
    status: root.getElementById("drawingCompileStatus"),
    preview: root.getElementById("drawingPreview"),
    previewSource: root.getElementById("drawingPreviewSource"),
    readiness: root.getElementById("drawingReadiness"),
    helpButton: root.getElementById("drawingHelpButton"),
    helpPanel: root.getElementById("drawingHelpPanel"),
    presetButtons: [...root.querySelectorAll("[data-drawing-preset]")],
    inspectorEmpty: root.getElementById("drawingInspectorEmpty"),
    inspectorControls: root.getElementById("drawingInspectorControls"),
    inspectorType: root.getElementById("drawingInspectorType"),
    inspectorX: root.getElementById("drawingInspectorX"),
    inspectorY: root.getElementById("drawingInspectorY"),
    inspectorWidth: root.getElementById("drawingInspectorWidth"),
    inspectorHeight: root.getElementById("drawingInspectorHeight"),
    inspectorRotation: root.getElementById("drawingInspectorRotation"),
    inspectorStroke: root.getElementById("drawingInspectorStroke"),
    inspectorCornerRadius: root.getElementById("drawingInspectorCornerRadius"),
    inspectorColor: root.getElementById("drawingInspectorColor"),
    inspectorText: root.getElementById("drawingInspectorText"),
    inspectorTextSection: root.getElementById("drawingInspectorTextSection"),
    inspectorFontFamily: root.getElementById("drawingInspectorFontFamily"),
    inspectorFontSize: root.getElementById("drawingInspectorFontSize"),
    inspectorFontWeight: root.getElementById("drawingInspectorFontWeight"),
    inspectorFontStyle: root.getElementById("drawingInspectorFontStyle"),
    inspectorStrokeColor: root.getElementById("drawingInspectorStrokeColor"),
    inspectorStrokePreview: root.getElementById(
      "drawingInspectorStrokePreview",
    ),
    inspectorFill: root.getElementById("drawingInspectorFill"),
    inspectorFillPreview: root.getElementById("drawingInspectorFillPreview"),
    inspectorTextColor: root.getElementById("drawingInspectorTextColor"),
    inspectorTextColorPreview: root.getElementById(
      "drawingInspectorTextColorPreview",
    ),
    inspectorLineStyle: root.getElementById("drawingInspectorLineStyle"),
    inspectorOpacity: root.getElementById("drawingInspectorOpacity"),
    inspectorFillOpacity: root.getElementById("drawingInspectorFillOpacity"),
    inspectorRelation: root.getElementById("drawingInspectorRelation"),
    inspectorFromNodes: root.getElementById("drawingInspectorFromNodes"),
    inspectorToNodes: root.getElementById("drawingInspectorToNodes"),
    inspectorDisconnect: root.getElementById("drawingInspectorDisconnect"),
    inspectorQuickConnectSection: root.getElementById(
      "drawingInspectorQuickConnectSection",
    ),
    inspectorQuickTargets: root.getElementById("drawingInspectorQuickTargets"),
    inspectorQuickArrow: root.getElementById("drawingInspectorQuickArrow"),
    inspectorQuickConnector: root.getElementById(
      "drawingInspectorQuickConnector",
    ),
    inspectorCancelConnect: root.getElementById(
      "drawingInspectorCancelConnect",
    ),
    inspectorRelationOverviewSection: root.getElementById(
      "drawingInspectorRelationOverviewSection",
    ),
    inspectorRelationOverview: root.getElementById(
      "drawingInspectorRelationOverview",
    ),
    inspectorRelationCreate: root.getElementById(
      "drawingInspectorRelationCreate",
    ),
    inspectorSwatches: [...root.querySelectorAll("[data-drawing-color]")],
    inspectorDuplicate: root.getElementById("drawingInspectorDuplicate"),
    inspectorForward: root.getElementById("drawingInspectorForward"),
    inspectorBack: root.getElementById("drawingInspectorBack"),
    inspectorDelete: root.getElementById("drawingInspectorDelete"),
    objectManagerSection: root.getElementById("drawingObjectManagerSection"),
    objectManagerList: root.getElementById("drawingObjectManagerList"),
    tikzChineseText: root.getElementById("drawingTikzChineseText"),
    tikzChineseType: root.getElementById("drawingTikzChineseType"),
    tikzChineseAdd: root.getElementById("drawingTikzChineseAdd"),
    tikzChineseStatus: root.getElementById("drawingTikzChineseStatus"),
    tikzLatex: root.getElementById("drawingTikzLatex"),
    tikzLatexAdd: root.getElementById("drawingTikzLatexAdd"),
    tikzLatexStatus: root.getElementById("drawingTikzLatexStatus"),
    plotExpression: root.getElementById("drawingPlotExpression"),
    plotMin: root.getElementById("drawingPlotMin"),
    plotMax: root.getElementById("drawingPlotMax"),
    graphNodeLabel: root.getElementById("drawingGraphNodeLabel"),
    graphNodeShape: root.getElementById("drawingGraphNodeShape"),
    graphNodeAdd: root.getElementById("drawingGraphNodeAdd"),
    graphRelationLabel: root.getElementById("drawingGraphRelationLabel"),
    graphRelationType: root.getElementById("drawingGraphRelationType"),
    graphConnect: root.getElementById("drawingGraphConnect"),
    mindRoot: root.getElementById("drawingMindRoot"),
    mindRootCreate: root.getElementById("drawingMindRootCreate"),
    mindChild: root.getElementById("drawingMindChild"),
    mindChildAdd: root.getElementById("drawingMindChildAdd"),
    mermaidNodeLabel: root.getElementById("drawingMermaidNodeLabel"),
    mermaidNodeShape: root.getElementById("drawingMermaidNodeShape"),
    mermaidNodeAdd: root.getElementById("drawingMermaidNodeAdd"),
    mermaidRelationLabel: root.getElementById("drawingMermaidRelationLabel"),
    mermaidRelationType: root.getElementById("drawingMermaidRelationType"),
    mermaidConnect: root.getElementById("drawingMermaidConnect"),
  };
}

export function initDrawingWorkspace({
  invoke,
  insertDrawing,
  formulaRenderer,
  readSpreadsheetTable,
  root = document,
}) {
  const waitForAction = async (actionId, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const record = await invoke("get_ecosystem_action_status_internal", {
        actionId,
      });
      const actionStatus = String(record?.status || "").toLowerCase();
      if (actionStatus === "completed") return record;
      if (["failed", "canceled", "expired"].includes(actionStatus)) {
        const error = new Error(
          record?.error?.message || `Ecosystem action ${actionStatus}`,
        );
        error.code =
          record?.error?.code ||
          `ECOSYSTEM_ACTION_${actionStatus.toUpperCase()}`;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const error = new Error(
      "目标插件未确认图片插入，请确认它在线且存在活动文档",
    );
    error.code = "ECOSYSTEM_ACTION_TIMEOUT";
    throw error;
  };

  const controller = createDrawingWorkspaceController({
    elements: drawingWorkspaceElements(root),
    compileDrawing: (request) => invoke("compile_drawing_svg", { request }),
    renderLocal: renderDrawingLocally,
    insertDrawing,
    copyDrawing: (request) => invoke("copy_drawing_bundle", { request }),
    sendDrawingToPlatform: async ({ pngBase64 }) => {
      const container = root.getElementById("ecosystemHostSelector");
      const trigger = container?.querySelector(".custom-select-trigger");
      const target = trigger?.dataset?.value || "";
      const targetClientId = trigger?.dataset?.clientId || "";
      if (!target || !targetClientId) {
        throw new Error("请先在公式工作区选择一个在线目标插件");
      }
      if (!new Set(["obsidian", "vscode"]).has(target)) {
        const error = new Error(
          "该平台暂不支持自动保存图片附件；请使用“多格式复制”后粘贴",
        );
        error.code = "ECOSYSTEM_IMAGE_TARGET_UNSUPPORTED";
        throw error;
      }
      const actionId = await invoke("push_ecosystem_action_internal", {
        request: {
          target,
          targetClientId,
          action: {
            type: "InsertImage",
            pngBase64,
            fileName: `latexsnipper-drawing-${Date.now()}.png`,
            altText: "LaTeXSnipper drawing",
          },
        },
      });
      return waitForAction(actionId);
    },
    rasterizeDrawing: rasterizeDrawingSvg,
    loadReadiness: () => invoke("get_drawing_readiness"),
    formulaRenderer,
    readSpreadsheetTable,
  });
  void controller.refreshReadiness();
  return controller;
}

export function selectProductionDrawingRoute({
  payload,
  host,
  os,
  requestEditable = true,
  drawingOleAvailable = false,
}) {
  return selectDrawingOfficeRoute({
    payload,
    host,
    os,
    requestEditable,
    capabilities: {
      nativeShapes: false,
      drawingOle: drawingOleAvailable,
      svg: true,
      png: true,
      pdfExport: false,
    },
  });
}

export async function planProductionDrawingRoute({
  payload,
  host,
  os,
  requestEditable = true,
  drawingOleAvailable = false,
}) {
  return planDrawingOfficeRoute({
    payload,
    host,
    os,
    requestEditable,
    capabilities: {
      nativeShapes: false,
      drawingOle: drawingOleAvailable,
      svg: true,
      png: true,
      pdfExport: false,
    },
  });
}
