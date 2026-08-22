import {
  drawingAdapterReadiness,
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
    line: "线段",
    arrow: "箭头",
    connector: "连接线",
    node: "节点",
    rectangle: "矩形",
    ellipse: "椭圆",
    diamond: "菱形",
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
  tikz: "数学构图 · 几何对象与 LaTeX 标注直接写入 TikZ；安全预览是实际编译效果",
  pgf_plots:
    "函数与数据工作台 · 曲线、采样点和坐标设置直接生成 axis / addplot 源码",
  graphviz_dot:
    "关系图工作台 · 节点坐标与端口关系直接写入 DOT；视觉模式固定 Neato 坐标",
  mermaid:
    "语义图表工作台 · 流程、时序、状态和思维层级写入 Mermaid，由引擎负责最终排版",
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
  const padding = Math.max(4, Math.max(width, height) * paddingRatio);
  return [x - padding, y - padding, width + padding * 2, height + padding * 2]
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
      const renderedSvg = renderLocal
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
        fitDrawingPreview(elements.preview);
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
  const syncInspector = (object) => {
    if (elements.inspectorEmpty)
      elements.inspectorEmpty.hidden = Boolean(object);
    if (elements.inspectorControls) elements.inspectorControls.hidden = !object;
    if (!object) return;
    const capabilities = visualTransformCapabilities(object);
    if (elements.inspectorType) {
      const objectNames = {
        line: "线段",
        arrow: "箭头",
        connector: "连接线",
        node: "节点",
        rectangle: "矩形",
        ellipse: "椭圆",
        diamond: "判断节点",
        axes: "坐标轴",
        plot: "函数曲线",
        label: "文本标注",
        formula: "LaTeX 数学标注",
      };
      elements.inspectorType.textContent =
        objectNames[object.type] || object.type || "对象";
    }
    for (const [element, value] of [
      [elements.inspectorWidth, object.width],
      [elements.inspectorHeight, object.height],
      [elements.inspectorRotation, object.rotation],
      [elements.inspectorStroke, object.strokeWidth],
    ]) {
      if (element && document.activeElement !== element)
        element.value = String(Math.round(Number(value) * 10) / 10);
    }
    if (elements.inspectorWidth)
      elements.inspectorWidth.disabled = !capabilities.resize;
    if (elements.inspectorHeight)
      elements.inspectorHeight.disabled = !capabilities.resize;
    if (elements.inspectorRotation)
      elements.inspectorRotation.disabled = !capabilities.rotate;
    if (elements.inspectorColor)
      elements.inspectorColor.textContent = object.color || "#2563EB";
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
      syncField(elements.plotGrid, object.grid || "major");
      syncField(
        elements.plotLegendPosition,
        object.legendPosition || "north east",
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
        visualEditor.replaceDocument(profile, parsed.objects, {
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
    });
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
      visualEditor?.updateProfileObject(
        "axes",
        {
          yMin: patch.yMin,
          yMax: patch.yMax,
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
    setEditorMode("visual");
    if (state.editorMode !== "visual") return;
    visualEditor?.updateProfileObject(
      "axes",
      {
        xLabel: elements.plotXLabel?.value || "x",
        yLabel: elements.plotYLabel?.value || "f(x)",
        yMin: Number(elements.plotYMin?.value || -1.5),
        yMax: Number(elements.plotYMax?.value || 1.5),
        grid: controlValue(elements.plotGrid, "major"),
        legendPosition: controlValue(elements.plotLegendPosition, "north east"),
      },
      { createIfMissing: true },
    );
    status("坐标轴、网格与图例位置已写入 PGFPlots 源码");
  };
  elements.plotAxesApply?.addEventListener("click", applyAxesBuilder);
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
      visualEditor?.add("plot", {
        ...plotPatch(),
        curve: "custom",
        expression: fitted.expression,
        legend,
        fitModel: fitted.model,
        fitCoefficients: fitted.coefficients,
        fitRSquared: fitted.rSquared,
        dataPoints: fitted.points,
        xMin: fitted.xMin,
        xMax: fitted.xMax,
        yMin: yLow - yPadding,
        yMax: yHigh + yPadding,
        samples: Math.max(160, Number(elements.plotSamples?.value || 160)),
        x: 385,
        y: 260,
        width: 300,
        height: 160,
      });
      visualEditor?.updateProfileObject(
        "axes",
        {
          xLabel: elements.plotXLabel?.value || "x",
          yLabel: elements.plotYLabel?.value || "f(x)",
          yMin: yLow - yPadding,
          yMax: yHigh + yPadding,
          grid: controlValue(elements.plotGrid, "major"),
          legendPosition: controlValue(
            elements.plotLegendPosition,
            "north east",
          ),
        },
        { createIfMissing: true },
      );
      if (elements.plotFitStatus) {
        elements.plotFitStatus.textContent = `${points.length} 个点 · ${legend} · ${fitted.expression}`;
        elements.plotFitStatus.dataset.state = "success";
      }
      status("采样点与拟合曲线已同时写入 PGFPlots 源码");
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
    [elements.inspectorWidth, "width"],
    [elements.inspectorHeight, "height"],
    [elements.inspectorRotation, "rotation"],
    [elements.inspectorStroke, "strokeWidth"],
  ];
  for (const [input, property] of inspectorUpdates) {
    input?.addEventListener("input", () => {
      visualEditor?.updateSelected({ [property]: Number(input.value) });
    });
  }
  elements.inspectorText?.addEventListener("input", () => {
    visualEditor?.updateSelected({ text: elements.inspectorText.value });
  });
  for (const swatch of elements.inspectorSwatches || []) {
    swatch.addEventListener("click", () => {
      visualEditor?.updateSelected({ color: swatch.dataset.drawingColor });
    });
  }
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
        if (["arrow", "connector"].includes(type)) {
          visualEditor.beginConnection(type);
          status("连接模式已开启：从起点端口拖到目标节点即可建立关系");
        } else {
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
    plotGrid: root.getElementById("drawingPlotGrid"),
    plotLegendPosition: root.getElementById("drawingPlotLegendPosition"),
    plotAxesApply: root.getElementById("drawingPlotAxesApply"),
    plotPresetButtons: [...root.querySelectorAll("[data-plot-expression]")],
    plotData: root.getElementById("drawingPlotData"),
    plotFitModel: root.getElementById("drawingPlotFitModel"),
    plotFit: root.getElementById("drawingPlotFit"),
    plotFitStatus: root.getElementById("drawingPlotFitStatus"),
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
    inspectorWidth: root.getElementById("drawingInspectorWidth"),
    inspectorHeight: root.getElementById("drawingInspectorHeight"),
    inspectorRotation: root.getElementById("drawingInspectorRotation"),
    inspectorStroke: root.getElementById("drawingInspectorStroke"),
    inspectorColor: root.getElementById("drawingInspectorColor"),
    inspectorText: root.getElementById("drawingInspectorText"),
    inspectorSwatches: [...root.querySelectorAll("[data-drawing-color]")],
    inspectorDuplicate: root.getElementById("drawingInspectorDuplicate"),
    inspectorForward: root.getElementById("drawingInspectorForward"),
    inspectorBack: root.getElementById("drawingInspectorBack"),
    inspectorDelete: root.getElementById("drawingInspectorDelete"),
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
  });
  void controller.refreshReadiness();
  return controller;
}

export function selectProductionDrawingRoute({ payload, host, os }) {
  return selectDrawingOfficeRoute({
    payload,
    host,
    os,
    capabilities: {
      nativeShapes: false,
      drawingOle: false,
      svg: true,
      png: false,
      pdfExport: false,
    },
  });
}
