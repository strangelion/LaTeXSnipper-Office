import {
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
  spectrumPointInside,
} from "./color-picker.js";

const SYMBOL_GROUPS = Object.freeze([
  [
    "常用",
    [
      ["plus", "+", "\\plus"],
      ["minus", "−", "\\minus"],
      ["times", "×", "\\times"],
      ["divide", "÷", "\\div"],
      ["equals", "=", "="],
      ["not-equal", "≠", "\\neq"],
      ["less", "<", "<"],
      ["greater", ">", ">"],
      ["less-equal", "≤", "\\leq"],
      ["greater-equal", "≥", "\\geq"],
      ["approx", "≈", "\\approx"],
      ["propto", "∝", "\\propto"],
    ],
  ],
  [
    "算子",
    [
      ["sum", "∑", "\\sum"],
      ["product", "∏", "\\prod"],
      ["coproduct", "∐", "\\coprod"],
      ["integral", "∫", "\\int"],
      ["double-integral", "∬", "\\iint"],
      ["contour", "∮", "\\oint"],
      ["root", "√", "\\sqrt{}"],
      ["partial", "∂", "\\partial"],
      ["nabla", "∇", "\\nabla"],
      ["infinity", "∞", "\\infty"],
      ["angle", "∠", "\\angle"],
      ["perpendicular", "⊥", "\\perp"],
    ],
  ],
  [
    "关系",
    [
      ["equiv", "≡", "\\equiv"],
      ["sim", "∼", "\\sim"],
      ["simeq", "≃", "\\simeq"],
      ["cong", "≅", "\\cong"],
      ["parallel", "∥", "\\parallel"],
      ["mid", "∣", "\\mid"],
      ["models", "⊨", "\\models"],
      ["vdash", "⊢", "\\vdash"],
      ["dashv", "⊣", "\\dashv"],
      ["prec", "≺", "\\prec"],
      ["succ", "≻", "\\succ"],
      ["asymp", "≍", "\\asymp"],
    ],
  ],
  [
    "集合",
    [
      ["in", "∈", "\\in"],
      ["not-in", "∉", "\\notin"],
      ["contains", "∋", "\\ni"],
      ["subset", "⊂", "\\subset"],
      ["subset-equal", "⊆", "\\subseteq"],
      ["supset", "⊃", "\\supset"],
      ["supset-equal", "⊇", "\\supseteq"],
      ["union", "∪", "\\cup"],
      ["intersection", "∩", "\\cap"],
      ["emptyset", "∅", "\\emptyset"],
      ["setminus", "∖", "\\setminus"],
      ["there-exists", "∃", "\\exists"],
    ],
  ],
  [
    "箭头",
    [
      ["arrow-right", "→", "\\rightarrow"],
      ["arrow-left", "←", "\\leftarrow"],
      ["arrow-both", "↔", "\\leftrightarrow"],
      ["arrow-up", "↑", "\\uparrow"],
      ["arrow-down", "↓", "\\downarrow"],
      ["arrow-up-down", "↕", "\\updownarrow"],
      ["implies", "⇒", "\\Rightarrow"],
      ["implied-by", "⇐", "\\Leftarrow"],
      ["iff", "⇔", "\\Leftrightarrow"],
      ["mapsto", "↦", "\\mapsto"],
      ["hook-right", "↪", "\\hookrightarrow"],
      ["long-right", "⟶", "\\longrightarrow"],
    ],
  ],
  [
    "希腊",
    [
      ["alpha", "α", "\\alpha"],
      ["beta", "β", "\\beta"],
      ["gamma", "γ", "\\gamma"],
      ["delta", "δ", "\\delta"],
      ["epsilon", "ε", "\\epsilon"],
      ["theta", "θ", "\\theta"],
      ["lambda", "λ", "\\lambda"],
      ["mu", "μ", "\\mu"],
      ["pi", "π", "\\pi"],
      ["rho", "ρ", "\\rho"],
      ["sigma", "σ", "\\sigma"],
      ["omega", "ω", "\\omega"],
    ],
  ],
  [
    "逻辑",
    [
      ["forall", "∀", "\\forall"],
      ["exists", "∃", "\\exists"],
      ["not-exists", "∄", "\\nexists"],
      ["logical-not", "¬", "\\neg"],
      ["logical-and", "∧", "\\land"],
      ["logical-or", "∨", "\\lor"],
      ["therefore", "∴", "\\therefore"],
      ["because", "∵", "\\because"],
      ["top", "⊤", "\\top"],
      ["bottom", "⊥", "\\bot"],
      ["oplus", "⊕", "\\oplus"],
      ["otimes", "⊗", "\\otimes"],
    ],
  ],
  [
    "定界",
    [
      ["paren-left", "(", "("],
      ["paren-right", ")", ")"],
      ["bracket-left", "[", "["],
      ["bracket-right", "]", "]"],
      ["brace-left", "{", "\\{"],
      ["brace-right", "}", "\\}"],
      ["angle-left", "⟨", "\\langle"],
      ["angle-right", "⟩", "\\rangle"],
      ["floor-left", "⌊", "\\lfloor"],
      ["floor-right", "⌋", "\\rfloor"],
      ["ceil-left", "⌈", "\\lceil"],
      ["ceil-right", "⌉", "\\rceil"],
    ],
  ],
]);

const BUILTIN_SYMBOLS = SYMBOL_GROUPS.flatMap(([category, items]) =>
  items.map(([id, glyph, latex]) => ({ id, glyph, latex, category })),
);
const SYMBOL_GLYPHS = new Map(
  BUILTIN_SYMBOLS.map(({ id, glyph }) => [id, glyph]),
);
const MAX_HISTORY = 50;

export function buildSmoothFreehandPath(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  const coordinate = (point) =>
    `${Number(point.x).toFixed(1)},${Number(point.y).toFixed(1)}`;
  if (points.length === 1) return `M${coordinate(points[0])}`;
  if (points.length === 2)
    return `M${coordinate(points[0])} L${coordinate(points[1])}`;
  let path = `M${coordinate(points[0])}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpoint = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    };
    path += ` Q${coordinate(current)} ${coordinate(midpoint)}`;
  }
  path += ` T${coordinate(points.at(-1))}`;
  return path;
}

export function projectComposerPoint(clientX, clientY, bounds) {
  const x = ((clientX - bounds.left) * 1000) / Math.max(1, bounds.width);
  const y = ((clientY - bounds.top) * 1000) / Math.max(1, bounds.height);
  return {
    x: Math.max(0, Math.min(1000, x)),
    y: Math.max(0, Math.min(1000, y)),
  };
}

export function resolveComposerViewportBounds(bounds, viewBox) {
  const result = {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
  const viewWidth = Number(viewBox?.width) || 1000;
  const viewHeight = Number(viewBox?.height) || 1000;
  const boxRatio = result.width / Math.max(1, result.height);
  const viewRatio = viewWidth / Math.max(1, viewHeight);
  if (boxRatio > viewRatio) {
    const contentWidth = result.height * viewRatio;
    result.left += (result.width - contentWidth) / 2;
    result.width = contentWidth;
  } else if (boxRatio < viewRatio) {
    const contentHeight = result.width / viewRatio;
    result.top += (result.height - contentHeight) / 2;
    result.height = contentHeight;
  }
  return result;
}

export function coalescedPointerSamples(event) {
  const coalesced = event.getCoalescedEvents?.();
  return coalesced?.length ? coalesced : [event];
}

const PATH_PRESETS = Object.freeze({
  arrow: ["箭头", "M-210,0 L150,0 M75,-75 L150,0 L75,75", [-220, -85, 165, 85]],
  "double-arrow": [
    "双箭头",
    "M-150,0 L150,0 M-75,-75 L-150,0 L-75,75 M75,-75 L150,0 L75,75",
    [-165, -85, 165, 85],
  ],
  triangle: ["三角形", "M0,-200 L190,150 L-190,150 Z", [-200, -210, 200, 160]],
  diamond: ["菱形", "M0,-210 L190,0 L0,210 L-190,0 Z", [-200, -220, 200, 220]],
  hexagon: [
    "六边形",
    "M-190,-105 L0,-210 L190,-105 L190,105 L0,210 L-190,105 Z",
    [-200, -220, 200, 220],
  ],
  star: [
    "星形",
    "M0,-220 L52,-70 L210,-68 L82,25 L130,185 L0,92 L-130,185 L-82,25 L-210,-68 L-52,-70 Z",
    [-220, -230, 220, 195],
  ],
  arc: ["圆弧", "M-210,110 Q0,-220 210,110", [-220, -230, 220, 120]],
  wave: [
    "波浪线",
    "M-220,0 C-165,-110 -55,-110 0,0 C55,110 165,110 220,0",
    [-230, -120, 230, 120],
  ],
  brace: [
    "花括号",
    "M120,-230 C-20,-230 20,-55 -115,-30 C20,-5 -20,230 120,230",
    [-125, -240, 130, 240],
  ],
  bracket: [
    "方括号",
    "M110,-230 L-95,-230 L-95,230 L110,230",
    [-105, -240, 120, 240],
  ],
  check: ["对勾", "M-190,10 L-45,160 L210,-180", [-200, -190, 220, 170]],
});

const defaultMetrics = () => ({
  unitsPerEm: 1000,
  advanceWidth: 440,
  boundingBox: { minX: -220, minY: -300, maxX: 220, maxY: 300 },
  baseline: 0,
  mathAxis: 250,
  italicCorrection: 0,
  topAccentAttachment: null,
  superscriptAnchor: null,
  subscriptAnchor: null,
  displayScale: 1,
  textScale: 1,
  scriptScale: 0.7,
  scriptscriptScale: 0.5,
  limitsMode: "no_limits",
});

const defaultTransform = () => ({
  translateX: 500,
  translateY: 500,
  scaleX: 1,
  scaleY: 1,
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

function escapeXml(value) {
  return String(value).replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

function symbolLayer(symbol, zIndex) {
  return {
    layerId: uid("symbol"),
    name: symbol.glyph,
    source: {
      kind: "symbol",
      symbolId: symbol.id,
      packId: "builtin-math",
      metricsSnapshot: defaultMetrics(),
    },
    transform: defaultTransform(),
    opacity: 1,
    color: "#18212F",
    zIndex,
    visible: true,
  };
}

function pathPrimitive(pathData, bounds, filled = false) {
  return {
    kind: "path",
    pathData,
    bounds: {
      minX: bounds[0],
      minY: bounds[1],
      maxX: bounds[2],
      maxY: bounds[3],
    },
    strokeWidth: 18,
    filled,
  };
}

function primitiveLayer(kind, zIndex) {
  let name;
  let primitive;
  if (kind === "line") {
    name = "线段";
    primitive = {
      kind: "line",
      from: { x: -190, y: 0 },
      to: { x: 190, y: 0 },
      strokeWidth: 18,
    };
  } else if (kind === "rectangle" || kind === "rounded-rectangle") {
    name = kind === "rectangle" ? "矩形" : "圆角矩形";
    primitive = {
      kind: "rectangle",
      bounds: { minX: -190, minY: -135, maxX: 190, maxY: 135 },
      cornerRadius: kind === "rectangle" ? 0 : 38,
      strokeWidth: 18,
      filled: false,
    };
  } else if (kind === "ellipse") {
    name = "椭圆";
    primitive = {
      kind: "ellipse",
      center: { x: 0, y: 0 },
      radiusX: 190,
      radiusY: 135,
      strokeWidth: 18,
      filled: false,
    };
  } else {
    const preset = PATH_PRESETS[kind] || PATH_PRESETS.arc;
    [name] = preset;
    primitive = pathPrimitive(preset[1], preset[2]);
  }
  return {
    layerId: uid(kind),
    name,
    source: { kind: "primitive", primitive },
    transform: defaultTransform(),
    opacity: 1,
    color: "#18212F",
    zIndex,
    visible: true,
  };
}

function formulaLayer(latex, renderedSvg, widthPt, heightPt, zIndex) {
  const ratio = Math.max(0.08, widthPt / Math.max(heightPt, 1));
  const height = Math.min(520, Math.max(180, 520 / Math.max(1, ratio / 2.2)));
  const width = Math.min(760, Math.max(100, height * ratio));
  const bounds = {
    minX: -width / 2,
    minY: -height / 2,
    maxX: width / 2,
    maxY: height / 2,
  };
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(renderedSvg, "image/svg+xml");
  const root = documentNode.documentElement;
  const viewBox = root.getAttribute("viewBox") || `0 0 ${widthPt} ${heightPt}`;
  const nestedSvg = `<svg x="${bounds.minX}" y="${bounds.minY}" width="${width}" height="${height}" viewBox="${escapeXml(viewBox)}" preserveAspectRatio="xMidYMid meet">${root.innerHTML}</svg>`;
  const metrics = defaultMetrics();
  metrics.advanceWidth = width;
  metrics.boundingBox = bounds;
  return {
    layerId: uid("formula"),
    name: latex,
    source: {
      kind: "formula",
      latex,
      metricsSnapshot: metrics,
      renderedSvg: nestedSvg,
    },
    transform: defaultTransform(),
    opacity: 1,
    color: "#18212F",
    zIndex,
    visible: true,
  };
}

function primitiveSvg(primitive) {
  switch (primitive.kind) {
    case "line":
      return `<line x1="${primitive.from.x}" y1="${primitive.from.y}" x2="${primitive.to.x}" y2="${primitive.to.y}" stroke="currentColor" stroke-width="${primitive.strokeWidth}" stroke-linecap="round"/>`;
    case "rectangle": {
      const b = primitive.bounds;
      return `<rect x="${b.minX}" y="${b.minY}" width="${b.maxX - b.minX}" height="${b.maxY - b.minY}" rx="${primitive.cornerRadius}" fill="${primitive.filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${primitive.strokeWidth}"/>`;
    }
    case "ellipse":
      return `<ellipse cx="${primitive.center.x}" cy="${primitive.center.y}" rx="${primitive.radiusX}" ry="${primitive.radiusY}" fill="${primitive.filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${primitive.strokeWidth}"/>`;
    case "path":
      return `<path d="${escapeXml(primitive.pathData)}" fill="${primitive.filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${primitive.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    default:
      return "";
  }
}

function layerBounds(layer) {
  if (layer.source.kind === "symbol" || layer.source.kind === "formula") {
    return (
      layer.source.metricsSnapshot?.boundingBox || {
        minX: -220,
        minY: -300,
        maxX: 220,
        maxY: 300,
      }
    );
  }
  const primitive = layer.source.primitive;
  if (primitive.kind === "line") {
    const padding = Math.max(12, primitive.strokeWidth || 0);
    return {
      minX: Math.min(primitive.from.x, primitive.to.x) - padding,
      minY: Math.min(primitive.from.y, primitive.to.y) - padding,
      maxX: Math.max(primitive.from.x, primitive.to.x) + padding,
      maxY: Math.max(primitive.from.y, primitive.to.y) + padding,
    };
  }
  if (primitive.kind === "ellipse") {
    return {
      minX: primitive.center.x - primitive.radiusX,
      minY: primitive.center.y - primitive.radiusY,
      maxX: primitive.center.x + primitive.radiusX,
      maxY: primitive.center.y + primitive.radiusY,
    };
  }
  return primitive.bounds;
}

function transformControls(layer) {
  const bounds = layerBounds(layer);
  const padding = 26;
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const maxX = bounds.maxX + padding;
  const maxY = bounds.maxY + padding;
  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const rotateY = minY - 90;
  const handles = [
    [minX, minY, "nw"],
    [maxX, minY, "ne"],
    [maxX, maxY, "se"],
    [minX, maxY, "sw"],
  ]
    .map(
      ([x, y, corner]) =>
        `<circle class="symbol-transform-handle symbol-scale-handle" data-symbol-handle="scale" data-symbol-corner="${corner}" cx="${x}" cy="${y}" r="16"/>`,
    )
    .join("");
  const edgeHandles = [
    `<rect class="symbol-transform-handle symbol-horizontal-handle" data-symbol-handle="scale-x" x="${minX - 13}" y="${centerY - 21}" width="26" height="42" rx="7"/>`,
    `<rect class="symbol-transform-handle symbol-horizontal-handle" data-symbol-handle="scale-x" x="${maxX - 13}" y="${centerY - 21}" width="26" height="42" rx="7"/>`,
    `<rect class="symbol-transform-handle symbol-vertical-handle" data-symbol-handle="scale-y" x="${centerX - 21}" y="${minY - 13}" width="42" height="26" rx="7"/>`,
    `<rect class="symbol-transform-handle symbol-vertical-handle" data-symbol-handle="scale-y" x="${centerX - 21}" y="${maxY - 13}" width="42" height="26" rx="7"/>`,
  ].join("");
  return `<g class="symbol-transform-box" aria-hidden="true">
    <rect class="symbol-selection-frame" x="${minX}" y="${minY}" width="${width}" height="${height}" rx="8"/>
    <line class="symbol-rotate-stem" x1="${centerX}" y1="${minY}" x2="${centerX}" y2="${rotateY}"/>
    <circle class="symbol-transform-handle symbol-rotate-handle" data-symbol-handle="rotate" cx="${centerX}" cy="${rotateY}" r="18"/>
    ${handles}
    ${edgeHandles}
  </g>`;
}

export function rotationFromPointer(
  startRotation,
  startAngle,
  currentAngle,
  snapToStep = false,
) {
  let angleDelta = currentAngle - startAngle;
  if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
  if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
  let degrees = startRotation + (angleDelta * 180) / Math.PI;
  if (snapToStep) degrees = Math.round(degrees / 15) * 15;
  return Math.round(degrees * 10) / 10;
}

export function pointerInsideViewport(clientX, clientY, width, height) {
  return (
    Number.isFinite(clientX) &&
    Number.isFinite(clientY) &&
    clientX > 0 &&
    clientY > 0 &&
    clientX < width &&
    clientY < height
  );
}

export function compositionSvg(layers, selectedId = null) {
  let controls = "";
  const content = [...layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .filter(
      (layer) =>
        layer.visible && (layer.opacity > 0 || layer.layerId === selectedId),
    )
    .map((layer) => {
      const transform = layer.transform;
      const scaleX = transform.scaleX * (transform.flipHorizontal ? -1 : 1);
      const scaleY = transform.scaleY * (transform.flipVertical ? -1 : 1);
      const transformAttribute = `translate(${transform.translateX} ${transform.translateY}) rotate(${transform.rotationDegrees}) scale(${scaleX} ${scaleY})`;
      let body;
      if (layer.source.kind === "symbol") {
        body = `<text x="0" y="115" text-anchor="middle" font-size="540" font-family="Cambria Math, STIX Two Math, serif" fill="currentColor">${escapeXml(SYMBOL_GLYPHS.get(layer.source.symbolId) || "?")}</text>`;
      } else if (layer.source.kind === "formula") {
        body =
          layer.source.renderedSvg ||
          `<text x="0" y="20" text-anchor="middle" font-size="64" fill="currentColor">${escapeXml(layer.source.latex)}</text>`;
      } else {
        body = primitiveSvg(layer.source.primitive);
      }
      const selected =
        layer.layerId === selectedId ? " symbol-layer-selected" : "";
      if (layer.layerId === selectedId) {
        controls = `<g class="symbol-editor-overlay" data-layer-id="${escapeXml(layer.layerId)}" transform="${transformAttribute}">${transformControls(layer)}</g>`;
      }
      return `<g class="symbol-layer${selected}" data-layer-id="${escapeXml(layer.layerId)}" color="${escapeXml(layer.color || "#18212F")}" opacity="${layer.opacity}" transform="${transformAttribute}">${body}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="自定义符号预览"><g color="#18212f">${content}</g>${controls}</svg>`;
}

export function createCompositionPayload(layers, snapToGrid = true) {
  const detached = clone(layers);
  for (const layer of detached) {
    if (layer.source.kind === "formula") delete layer.source.renderedSvg;
  }
  return {
    schemaVersion: 1,
    layers: detached,
    snapToGrid,
    gridSize: 25,
    autoFitCanvas: true,
  };
}

export function buildCustomSymbolRequest({
  id,
  name,
  latexCommand,
  mathClass,
  layers,
  snapToGrid = true,
}) {
  const trimmedName = String(name || "").trim();
  const generatedId = `user-${
    trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
      .replace(/^-|-$/g, "") || Date.now()
  }`;
  return {
    id: id || generatedId,
    name: trimmedName,
    latexCommand: String(latexCommand || "").trim() || null,
    aliases: [],
    mathClass,
    composition: createCompositionPayload(layers, snapToGrid),
    svg: compositionSvg(layers),
  };
}

function elements(root) {
  const id = (value) => root.getElementById(value);
  return {
    palette: id("symbolComposerPalette"),
    categories: id("symbolCatalogCategories"),
    categoryPrev: id("symbolCategoryPrev"),
    categoryNext: id("symbolCategoryNext"),
    categoryStatus: id("symbolCategoryStatus"),
    search: id("symbolCatalogSearch"),
    formulaSource: id("symbolFormulaSource"),
    formulaPreview: id("symbolFormulaPreview"),
    formulaAdd: id("symbolFormulaAddBtn"),
    formulaStatus: id("symbolFormulaStatus"),
    canvas: id("symbolComposerCanvas"),
    status: id("symbolComposerStatus"),
    layerList: id("symbolLayerList"),
    inspector: id("symbolLayerInspector"),
    name: id("symbolNameInput"),
    latex: id("symbolLatexInput"),
    mathClass: id("symbolMathClassSelect"),
    snap: id("symbolSnapToggle"),
    undo: id("symbolUndoBtn"),
    redo: id("symbolRedoBtn"),
    duplicate: id("symbolDuplicateBtn"),
    delete: id("symbolDeleteBtn"),
    save: id("symbolSaveBtn"),
    copy: id("symbolCopyBtn"),
    x: id("symbolLayerX"),
    y: id("symbolLayerY"),
    scaleX: id("symbolLayerScaleX"),
    scaleY: id("symbolLayerScaleY"),
    rotation: id("symbolLayerRotation"),
    opacity: id("symbolLayerOpacity"),
    color: id("symbolLayerColor"),
    colorSwatch: id("symbolLayerColorSwatch"),
    colorPopover: id("symbolColorPopover"),
    colorSpectrum: id("symbolColorSpectrum"),
    colorSpectrumCursor: id("symbolColorSpectrumCursor"),
    colorHue: id("symbolColorHue"),
    colorOpacity: id("symbolColorOpacity"),
    colorOpacityValue: id("symbolColorOpacityValue"),
    colorPresets: [...root.querySelectorAll("[data-symbol-color]")],
    flipX: id("symbolFlipX"),
    flipY: id("symbolFlipY"),
    freehand: id("symbolFreehandBtn"),
    primitiveButtons: [...root.querySelectorAll("[data-symbol-primitive]")],
    actionButtons: [...root.querySelectorAll("[data-symbol-action]")],
  };
}

export function initCustomSymbolComposer({
  invoke,
  formulaRenderer,
  root = document,
  notify = () => {},
}) {
  const el = elements(root);
  const state = {
    layers: [],
    selectedId: null,
    history: [],
    future: [],
    drag: null,
    renderFrame: null,
    category: "常用",
    activeTool: null,
    colorEditActive: false,
  };
  const selected = () =>
    state.layers.find((layer) => layer.layerId === state.selectedId) || null;
  const message = (value) => {
    if (el.status) el.status.textContent = value;
  };
  const snapshot = () => {
    state.history.push(clone(state.layers));
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future.length = 0;
  };

  const syncInspector = () => {
    const layer = selected();
    el.inspector.disabled = !layer;
    if (!layer) return;
    el.x.value = String(Math.round(layer.transform.translateX * 100) / 100);
    el.y.value = String(Math.round(layer.transform.translateY * 100) / 100);
    el.scaleX.value = String(layer.transform.scaleX);
    el.scaleY.value = String(layer.transform.scaleY);
    el.rotation.value = String(layer.transform.rotationDegrees);
    el.opacity.value = String(layer.opacity);
    el.color.value = layer.color || "#18212F";
    el.colorSwatch.style.setProperty(
      "--symbol-layer-color",
      layer.color || "#18212F",
    );
    const hsv = hexToHsv(layer.color);
    el.colorHue.value = String(Math.round(hsv.hue));
    el.colorSpectrum.style.setProperty(
      "--symbol-picker-hue",
      String(Math.round(hsv.hue)),
    );
    el.colorSpectrumCursor.style.left = `${hsv.saturation * 100}%`;
    el.colorSpectrumCursor.style.top = `${(1 - hsv.value) * 100}%`;
    el.colorOpacity.value = String(Math.round(layer.opacity * 100));
    el.colorOpacityValue.textContent = `${Math.round(layer.opacity * 100)}%`;
    el.colorPopover.style.setProperty(
      "--symbol-picker-color",
      layer.color || "#18212F",
    );
    el.flipX.checked = layer.transform.flipHorizontal;
    el.flipY.checked = layer.transform.flipVertical;
  };

  const renderCanvas = () => {
    el.canvas.innerHTML = compositionSvg(state.layers, state.selectedId);
    el.canvas.classList.toggle("show-grid", el.snap.checked);
    el.canvas.classList.toggle("is-drawing", state.activeTool === "freehand");
    el.freehand.classList.toggle("active", state.activeTool === "freehand");
  };
  const scheduleCanvasRender = () => {
    if (state.renderFrame !== null) return;
    state.renderFrame = requestAnimationFrame(() => {
      state.renderFrame = null;
      renderCanvas();
      syncInspector();
    });
  };
  const render = () => {
    if (state.renderFrame !== null) {
      cancelAnimationFrame(state.renderFrame);
      state.renderFrame = null;
    }
    renderCanvas();
    el.layerList.replaceChildren(
      ...[...state.layers].reverse().map((layer) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `symbol-layer-row${layer.layerId === state.selectedId ? " active" : ""}`;
        button.dataset.layerId = layer.layerId;
        button.innerHTML = `<span aria-hidden="true">${layer.visible ? "●" : "○"}</span><strong>${escapeXml(layer.name)}</strong><small>层 ${layer.zIndex + 1}</small>`;
        return button;
      }),
    );
    syncInspector();
    el.undo.disabled = state.history.length === 0;
    el.redo.disabled = state.future.length === 0;
    el.duplicate.disabled = !selected();
    el.delete.disabled = !selected();
  };

  const addLayer = (layer) => {
    snapshot();
    state.layers.push(layer);
    state.selectedId = layer.layerId;
    render();
    message(`已添加“${layer.name}”，预览已更新`);
  };

  const renderCatalog = () => {
    const query = el.search.value.trim().toLowerCase();
    const symbols = BUILTIN_SYMBOLS.filter(
      (symbol) =>
        (!query && symbol.category === state.category) ||
        (query &&
          `${symbol.glyph} ${symbol.id} ${symbol.latex} ${symbol.category}`
            .toLowerCase()
            .includes(query)),
    );
    el.palette.replaceChildren(
      ...symbols.map((symbol) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.symbolId = symbol.id;
        button.title = `${symbol.latex} · ${symbol.category}`;
        button.setAttribute(
          "aria-label",
          `添加符号 ${symbol.glyph}，${symbol.latex}`,
        );
        const glyph = document.createElement("span");
        glyph.className = "symbol-result-glyph";
        glyph.textContent = symbol.glyph;
        const command = document.createElement("small");
        command.textContent = symbol.latex;
        button.append(glyph, command);
        button.addEventListener("click", () =>
          addLayer(symbolLayer(symbol, state.layers.length)),
        );
        return button;
      }),
    );
    el.palette.classList.toggle("is-searching", Boolean(query));
    el.palette.classList.toggle("has-results", symbols.length > 0);
    if (el.categoryStatus) {
      el.categoryStatus.textContent = query
        ? `搜索到 ${symbols.length} 个符号`
        : `${state.category} · ${symbols.length} 个符号`;
    }
  };

  let categoryDrag = null;
  let suppressCategoryClick = false;
  for (const [category] of SYMBOL_GROUPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.textContent = category;
    button.className = category === state.category ? "active" : "";
    button.setAttribute("aria-selected", String(category === state.category));
    button.addEventListener("click", () => {
      if (suppressCategoryClick) return;
      state.category = category;
      el.search.value = "";
      for (const item of el.categories.children) {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      }
      renderCatalog();
      button.scrollIntoView({ block: "nearest", inline: "center" });
    });
    el.categories.append(button);
  }
  el.search.addEventListener("input", renderCatalog);
  const scrollCategories = (direction) => {
    el.categories.scrollBy({
      left: direction * Math.max(110, el.categories.clientWidth * 0.72),
      behavior: "smooth",
    });
  };
  el.categoryPrev?.addEventListener("click", () => scrollCategories(-1));
  el.categoryNext?.addEventListener("click", () => scrollCategories(1));
  el.categories.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      el.categories.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
  el.categories.addEventListener("pointerdown", (event) => {
    categoryDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: el.categories.scrollLeft,
    };
    suppressCategoryClick = false;
  });
  el.categories.addEventListener("pointermove", (event) => {
    if (!categoryDrag || categoryDrag.pointerId !== event.pointerId) return;
    const distance = event.clientX - categoryDrag.startX;
    if (Math.abs(distance) > 4) {
      suppressCategoryClick = true;
      if (!el.categories.hasPointerCapture?.(event.pointerId)) {
        el.categories.setPointerCapture?.(event.pointerId);
      }
      el.categories.classList.add("is-dragging");
      el.categories.scrollLeft = categoryDrag.scrollLeft - distance;
    }
  });
  const endCategoryDrag = () => {
    if (!categoryDrag) return;
    categoryDrag = null;
    el.categories.classList.remove("is-dragging");
    setTimeout(() => {
      suppressCategoryClick = false;
    }, 0);
  };
  el.categories.addEventListener("pointerup", endCategoryDrag);
  el.categories.addEventListener("pointercancel", endCategoryDrag);
  renderCatalog();

  let formulaToken = 0;
  let formulaTimer;
  const renderFormula = async (add = false) => {
    const latex = el.formulaSource.value.trim();
    const token = ++formulaToken;
    if (!latex) {
      el.formulaPreview.textContent = "输入 LaTeX 后实时预览";
      el.formulaStatus.textContent = "请输入 LaTeX";
      return null;
    }
    if (!formulaRenderer) {
      el.formulaStatus.textContent = "MathJax 渲染服务不可用";
      return null;
    }
    el.formulaStatus.textContent = "正在本地渲染…";
    try {
      const result = await formulaRenderer.renderFormulaSvg(latex, {
        display: true,
        maxWidthPt: 360,
        maxHeightPt: 160,
      });
      if (token !== formulaToken) return null;
      el.formulaPreview.innerHTML = result.svg;
      el.formulaStatus.textContent = `预览完成 · ${Math.round(result.widthPt)} × ${Math.round(result.heightPt)} pt`;
      if (add)
        addLayer(
          formulaLayer(
            latex,
            result.svg,
            result.widthPt,
            result.heightPt,
            state.layers.length,
          ),
        );
      return result;
    } catch (error) {
      if (token !== formulaToken) return null;
      el.formulaPreview.textContent = "LaTeX 无法渲染";
      el.formulaStatus.textContent = error?.message || String(error);
      return null;
    }
  };
  el.formulaSource.addEventListener("input", () => {
    clearTimeout(formulaTimer);
    formulaTimer = setTimeout(() => renderFormula(false), 220);
  });
  el.formulaSource.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      renderFormula(true);
    }
  });
  el.formulaAdd.addEventListener("click", () => renderFormula(true));
  renderFormula(false);

  for (const button of el.primitiveButtons) {
    button.addEventListener("click", () =>
      addLayer(
        primitiveLayer(button.dataset.symbolPrimitive, state.layers.length),
      ),
    );
  }
  el.freehand.addEventListener("click", () => {
    state.activeTool = state.activeTool === "freehand" ? null : "freehand";
    render();
    message(
      state.activeTool
        ? "自由画笔已启用，在画布空白处拖动绘制"
        : "已退出自由画笔",
    );
  });

  el.layerList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-layer-id]");
    if (!row) return;
    state.selectedId = row.dataset.layerId;
    render();
  });
  const drawingSurface = () =>
    el.canvas.querySelector(":scope > svg") || el.canvas;
  const drawingBounds = () => {
    const surface = drawingSurface();
    const bounds = surface.getBoundingClientRect();
    return surface === el.canvas
      ? bounds
      : resolveComposerViewportBounds(bounds, surface.viewBox?.baseVal);
  };
  const canvasPoint = (event) =>
    projectComposerPoint(event.clientX, event.clientY, drawingBounds());
  el.canvas.addEventListener("pointerdown", (event) => {
    const layerNode = event.target.closest("[data-layer-id]");
    const transformHandle = event.target.closest("[data-symbol-handle]");
    if (!layerNode && state.activeTool === "freehand") {
      const point = canvasPoint(event);
      snapshot();
      const local = { x: point.x - 500, y: point.y - 500 };
      const layer = {
        layerId: uid("freehand"),
        name: "自由路径",
        source: {
          kind: "primitive",
          primitive: pathPrimitive(
            `M${local.x.toFixed(1)},${local.y.toFixed(1)}`,
            [local.x - 1, local.y - 1, local.x + 1, local.y + 1],
          ),
        },
        transform: defaultTransform(),
        opacity: 1,
        color: "#18212F",
        zIndex: state.layers.length,
        visible: true,
      };
      state.layers.push(layer);
      state.selectedId = layer.layerId;
      state.drag = {
        kind: "freehand",
        pointerId: event.pointerId,
        points: [local],
        minX: local.x,
        minY: local.y,
        maxX: local.x,
        maxY: local.y,
        drawFrame: null,
      };
      el.canvas.setPointerCapture?.(event.pointerId);
      render();
      return;
    }
    if (!layerNode) {
      state.selectedId = null;
      render();
      return;
    }
    state.selectedId = layerNode.dataset.layerId;
    snapshot();
    const layer = selected();
    const box = drawingBounds();
    const centerX = box.left + (layer.transform.translateX * box.width) / 1000;
    const centerY = box.top + (layer.transform.translateY * box.height) / 1000;
    const pointerDx = event.clientX - centerX;
    const pointerDy = event.clientY - centerY;
    state.drag = {
      kind: transformHandle?.dataset.symbolHandle || "move",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: layer.transform.translateX,
      y: layer.transform.translateY,
      scaleX: layer.transform.scaleX,
      scaleY: layer.transform.scaleY,
      rotation: layer.transform.rotationDegrees,
      startDistance: Math.max(1, Math.hypot(pointerDx, pointerDy)),
      startAngle: Math.atan2(pointerDy, pointerDx),
      rotationRadians: (layer.transform.rotationDegrees * Math.PI) / 180,
      localStartX:
        pointerDx *
          Math.cos((-layer.transform.rotationDegrees * Math.PI) / 180) -
        pointerDy *
          Math.sin((-layer.transform.rotationDegrees * Math.PI) / 180),
      localStartY:
        pointerDx *
          Math.sin((-layer.transform.rotationDegrees * Math.PI) / 180) +
        pointerDy *
          Math.cos((-layer.transform.rotationDegrees * Math.PI) / 180),
      centerX,
      centerY,
    };
    el.canvas.setPointerCapture?.(event.pointerId);
    render();
  });
  const flushFreehand = () => {
    if (state.drag?.kind !== "freehand") return;
    state.drag.drawFrame = null;
    const layer = selected();
    if (!layer) return;
    const primitive = layer.source.primitive;
    primitive.pathData = buildSmoothFreehandPath(state.drag.points);
    primitive.bounds = {
      minX: state.drag.minX - 10,
      minY: state.drag.minY - 10,
      maxX: state.drag.maxX + 10,
      maxY: state.drag.maxY + 10,
    };
    el.canvas
      .querySelector(`[data-layer-id="${layer.layerId}"] > path`)
      ?.setAttribute("d", primitive.pathData);
  };
  el.canvas.addEventListener("pointermove", (event) => {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    if (
      !pointerInsideViewport(
        event.clientX,
        event.clientY,
        window.innerWidth,
        window.innerHeight,
      )
    )
      return;
    const layer = selected();
    if (state.drag.kind === "freehand") {
      for (const sample of coalescedPointerSamples(event)) {
        const point = canvasPoint(sample);
        const local = { x: point.x - 500, y: point.y - 500 };
        const previous = state.drag.points.at(-1);
        if (Math.hypot(local.x - previous.x, local.y - previous.y) < 2)
          continue;
        state.drag.points.push(local);
        state.drag.minX = Math.min(state.drag.minX, local.x);
        state.drag.minY = Math.min(state.drag.minY, local.y);
        state.drag.maxX = Math.max(state.drag.maxX, local.x);
        state.drag.maxY = Math.max(state.drag.maxY, local.y);
      }
      if (state.drag.drawFrame === null)
        state.drag.drawFrame = requestAnimationFrame(flushFreehand);
      return;
    }
    if (
      state.drag.kind === "scale" ||
      state.drag.kind === "scale-x" ||
      state.drag.kind === "scale-y"
    ) {
      const pointerX = event.clientX - state.drag.centerX;
      const pointerY = event.clientY - state.drag.centerY;
      const inverseRotation = -state.drag.rotationRadians;
      const localX =
        pointerX * Math.cos(inverseRotation) -
        pointerY * Math.sin(inverseRotation);
      const localY =
        pointerX * Math.sin(inverseRotation) +
        pointerY * Math.cos(inverseRotation);
      const ratioX = Math.max(
        0.05,
        Math.min(
          20,
          Math.abs(localX) / Math.max(1, Math.abs(state.drag.localStartX)),
        ),
      );
      const ratioY = Math.max(
        0.05,
        Math.min(
          20,
          Math.abs(localY) / Math.max(1, Math.abs(state.drag.localStartY)),
        ),
      );
      const distance = Math.hypot(
        event.clientX - state.drag.centerX,
        event.clientY - state.drag.centerY,
      );
      const ratio = Math.max(
        0.05,
        Math.min(20, distance / state.drag.startDistance),
      );
      if (state.drag.kind !== "scale-y") {
        layer.transform.scaleX = Math.max(
          0.05,
          Math.min(20, state.drag.scaleX * (event.shiftKey ? ratio : ratioX)),
        );
      }
      if (state.drag.kind !== "scale-x") {
        layer.transform.scaleY = Math.max(
          0.05,
          Math.min(20, state.drag.scaleY * (event.shiftKey ? ratio : ratioY)),
        );
      }
      scheduleCanvasRender();
      return;
    }
    if (state.drag.kind === "rotate") {
      const angle = Math.atan2(
        event.clientY - state.drag.centerY,
        event.clientX - state.drag.centerX,
      );
      layer.transform.rotationDegrees = rotationFromPointer(
        state.drag.rotation,
        state.drag.startAngle,
        angle,
        event.shiftKey,
      );
      scheduleCanvasRender();
      return;
    }
    const box = drawingBounds();
    let x =
      state.drag.x + ((event.clientX - state.drag.startX) * 1000) / box.width;
    let y =
      state.drag.y + ((event.clientY - state.drag.startY) * 1000) / box.height;
    if (el.snap.checked) {
      x = Math.round(x / 25) * 25;
      y = Math.round(y / 25) * 25;
    }
    layer.transform.translateX = x;
    layer.transform.translateY = y;
    scheduleCanvasRender();
  });
  const endDrag = () => {
    if (!state.drag) return;
    if (state.drag.kind === "freehand") {
      if (state.drag.drawFrame !== null)
        cancelAnimationFrame(state.drag.drawFrame);
      flushFreehand();
    }
    const messages = {
      freehand: "自由路径已添加",
      move: "图层位置已更新",
      scale: "图层尺寸已更新",
      "scale-x": "图层宽度已更新",
      "scale-y": "图层高度已更新",
      rotate: "图层角度已更新",
    };
    message(messages[state.drag.kind] || "图层已更新");
    state.drag = null;
    render();
  };
  el.canvas.addEventListener("pointerup", endDrag);
  el.canvas.addEventListener("pointercancel", endDrag);
  el.canvas.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.selectedId) return;
    event.preventDefault();
    state.selectedId = null;
    render();
    message("已取消图层选择");
  });

  const updateSelected = (mutate) => {
    const layer = selected();
    if (!layer) return;
    snapshot();
    mutate(layer);
    render();
    message("图层属性已更新");
  };
  for (const [input, mutate] of [
    [
      el.x,
      (layer) => {
        layer.transform.translateX = Number(el.x.value);
      },
    ],
    [
      el.y,
      (layer) => {
        layer.transform.translateY = Number(el.y.value);
      },
    ],
    [
      el.scaleX,
      (layer) => {
        const value = Math.max(0.05, Math.min(20, Number(el.scaleX.value)));
        layer.transform.scaleX = value;
      },
    ],
    [
      el.scaleY,
      (layer) => {
        const value = Math.max(0.05, Math.min(20, Number(el.scaleY.value)));
        layer.transform.scaleY = value;
      },
    ],
    [
      el.rotation,
      (layer) => {
        layer.transform.rotationDegrees = Number(el.rotation.value);
      },
    ],
    [
      el.opacity,
      (layer) => {
        layer.opacity = Number(el.opacity.value);
      },
    ],
    [
      el.flipX,
      (layer) => {
        layer.transform.flipHorizontal = el.flipX.checked;
      },
    ],
    [
      el.flipY,
      (layer) => {
        layer.transform.flipVertical = el.flipY.checked;
      },
    ],
  ])
    input.addEventListener("change", () => updateSelected(mutate));
  el.color.addEventListener("change", () => {
    const value = normalizeHexColor(el.color.value, "");
    if (!/^#[0-9A-F]{6}$/.test(value)) {
      syncInspector();
      message("颜色格式无效，请输入 #RRGGBB");
      return;
    }
    updateSelected((layer) => {
      layer.color = value;
    });
  });

  const closeColorPicker = () => {
    el.colorPopover.hidden = true;
    el.colorSwatch.setAttribute("aria-expanded", "false");
    state.colorEditActive = false;
  };
  const openColorPicker = () => {
    if (!selected()) return;
    el.colorPopover.hidden = false;
    el.colorSwatch.setAttribute("aria-expanded", "true");
    syncInspector();
  };
  const applyPickerValue = ({ color, opacity } = {}) => {
    const layer = selected();
    if (!layer) return;
    if (!state.colorEditActive) {
      snapshot();
      state.colorEditActive = true;
    }
    if (color) layer.color = normalizeHexColor(color, layer.color);
    if (opacity !== undefined)
      layer.opacity = Math.max(0, Math.min(1, Number(opacity)));
    scheduleCanvasRender();
    syncInspector();
    message(opacity === undefined ? "图层颜色已更新" : "图层透明度已更新");
  };
  const updateSpectrum = (event) => {
    const hsv = hexToHsv(selected()?.color);
    const point = spectrumPointInside(
      event.clientX,
      event.clientY,
      el.colorSpectrum.getBoundingClientRect(),
    );
    if (!point) return;
    applyPickerValue({
      color: hsvToHex({
        hue: Number(el.colorHue.value) || hsv.hue,
        ...point,
      }),
    });
  };
  let spectrumPointer = null;
  el.colorSwatch.addEventListener("click", () => {
    if (el.colorPopover.hidden) openColorPicker();
    else closeColorPicker();
  });
  el.colorSpectrum.addEventListener("pointerdown", (event) => {
    spectrumPointer = event.pointerId;
    el.colorSpectrum.setPointerCapture?.(event.pointerId);
    updateSpectrum(event);
  });
  el.colorSpectrum.addEventListener("pointermove", (event) => {
    if (spectrumPointer !== event.pointerId) return;
    updateSpectrum(event);
  });
  el.colorSpectrum.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const hsv = hexToHsv(selected()?.color);
    const step = event.shiftKey ? 0.1 : 0.02;
    if (event.key === "ArrowLeft") hsv.saturation -= step;
    if (event.key === "ArrowRight") hsv.saturation += step;
    if (event.key === "ArrowUp") hsv.value += step;
    if (event.key === "ArrowDown") hsv.value -= step;
    applyPickerValue({ color: hsvToHex(hsv) });
  });
  const endSpectrum = () => {
    spectrumPointer = null;
  };
  el.colorSpectrum.addEventListener("pointerup", endSpectrum);
  el.colorSpectrum.addEventListener("pointercancel", endSpectrum);
  el.colorHue.addEventListener("input", () => {
    const hsv = hexToHsv(selected()?.color);
    applyPickerValue({
      color: hsvToHex({ ...hsv, hue: Number(el.colorHue.value) }),
    });
  });
  el.colorOpacity.addEventListener("input", () => {
    applyPickerValue({ opacity: Number(el.colorOpacity.value) / 100 });
  });
  for (const preset of el.colorPresets) {
    preset.style.setProperty("--preset-color", preset.dataset.symbolColor);
    preset.addEventListener("click", () =>
      applyPickerValue({ color: preset.dataset.symbolColor }),
    );
  }
  root.addEventListener("pointerdown", (event) => {
    if (el.colorPopover.hidden || event.target.closest(".symbol-color-field"))
      return;
    closeColorPicker();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.colorPopover.hidden) closeColorPicker();
  });

  el.undo.addEventListener("click", () => {
    if (!state.history.length) return;
    state.future.push(clone(state.layers));
    state.layers = state.history.pop();
    if (!selected()) state.selectedId = state.layers.at(-1)?.layerId || null;
    render();
    message("已撤销");
  });
  el.redo.addEventListener("click", () => {
    if (!state.future.length) return;
    state.history.push(clone(state.layers));
    state.layers = state.future.pop();
    if (!selected()) state.selectedId = state.layers.at(-1)?.layerId || null;
    render();
    message("已重做");
  });
  el.delete.addEventListener("click", () =>
    updateSelected((layer) => {
      state.layers = state.layers.filter(
        (candidate) => candidate.layerId !== layer.layerId,
      );
      state.layers.forEach((candidate, index) => {
        candidate.zIndex = index;
      });
      state.selectedId = state.layers.at(-1)?.layerId || null;
    }),
  );
  el.duplicate.addEventListener("click", () => {
    const layer = selected();
    if (!layer) return;
    const copy = clone(layer);
    copy.layerId = uid("copy");
    copy.name = `${copy.name} 副本`;
    copy.transform.translateX += 25;
    copy.transform.translateY += 25;
    copy.zIndex = state.layers.length;
    addLayer(copy);
  });
  for (const button of el.actionButtons) {
    button.addEventListener("click", () =>
      updateSelected((layer) => {
        const action = button.dataset.symbolAction;
        if (action === "align-x") layer.transform.translateX = 500;
        if (action === "align-y") layer.transform.translateY = 500;
        if (action === "forward" || action === "backward") {
          const index = state.layers.indexOf(layer);
          const target = Math.max(
            0,
            Math.min(
              state.layers.length - 1,
              index + (action === "forward" ? 1 : -1),
            ),
          );
          state.layers.splice(index, 1);
          state.layers.splice(target, 0, layer);
          state.layers.forEach((item, itemIndex) => {
            item.zIndex = itemIndex;
          });
        }
      }),
    );
  }
  el.snap.addEventListener("change", render);

  const buildRequest = () => {
    if (!state.layers.length) throw new Error("请至少添加一个符号或图元");
    return buildCustomSymbolRequest({
      name: el.name.value,
      latexCommand: el.latex.value,
      mathClass: el.mathClass.value,
      layers: state.layers,
      snapToGrid: el.snap.checked,
    });
  };
  const validate = async () =>
    invoke("build_custom_symbol_bundle", { request: buildRequest() });
  el.copy.addEventListener("click", async () => {
    el.copy.disabled = true;
    message("正在由 Core 验证几何与安全 SVG…");
    try {
      const result = await validate();
      const report = await invoke("copy_symbol_bundle", {
        request: { bundle: result.bundle },
      });
      message(
        `验证通过，已写入 ${report.writtenFormats.length} 种系统剪贴板格式`,
      );
      notify("自定义符号已验证并复制");
    } catch (error) {
      message(`验证失败：${error?.message || error}`);
    } finally {
      el.copy.disabled = false;
    }
  });
  el.save.addEventListener("click", async () => {
    el.save.disabled = true;
    message("正在验证并保存…");
    try {
      const result = await validate();
      const library = JSON.parse(
        localStorage.getItem("latexsnipper.custom-symbols.v1") || "[]",
      );
      const next = [
        result.bundle,
        ...library.filter(
          (item) => item?.symbol?.id !== result.bundle.symbol.id,
        ),
      ].slice(0, 256);
      localStorage.setItem(
        "latexsnipper.custom-symbols.v1",
        JSON.stringify(next),
      );
      message(`已保存“${result.bundle.symbol.name}”到本地符号库`);
      notify("已保存到自定义符号库");
    } catch (error) {
      message(`保存失败：${error?.message || error}`);
    } finally {
      el.save.disabled = false;
    }
  });

  render();
  return { state, addLayer, render, buildRequest, renderFormula };
}
