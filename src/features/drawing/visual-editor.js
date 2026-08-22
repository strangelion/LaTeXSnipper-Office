import { evaluatePlotExpression } from "./math-expression.js";

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 520;

const escapeXml = (value) =>
  String(value).replace(
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

const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `drawing-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const COLOR_PRESETS = ["#2563EB", "#7C3AED", "#DC2626", "#059669", "#D97706"];
const NODE_TYPES = new Set(["node", "rectangle", "ellipse", "diamond"]);
const EDGE_TYPES = new Set(["line", "arrow", "connector"]);

const clamp = (value, min, max) => {
  const numeric = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : min));
};

export { evaluatePlotExpression } from "./math-expression.js";

function createObject(type, index) {
  const offset = (index % 5) * 22;
  const base = {
    id: uid(),
    type,
    x: 330 + offset,
    y: 240 + offset,
    width: 210,
    height: 120,
    rotation: 0,
    color: "#2563EB",
    fill: "#EFF6FF",
    strokeWidth: ["line", "arrow", "connector", "plot"].includes(type) ? 5 : 4,
    text:
      type === "label"
        ? "标注"
        : type === "diamond"
          ? "判断"
          : type === "node"
            ? "节点"
            : "",
  };
  if (["line", "arrow", "connector"].includes(type)) base.height = 36;
  if (type === "axes") {
    base.width = 300;
    base.height = 220;
  }
  if (type === "plot") {
    base.width = 300;
    base.height = 160;
  }
  if (type === "label") {
    base.width = 170;
    base.height = 70;
  }
  return base;
}

const boundaryDistance = (object, unitX, unitY) => {
  const halfWidth = Math.max(1, Number(object.width) / 2);
  const halfHeight = Math.max(1, Number(object.height) / 2);
  if (object.type === "ellipse") {
    return 1 / Math.sqrt((unitX / halfWidth) ** 2 + (unitY / halfHeight) ** 2);
  }
  if (object.type === "diamond") {
    return 1 / (Math.abs(unitX) / halfWidth + Math.abs(unitY) / halfHeight);
  }
  return Math.min(
    Math.abs(unitX) > 0.0001 ? halfWidth / Math.abs(unitX) : Infinity,
    Math.abs(unitY) > 0.0001 ? halfHeight / Math.abs(unitY) : Infinity,
  );
};

function resolvedEdgeObject(edge, objects) {
  if (!EDGE_TYPES.has(edge.type) || !edge.fromId || !edge.toId) return edge;
  const from = objects.find((object) => object.id === edge.fromId);
  const to = objects.find((object) => object.id === edge.toId);
  if (!from || !to || from.id === to.id) return edge;
  const dx = Number(to.x) - Number(from.x);
  const dy = Number(to.y) - Number(from.y);
  const distance = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / distance;
  const unitY = dy / distance;
  const fromRadius = boundaryDistance(from, unitX, unitY);
  const toRadius = boundaryDistance(to, -unitX, -unitY);
  const startX = Number(from.x) + unitX * fromRadius;
  const startY = Number(from.y) + unitY * fromRadius;
  const endX = Number(to.x) - unitX * toRadius;
  const endY = Number(to.y) - unitY * toRadius;
  return {
    ...edge,
    x: (startX + endX) / 2,
    y: (startY + endY) / 2,
    width: Math.max(1, Math.hypot(endX - startX, endY - startY)),
    rotation: (Math.atan2(endY - startY, endX - startX) * 180) / Math.PI,
  };
}

export function materializeVisualObjects(objects) {
  return (objects || []).map((object) => resolvedEdgeObject(object, objects));
}

function bindNearestEdges(objects) {
  const nodes = objects.filter((object) => NODE_TYPES.has(object.type));
  if (nodes.length < 2) return objects;
  for (const edge of objects.filter((object) => EDGE_TYPES.has(object.type))) {
    if (edge.fromId && edge.toId) continue;
    const angle = (Number(edge.rotation || 0) * Math.PI) / 180;
    const dx = (Number(edge.width || 100) / 2) * Math.cos(angle);
    const dy = (Number(edge.width || 100) / 2) * Math.sin(angle);
    const nearest = (x, y, excludedId) =>
      nodes
        .filter((node) => node.id !== excludedId)
        .map((node) => ({
          node,
          distance: Math.hypot(Number(node.x) - x, Number(node.y) - y),
        }))
        .sort((left, right) => left.distance - right.distance)[0]?.node;
    const from = nearest(Number(edge.x) - dx, Number(edge.y) - dy);
    const to = nearest(Number(edge.x) + dx, Number(edge.y) + dy, from?.id);
    if (from && to) {
      edge.fromId = from.id;
      edge.toId = to.id;
    }
  }
  return objects;
}

function embeddedSvgParts(svg) {
  const source = String(svg || "").trim();
  if (
    !/^<svg[\s>]/i.test(source) ||
    /<(?:script|foreignObject|iframe|object|embed)\b/i.test(source)
  ) {
    return null;
  }
  const opening = source.match(/^<svg\b([^>]*)>/i);
  const viewBox = opening?.[1]?.match(
    /\bviewBox=["']\s*([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)\s*["']/i,
  );
  const values = viewBox?.slice(1).map(Number);
  if (!values?.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
    return null;
  }
  return {
    minX: values[0],
    minY: values[1],
    width: values[2],
    height: values[3],
    body: source.replace(/^<svg\b[^>]*>/i, "").replace(/<\/svg>\s*$/i, ""),
  };
}

const PROFILE_COLORS = Object.freeze({
  svg_source: ["#2563EB", "#7C3AED", "#059669"],
  tikz: ["#0F766E", "#0369A1", "#B45309"],
  pgf_plots: ["#7C3AED", "#DB2777", "#0891B2"],
  graphviz_dot: ["#1D4ED8", "#475569", "#0F766E"],
  mermaid: ["#2563EB", "#9333EA", "#EA580C"],
});

function planObjects(plan, profile) {
  const colors = PROFILE_COLORS[profile] || PROFILE_COLORS.svg_source;
  return bindNearestEdges(
    plan.map(([type, x, y, text, extra], index) => ({
      ...createObject(type, index),
      x,
      y,
      ...(text ? { text } : {}),
      ...(extra || {}),
      color: colors[index % colors.length],
      profile,
    })),
  );
}

export function createProfileDocument(
  profile,
  template = "default",
  options = {},
) {
  const definitions = {
    svg_source: {
      default: [
        ["node", 290, 230, "图形"],
        ["arrow", 515, 230],
      ],
      blank: [],
      icon: [
        ["ellipse", 400, 260],
        ["diamond", 400, 260],
        ["label", 400, 260, "A"],
      ],
      illustration: [
        ["rectangle", 400, 290],
        ["ellipse", 290, 210],
        ["ellipse", 510, 210],
        ["connector", 400, 380],
      ],
    },
    tikz: {
      default: [
        ["axes", 370, 275],
        ["arrow", 480, 205],
        ["label", 590, 145, "v"],
      ],
      geometry: [
        ["ellipse", 300, 270],
        ["rectangle", 510, 270],
        ["line", 405, 270],
        ["label", 405, 155, "angle ABC"],
      ],
      vectors: [
        ["axes", 365, 275],
        ["arrow", 455, 215],
        ["arrow", 310, 175],
        ["label", 585, 150, "v"],
      ],
      commutative: [
        ["node", 220, 160, "A"],
        ["node", 580, 160, "B"],
        ["node", 220, 380, "C"],
        ["node", 580, 380, "D"],
        ["arrow", 400, 160],
        ["arrow", 400, 380],
      ],
    },
    pgf_plots: {
      default: [
        [
          "axes",
          385,
          270,
          null,
          {
            xLabel: "x",
            yLabel: "f(x)",
            yMin: -1.5,
            yMax: 1.5,
            grid: "major",
            legendPosition: "north east",
          },
        ],
        [
          "plot",
          385,
          260,
          null,
          {
            curve: "sin",
            expression: "sin(x)",
            legend: "sin(x)",
            samples: 120,
            lineStyle: "solid",
          },
        ],
        ["label", 600, 105, "f(x)"],
      ],
      plot: [
        [
          "axes",
          385,
          270,
          null,
          {
            xLabel: options.xLabel || "x",
            yLabel: options.yLabel || "f(x)",
            yMin: Number(options.yMin ?? -1.5),
            yMax: Number(options.yMax ?? 1.5),
            grid: options.grid || "major",
            legendPosition: options.legendPosition || "north east",
          },
        ],
        [
          "plot",
          385,
          260,
          null,
          {
            curve: options.curve || "sin",
            expression: options.expression || "sin(x)",
            legend: options.legend || options.expression || "sin(x)",
            xMin: Number(options.xMin ?? -6.28),
            xMax: Number(options.xMax ?? 6.28),
            samples: Number(options.samples ?? 120),
            lineStyle: options.lineStyle || "solid",
          },
        ],
        ["label", 610, 105, options.expression || options.curve || "f(x)"],
      ],
    },
    graphviz_dot: {
      default: [
        ["node", 190, 260, "输入"],
        ["node", 405, 260, "处理"],
        ["node", 620, 260, "输出"],
        ["arrow", 298, 260],
        ["arrow", 512, 260],
      ],
      hierarchy: [
        ["node", 400, 110, "根"],
        ["node", 235, 350, "分支 A"],
        ["node", 565, 350, "分支 B"],
        ["connector", 315, 230],
        ["connector", 485, 230],
      ],
      network: [
        ["ellipse", 400, 260, "中心"],
        ["node", 170, 130, "A"],
        ["node", 630, 130, "B"],
        ["node", 170, 390, "C"],
        ["node", 630, 390, "D"],
      ],
      cycle: [
        ["node", 400, 95, "A"],
        ["node", 620, 330, "B"],
        ["node", 180, 330, "C"],
        ["connector", 510, 205],
        ["connector", 400, 350],
        ["connector", 290, 205],
      ],
    },
    mermaid: {
      default: [
        ["node", 185, 260, "开始"],
        ["diamond", 400, 260, "判断"],
        ["node", 625, 260, "结束"],
        ["arrow", 292, 260],
        ["arrow", 512, 260],
      ],
      flow: [
        ["node", 180, 260, "输入"],
        ["diamond", 400, 260, "通过？"],
        ["node", 620, 155, "发布"],
        ["node", 620, 365, "修复"],
        ["connector", 515, 205],
        ["connector", 515, 315],
      ],
      sequence: [
        ["node", 180, 100, "用户"],
        ["node", 400, 100, "应用"],
        ["node", 620, 100, "Office"],
        ["arrow", 290, 235, null, { width: 190 }],
        ["arrow", 510, 330, null, { width: 190 }],
      ],
      state: [
        ["ellipse", 180, 260, "空闲"],
        ["node", 400, 260, "处理中"],
        ["ellipse", 620, 260, "完成"],
        ["arrow", 290, 260],
        ["arrow", 510, 260],
      ],
      mindmap: [
        [
          "ellipse",
          400,
          260,
          options.root || "主题",
          { width: 230, height: 110 },
        ],
        ["node", 165, 135, "分支 A", { width: 175, height: 86 }],
        ["node", 635, 135, "分支 B", { width: 175, height: 86 }],
        ["node", 165, 390, "分支 C", { width: 175, height: 86 }],
        ["node", 635, 390, "分支 D", { width: 175, height: 86 }],
        [
          "connector",
          285,
          195,
          null,
          { width: 155, height: 42, rotation: -152 },
        ],
        [
          "connector",
          515,
          195,
          null,
          { width: 155, height: 42, rotation: -28 },
        ],
        [
          "connector",
          285,
          325,
          null,
          { width: 155, height: 42, rotation: 151 },
        ],
        ["connector", 515, 325, null, { width: 155, height: 42, rotation: 29 }],
      ],
    },
  };
  const profileDefinitions = definitions[profile] || definitions.svg_source;
  return planObjects(
    profileDefinitions[template] || profileDefinitions.default,
    profile,
  );
}

function objectBody(object, objects = []) {
  const width = object.width;
  const height = object.height;
  const x = -width / 2;
  const y = -height / 2;
  const stroke = clamp(object.strokeWidth, 1, 24);
  const vectorStroke = ' vector-effect="non-scaling-stroke"';
  const profileFill =
    object.profile === "tikz"
      ? "#FFFFFF"
      : object.profile === "graphviz_dot"
        ? "#F8FAFC"
        : object.profile === "mermaid"
          ? "#EEF2FF"
          : object.fill;
  const labelColor = object.profile === "mermaid" ? "#312E81" : "#172033";
  const label = (fontSize = 30) =>
    object.text
      ? `<text x="0" y="${Math.round(fontSize * 0.34)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${fontSize}" fill="${labelColor}">${escapeXml(object.text)}</text>`
      : "";
  switch (object.type) {
    case "line":
      return `<path d="M${x} 0H${width / 2}" fill="none" stroke="${object.color}" stroke-width="${stroke}" stroke-linecap="round"${vectorStroke}/>`;
    case "arrow":
    case "connector":
      return `<path d="${
        object.type === "connector"
          ? `M${x} 0C${-width / 4} ${-height},${width / 4} ${height},${width / 2} 0`
          : `M${x} 0H${width / 2}`
      }" fill="none" stroke="${object.color}" stroke-width="${stroke}" stroke-linecap="round" marker-end="url(#drawing-arrow)"${vectorStroke}/>${object.text ? `<text x="0" y="-14" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="22" fill="${object.color}">${escapeXml(object.text)}</text>` : ""}`;
    case "ellipse":
      return `<ellipse rx="${width / 2}" ry="${height / 2}" fill="${profileFill}" stroke="${object.color}" stroke-width="${stroke}"${vectorStroke}/>${label()}`;
    case "diamond":
      return `<path d="M0 ${y}L${width / 2} 0L0 ${height / 2}L${x} 0Z" fill="${profileFill}" stroke="${object.color}" stroke-width="${stroke}" stroke-linejoin="round"${vectorStroke}/>${label(28)}`;
    case "label":
      return `<text x="0" y="12" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="42" fill="${object.color}">${escapeXml(object.text)}</text>`;
    case "formula": {
      const formula = embeddedSvgParts(object.formulaSvg);
      if (!formula) {
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#FFF7ED" stroke="#EA580C" stroke-width="${stroke}"/><text x="0" y="10" text-anchor="middle" font-size="24" fill="#9A3412">${escapeXml(object.text || "公式")}</text>`;
      }
      const scale = Math.min(width / formula.width, height / formula.height);
      const renderWidth = formula.width * scale;
      const renderHeight = formula.height * scale;
      const tx = -renderWidth / 2 - formula.minX * scale;
      const ty = -renderHeight / 2 - formula.minY * scale;
      return `<g transform="translate(${tx} ${ty}) scale(${scale})">${formula.body}</g>`;
    }
    case "axes":
      return `<path d="M${x} 0H${width / 2}M0 ${height / 2}V${y}" fill="none" stroke="${object.color}" stroke-width="${stroke}" marker-end="url(#drawing-arrow)"${vectorStroke}/><text x="${width / 2 - 18}" y="-14" font-size="30" fill="${object.color}">x</text><text x="16" y="${y + 28}" font-size="30" fill="${object.color}">y</text>`;
    case "plot": {
      const axes = objects.find((candidate) => candidate.type === "axes") || {};
      const xMin = Number.isFinite(Number(object.xMin))
        ? Number(object.xMin)
        : -6.28;
      const xMax = Number.isFinite(Number(object.xMax))
        ? Number(object.xMax)
        : 6.28;
      let samples = [];
      try {
        samples = Array.from({ length: 81 }, (_, index) => {
          const ratio = index / 80;
          const input = xMin + (xMax - xMin) * ratio;
          return {
            input,
            value: evaluatePlotExpression(object.expression || "sin(x)", input),
          };
        }).filter((sample) => Number.isFinite(sample.value));
      } catch {
        samples = [];
      }
      const sampleValues = samples.map((sample) => sample.value);
      const rawValues = (object.dataPoints || [])
        .map((point) => Number(point.y))
        .filter(Number.isFinite);
      const automaticMin = Math.min(...sampleValues, ...rawValues, -1);
      const automaticMax = Math.max(...sampleValues, ...rawValues, 1);
      const yMin = Number.isFinite(Number(axes.yMin))
        ? Number(axes.yMin)
        : automaticMin;
      const yMax = Number.isFinite(Number(axes.yMax))
        ? Number(axes.yMax)
        : automaticMax;
      const ySpan = Math.max(1e-8, yMax - yMin);
      const pointPosition = (input, value) => ({
        x: x + ((input - xMin) / Math.max(1e-8, xMax - xMin)) * width,
        y: y + height - ((value - yMin) / ySpan) * height,
      });
      const points = samples
        .map((sample) => pointPosition(sample.input, sample.value))
        .filter(
          (point) =>
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.y >= y - height * 2 &&
            point.y <= y + height * 3,
        )
        .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(" ");
      const rawPoints = (object.dataPoints || [])
        .map((point) => pointPosition(Number(point.x), Number(point.y)))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map(
          (point) =>
            `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6" fill="${object.color}" stroke="#FFFFFF" stroke-width="2"/>`,
        )
        .join("");
      const rangeLabels =
        Number.isFinite(xMin) && Number.isFinite(xMax)
          ? `<text x="${x}" y="${height / 2 - 6}" font-size="18" fill="${object.color}">${escapeXml(xMin)}</text><text x="${width / 2}" y="${height / 2 - 6}" text-anchor="end" font-size="18" fill="${object.color}">${escapeXml(xMax)}</text>`
          : "";
      const dash =
        object.lineStyle === "dashed"
          ? ' stroke-dasharray="18 12"'
          : object.lineStyle === "dotted"
            ? ' stroke-dasharray="3 10"'
            : object.lineStyle === "dashdotted"
              ? ' stroke-dasharray="18 8 3 8"'
              : "";
      const curve = points
        ? `<polyline points="${points}" fill="none" stroke="${object.color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"${dash}${vectorStroke}/>`
        : `<text x="0" y="8" text-anchor="middle" font-size="20" fill="#DC2626">表达式仅在安全预览中显示</text>`;
      return `${curve}${rawPoints}${rangeLabels}`;
    }
    case "node":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${object.profile === "graphviz_dot" ? 8 : object.profile === "tikz" ? 3 : 24}" fill="${profileFill}" stroke="${object.color}" stroke-width="${stroke}"${vectorStroke}/>${label(36)}`;
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${object.profile === "tikz" ? 2 : 10}" fill="${profileFill}" stroke="${object.color}" stroke-width="${stroke}"${vectorStroke}/>${label()}`;
  }
}

function connectionPorts(object, visible) {
  if (!visible || !NODE_TYPES.has(object.type)) return "";
  const halfWidth = Number(object.width) / 2 + 42;
  const halfHeight = Number(object.height) / 2 + 42;
  return `<g class="drawing-connection-ports" aria-hidden="true">
    <circle class="drawing-connection-port" data-drawing-port="top" cx="0" cy="${-halfHeight}" r="11"/>
    <circle class="drawing-connection-port" data-drawing-port="right" cx="${halfWidth}" cy="0" r="11"/>
    <circle class="drawing-connection-port" data-drawing-port="bottom" cx="0" cy="${halfHeight}" r="11"/>
    <circle class="drawing-connection-port" data-drawing-port="left" cx="${-halfWidth}" cy="0" r="11"/>
  </g>`;
}

export function visualTransformCapabilities(object) {
  if (
    !object ||
    (EDGE_TYPES.has(object.type) && object.fromId && object.toId)
  ) {
    return { move: false, resize: false, rotate: false };
  }
  if (object.profile === "mermaid") {
    return { move: false, resize: false, rotate: false };
  }
  if (object.profile === "pgf_plots") {
    return {
      move: object.type === "label",
      resize: false,
      rotate: false,
    };
  }
  if (object.profile === "graphviz_dot") {
    return { move: true, resize: true, rotate: false };
  }
  return { move: true, resize: true, rotate: true };
}

function objectMarkup(
  originalObject,
  selected = false,
  objects = [],
  connectionMode = false,
) {
  const object = resolvedEdgeObject(originalObject, objects);
  const capabilities = visualTransformCapabilities(object);
  const left = -object.width / 2 - 18;
  const right = object.width / 2 + 18;
  const top = -object.height / 2 - 18;
  const bottom = object.height / 2 + 18;
  const controls = selected
    ? `<g class="drawing-object-controls" aria-hidden="true">
        <rect class="drawing-selection-frame" x="${left}" y="${top}" width="${object.width + 36}" height="${object.height + 36}" rx="10"/>
        ${
          !capabilities.resize && !capabilities.rotate
            ? ""
            : `${
                capabilities.rotate
                  ? `<line class="drawing-rotate-stem" x1="0" y1="${top}" x2="0" y2="${top - 64}"/>
        <circle class="drawing-transform-handle drawing-rotate-handle" data-drawing-handle="rotate" cx="0" cy="${top - 64}" r="14"/>
        `
                  : ""
              }${
                capabilities.resize
                  ? `
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${left}" cy="${top}" r="13"/>
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${right}" cy="${top}" r="13"/>
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${right}" cy="${bottom}" r="13"/>
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${left}" cy="${bottom}" r="13"/>
        <rect class="drawing-transform-handle drawing-horizontal-handle" data-drawing-handle="scale-x" x="${left - 11}" y="-17" width="22" height="34" rx="6"/>
        <rect class="drawing-transform-handle drawing-horizontal-handle" data-drawing-handle="scale-x" x="${right - 11}" y="-17" width="22" height="34" rx="6"/>
        <rect class="drawing-transform-handle drawing-vertical-handle" data-drawing-handle="scale-y" x="-17" y="${top - 11}" width="34" height="22" rx="6"/>
        <rect class="drawing-transform-handle drawing-vertical-handle" data-drawing-handle="scale-y" x="-17" y="${bottom - 11}" width="34" height="22" rx="6"/>`
                  : ""
              }`
        }
      </g>`
    : "";
  const ports = connectionPorts(object, connectionMode || selected);
  return `<g class="drawing-visual-object${selected ? " is-selected" : ""}" data-drawing-object="${object.id}" transform="translate(${object.x} ${object.y}) rotate(${object.rotation})">${objectBody(object, objects)}${controls}${ports}</g>`;
}

export function serializeVisualDrawing(objects) {
  const content = objects
    .map((object) => objectMarkup(object, false, objects))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}"><defs><marker id="drawing-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="18" markerHeight="18" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>${content}</svg>`;
}

export function createVisualDrawingEditor({
  canvas,
  onSourceChange,
  onSelectionChange,
  onViewportChange,
}) {
  const state = {
    profile: "svg_source",
    documents: {},
    objects: createProfileDocument("svg_source"),
    selectedId: null,
    drag: null,
    frame: null,
    enabled: true,
    connectionType: null,
    connectionLabel: "",
    connectionPreview: null,
    viewport: { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT },
    inlineEditor: null,
  };
  const selected = () =>
    state.objects.find((object) => object.id === state.selectedId) || null;
  const notifySelection = () =>
    onSelectionChange?.(structuredClone(selected()));
  const render = () => {
    state.frame = null;
    const preview = state.connectionPreview
      ? `<path class="drawing-connection-preview" d="M${state.connectionPreview.start.x} ${state.connectionPreview.start.y} L${state.connectionPreview.end.x} ${state.connectionPreview.end.y}" marker-end="url(#drawing-arrow)"/>`
      : "";
    canvas.classList.toggle("is-connecting", Boolean(state.connectionType));
    const viewport = state.viewport;
    canvas.innerHTML = `<svg viewBox="${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}" role="img" aria-label="可视化绘图画布"><defs><marker id="drawing-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="18" markerHeight="18" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>${state.objects.map((object) => objectMarkup(object, object.id === state.selectedId, state.objects, Boolean(state.connectionType))).join("")}${preview}</svg>`;
    onViewportChange?.({
      ...viewport,
      zoom: Math.round((VIEW_WIDTH / viewport.width) * 100),
    });
    notifySelection();
  };
  const scheduleRender = () => {
    if (state.frame !== null) return;
    state.frame = requestAnimationFrame(render);
  };
  const commit = () => {
    state.documents[state.profile] = structuredClone(state.objects);
    onSourceChange?.(serializeVisualDrawing(state.objects), {
      profile: state.profile,
      objects: structuredClone(state.objects),
    });
  };
  const point = (event) => {
    const svg = canvas.querySelector("svg");
    const matrix = svg?.getScreenCTM?.();
    if (svg?.createSVGPoint && matrix?.inverse) {
      const cursor = svg.createSVGPoint();
      cursor.x = event.clientX;
      cursor.y = event.clientY;
      const transformed = cursor.matrixTransform(matrix.inverse());
      return { x: transformed.x, y: transformed.y };
    }
    const bounds = canvas.getBoundingClientRect();
    return {
      x:
        ((event.clientX - bounds.left) * VIEW_WIDTH) /
        Math.max(1, bounds.width),
      y:
        ((event.clientY - bounds.top) * VIEW_HEIGHT) /
        Math.max(1, bounds.height),
    };
  };

  const setViewport = (next) => {
    const width = clamp(next.width, VIEW_WIDTH / 4, VIEW_WIDTH * 2.5);
    const height = (width * VIEW_HEIGHT) / VIEW_WIDTH;
    state.viewport = {
      x: Number.isFinite(Number(next.x)) ? Number(next.x) : state.viewport.x,
      y: Number.isFinite(Number(next.y)) ? Number(next.y) : state.viewport.y,
      width,
      height,
    };
    render();
  };

  const zoomAt = (factor, clientX, clientY) => {
    const old = state.viewport;
    const bounds = canvas.getBoundingClientRect();
    const ratioX = Number.isFinite(clientX)
      ? clamp((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1)
      : 0.5;
    const ratioY = Number.isFinite(clientY)
      ? clamp((clientY - bounds.top) / Math.max(1, bounds.height), 0, 1)
      : 0.5;
    const width = clamp(old.width / factor, VIEW_WIDTH / 4, VIEW_WIDTH * 2.5);
    const height = (width * VIEW_HEIGHT) / VIEW_WIDTH;
    setViewport({
      x: old.x + ratioX * (old.width - width),
      y: old.y + ratioY * (old.height - height),
      width,
    });
  };

  const resetViewport = () => setViewport({ x: 0, y: 0, width: VIEW_WIDTH });

  const fitViewport = () => {
    const visible = state.objects.filter(
      (object) => !EDGE_TYPES.has(object.type),
    );
    if (!visible.length) return resetViewport();
    const left = Math.min(
      ...visible.map((object) => object.x - object.width / 2),
    );
    const right = Math.max(
      ...visible.map((object) => object.x + object.width / 2),
    );
    const top = Math.min(
      ...visible.map((object) => object.y - object.height / 2),
    );
    const bottom = Math.max(
      ...visible.map((object) => object.y + object.height / 2),
    );
    const padding = 70;
    let width = Math.max(180, right - left + padding * 2);
    let height = Math.max(120, bottom - top + padding * 2);
    const aspect = VIEW_WIDTH / VIEW_HEIGHT;
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;
    setViewport({
      x: (left + right - width) / 2,
      y: (top + bottom - height) / 2,
      width,
    });
  };

  const closeInlineEditor = ({ commit: shouldCommit = false } = {}) => {
    const editor = state.inlineEditor;
    if (!editor) return;
    state.inlineEditor = null;
    if (shouldCommit) {
      const object = state.objects.find((item) => item.id === editor.objectId);
      if (object) {
        object.text = editor.input.value.trim().slice(0, 80);
        render();
        commit();
      }
    }
    editor.input.remove();
  };

  const openInlineEditor = (object, event) => {
    if (!object) return;
    closeInlineEditor();
    state.selectedId = object.id;
    render();
    const bounds = canvas.getBoundingClientRect();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "drawing-inline-text-editor";
    input.value = object.text || "";
    input.setAttribute("aria-label", "编辑节点或关系文字");
    input.style.left = `${clamp(event.clientX - bounds.left + 12, 8, Math.max(8, bounds.width - 330))}px`;
    input.style.top = `${clamp(event.clientY - bounds.top + 12, 8, Math.max(8, bounds.height - 52))}px`;
    input.addEventListener("pointerdown", (pointerEvent) =>
      pointerEvent.stopPropagation(),
    );
    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        closeInlineEditor({ commit: true });
      } else if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        closeInlineEditor();
        render();
      }
    });
    input.addEventListener("blur", () => closeInlineEditor({ commit: true }), {
      once: true,
    });
    canvas.appendChild(input);
    state.inlineEditor = { input, objectId: object.id };
    input.focus();
    input.select();
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.enabled) return;
    const objectNode = event.target.closest("[data-drawing-object]");
    if (!objectNode) {
      state.selectedId = null;
      state.drag = {
        kind: "pan",
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        viewport: { ...state.viewport },
      };
      canvas.classList.add("is-panning");
      canvas.setPointerCapture?.(event.pointerId);
      render();
      return;
    }
    state.selectedId = objectNode.dataset.drawingObject;
    const object = selected();
    const cursor = point(event);
    const port = event.target.closest("[data-drawing-port]");
    if (port && NODE_TYPES.has(object.type)) {
      state.connectionType ||= "arrow";
      state.drag = {
        kind: "connect",
        pointerId: event.pointerId,
        fromId: object.id,
        start: cursor,
      };
      state.connectionPreview = { start: cursor, end: cursor };
      canvas.setPointerCapture?.(event.pointerId);
      render();
      return;
    }
    const capabilities = visualTransformCapabilities(object);
    const requestedKind =
      event.target.closest("[data-drawing-handle]")?.dataset.drawingHandle ||
      "move";
    const allowedKind =
      requestedKind === "move"
        ? capabilities.move
        : requestedKind === "rotate"
          ? capabilities.rotate
          : capabilities.resize;
    if (!allowedKind) {
      state.drag = null;
      render();
      return;
    }
    state.drag = {
      kind: requestedKind,
      pointerId: event.pointerId,
      start: cursor,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      rotation: object.rotation,
      localStart: (() => {
        const radians = (-object.rotation * Math.PI) / 180;
        const dx = cursor.x - object.x;
        const dy = cursor.y - object.y;
        return {
          x: dx * Math.cos(radians) - dy * Math.sin(radians),
          y: dx * Math.sin(radians) + dy * Math.cos(radians),
        };
      })(),
      distance: Math.max(
        1,
        Math.hypot(cursor.x - object.x, cursor.y - object.y),
      ),
      angle: Math.atan2(cursor.y - object.y, cursor.x - object.x),
    };
    canvas.setPointerCapture?.(event.pointerId);
    render();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    if (state.drag.kind === "pan") {
      const bounds = canvas.getBoundingClientRect();
      const viewport = state.drag.viewport;
      state.viewport = {
        ...viewport,
        x:
          viewport.x -
          ((event.clientX - state.drag.clientX) * viewport.width) /
            Math.max(1, bounds.width),
        y:
          viewport.y -
          ((event.clientY - state.drag.clientY) * viewport.height) /
            Math.max(1, bounds.height),
      };
      scheduleRender();
      return;
    }
    const object = selected();
    const cursor = point(event);
    if (state.drag.kind === "connect") {
      state.connectionPreview = {
        start: state.drag.start,
        end: cursor,
      };
    } else if (state.drag.kind === "move") {
      object.x = state.drag.x + cursor.x - state.drag.start.x;
      object.y = state.drag.y + cursor.y - state.drag.start.y;
    } else if (
      state.drag.kind === "scale" ||
      state.drag.kind === "scale-x" ||
      state.drag.kind === "scale-y"
    ) {
      const radians = (-state.drag.rotation * Math.PI) / 180;
      const dx = cursor.x - object.x;
      const dy = cursor.y - object.y;
      const local = {
        x: dx * Math.cos(radians) - dy * Math.sin(radians),
        y: dx * Math.sin(radians) + dy * Math.cos(radians),
      };
      const ratioX = Math.max(
        0.15,
        Math.min(
          8,
          Math.abs(local.x) / Math.max(1, Math.abs(state.drag.localStart.x)),
        ),
      );
      const ratioY = Math.max(
        0.15,
        Math.min(
          8,
          Math.abs(local.y) / Math.max(1, Math.abs(state.drag.localStart.y)),
        ),
      );
      const ratio = Math.max(
        0.15,
        Math.min(
          8,
          Math.hypot(cursor.x - object.x, cursor.y - object.y) /
            state.drag.distance,
        ),
      );
      if (state.drag.kind !== "scale-y") {
        object.width = Math.max(
          32,
          state.drag.width * (event.shiftKey ? ratio : ratioX),
        );
      }
      if (state.drag.kind !== "scale-x") {
        object.height = Math.max(
          24,
          state.drag.height * (event.shiftKey ? ratio : ratioY),
        );
      }
    } else if (state.drag.kind === "rotate") {
      const angle = Math.atan2(cursor.y - object.y, cursor.x - object.x);
      const rawRotation =
        state.drag.rotation + ((angle - state.drag.angle) * 180) / Math.PI;
      object.rotation = event.shiftKey
        ? Math.round(rawRotation / 15) * 15
        : Math.round(rawRotation * 10) / 10;
    }
    scheduleRender();
  });
  const endDrag = (event) => {
    if (!state.drag) return;
    const draggedKind = state.drag.kind;
    if (state.drag.kind === "connect") {
      const canHitTest =
        Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY);
      const hit = canHitTest
        ? globalThis.document
            ?.elementFromPoint?.(event.clientX, event.clientY)
            ?.closest?.("[data-drawing-object]")
        : null;
      const toId = hit?.dataset?.drawingObject;
      const fromId = state.drag.fromId;
      if (toId && fromId && toId !== fromId) {
        const edge = createObject(
          state.connectionType || "arrow",
          state.objects.length,
        );
        Object.assign(edge, {
          profile: state.profile,
          fromId,
          toId,
          text: state.connectionLabel,
          graphEdge: ["graphviz_dot", "mermaid"].includes(state.profile),
        });
        state.objects.push(edge);
        state.selectedId = edge.id;
      }
      state.connectionPreview = null;
      state.connectionType = null;
      state.connectionLabel = "";
    }
    state.drag = null;
    canvas.classList.remove("is-panning");
    render();
    if (draggedKind !== "pan") commit();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", (event) => {
    const objectId = event.target.closest("[data-drawing-object]")?.dataset
      ?.drawingObject;
    const object = state.objects.find((item) => item.id === objectId);
    if (!object) return;
    event.preventDefault();
    openInlineEditor(object, event);
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!state.enabled) return;
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.14 : 1 / 1.14, event.clientX, event.clientY);
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.connectionType) {
      event.preventDefault();
      state.connectionType = null;
      state.connectionLabel = "";
      state.connectionPreview = null;
      state.drag = null;
      render();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selected()) {
      event.preventDefault();
      const selectedId = state.selectedId;
      state.objects = state.objects.filter(
        (object) =>
          object.id !== selectedId &&
          object.fromId !== selectedId &&
          object.toId !== selectedId,
      );
      state.selectedId = null;
      render();
      commit();
    }
  });

  const add = (type, patch = {}) => {
    const supported = new Set([
      "line",
      "arrow",
      "connector",
      "node",
      "rectangle",
      "ellipse",
      "diamond",
      "axes",
      "plot",
      "label",
      "formula",
    ]);
    const object = createObject(
      supported.has(type) ? type : "rectangle",
      state.objects.length,
    );
    const profileColors = PROFILE_COLORS[state.profile];
    if (profileColors?.length) {
      object.color = profileColors[state.objects.length % profileColors.length];
    }
    Object.assign(object, patch, { profile: state.profile });
    state.objects.push(object);
    state.selectedId = object.id;
    render();
    commit();
    return structuredClone(object);
  };
  const beginConnection = (type = "arrow", label = "") => {
    state.connectionType = type === "connector" ? "connector" : "arrow";
    state.connectionLabel = String(label || "").slice(0, 80);
    state.connectionPreview = null;
    render();
    return true;
  };
  const addFormula = ({ latex, svg, width = 250, height = 100 } = {}) => {
    if (!embeddedSvgParts(svg)) return false;
    add("formula", {
      text: String(latex || "公式").slice(0, 120),
      formulaSvg: String(svg),
      width: clamp(width, 80, 720),
      height: clamp(height, 48, 360),
      color: "#0F766E",
    });
    return true;
  };
  const addGraphNode = (label = "新节点", type = "node") => {
    const parent = selected();
    const index = state.objects.filter((item) =>
      NODE_TYPES.has(item.type),
    ).length;
    const column = index % 3;
    const row = Math.floor(index / 3) % 3;
    const child = add(NODE_TYPES.has(type) ? type : "node", {
      text: String(label || "新节点").slice(0, 80),
      x: 180 + column * 220,
      y: 135 + row * 140,
      width: 175,
      height: 82,
    });
    if (parent && NODE_TYPES.has(parent.type)) {
      add("arrow", {
        fromId: parent.id,
        toId: child.id,
        graphEdge: true,
      });
      state.selectedId = child.id;
      render();
      commit();
    }
    return child;
  };
  const addMindMapChild = (label = "新分支") => {
    const selectedParent = selected();
    const children = state.objects.filter(
      (item) => item.profile === "mermaid" && item.mindMapChild,
    ).length;
    const angle = (children * 137.5 * Math.PI) / 180;
    const radius = 205;
    const child = add("node", {
      text: String(label || "新分支").slice(0, 80),
      x: 400 + Math.cos(angle) * radius,
      y: 260 + Math.sin(angle) * Math.min(radius, 170),
      width: 170,
      height: 78,
      mindMapChild: true,
    });
    const root = state.objects.find(
      (object) => object.profile === "mermaid" && NODE_TYPES.has(object.type),
    );
    const parent =
      selectedParent?.profile === "mermaid" &&
      NODE_TYPES.has(selectedParent.type)
        ? selectedParent
        : root;
    add("connector", {
      fromId: parent?.id,
      toId: child.id,
      mindMapEdge: true,
    });
    state.selectedId = child.id;
    render();
    commit();
    return child;
  };
  const applyObjectPatch = (object, patch) => {
    if (!object || !patch || typeof patch !== "object") return false;
    if (patch.width !== undefined) object.width = clamp(patch.width, 32, 1200);
    if (patch.height !== undefined)
      object.height = clamp(patch.height, 24, 900);
    if (patch.rotation !== undefined)
      object.rotation = clamp(patch.rotation, -360, 360);
    if (patch.strokeWidth !== undefined)
      object.strokeWidth = clamp(patch.strokeWidth, 1, 24);
    if (typeof patch.color === "string" && /^#[0-9a-f]{6}$/i.test(patch.color))
      object.color = patch.color.toUpperCase();
    if (typeof patch.fill === "string" && /^#[0-9a-f]{6}$/i.test(patch.fill))
      object.fill = patch.fill.toUpperCase();
    if (typeof patch.text === "string") object.text = patch.text.slice(0, 80);
    for (const property of [
      "expression",
      "legend",
      "lineStyle",
      "xLabel",
      "yLabel",
      "grid",
      "legendPosition",
    ]) {
      if (typeof patch[property] === "string") {
        object[property] = patch[property].slice(0, 160);
      }
    }
    for (const property of ["xMin", "xMax", "yMin", "yMax", "samples"]) {
      if (
        patch[property] !== undefined &&
        Number.isFinite(Number(patch[property]))
      ) {
        object[property] = Number(patch[property]);
      }
    }
    if (typeof patch.curve === "string") object.curve = patch.curve;
    return true;
  };
  const updateSelected = (patch) => {
    const object = selected();
    if (!applyObjectPatch(object, patch)) return false;
    render();
    commit();
    return true;
  };
  const updateProfileObject = (
    type,
    patch,
    { createIfMissing = false } = {},
  ) => {
    let object = selected()?.type === type ? selected() : null;
    object ||= state.objects.find((candidate) => candidate.type === type);
    if (!object && createIfMissing) {
      return add(type, patch);
    }
    if (!applyObjectPatch(object, patch)) return false;
    state.selectedId = object.id;
    render();
    commit();
    return structuredClone(object);
  };
  const deleteSelected = () => {
    const object = selected();
    if (!object) return false;
    state.objects = state.objects.filter(
      (candidate) =>
        candidate.id !== state.selectedId &&
        candidate.fromId !== object.id &&
        candidate.toId !== object.id,
    );
    state.selectedId = null;
    render();
    commit();
    return true;
  };
  const duplicateSelected = () => {
    const object = selected();
    if (!object) return false;
    const copy = {
      ...structuredClone(object),
      id: uid(),
      x: object.x + 28,
      y: object.y + 28,
    };
    state.objects.push(copy);
    state.selectedId = copy.id;
    render();
    commit();
    return true;
  };
  const moveLayer = (direction) => {
    const index = state.objects.findIndex(
      (object) => object.id === state.selectedId,
    );
    if (index < 0) return false;
    const next = clamp(
      index + (direction === "back" ? -1 : 1),
      0,
      state.objects.length - 1,
    );
    if (next === index) return false;
    [state.objects[index], state.objects[next]] = [
      state.objects[next],
      state.objects[index],
    ];
    render();
    commit();
    return true;
  };
  const applyPreset = (preset) => {
    const definitions = {
      process: [
        ["node", 220, 220, "输入"],
        ["arrow", 400, 220],
        ["node", 590, 220, "输出"],
      ],
      math: [
        ["axes", 360, 270],
        ["plot", 385, 250],
        ["label", 620, 100, "f(x)"],
      ],
      data: [
        ["node", 400, 95, "数据"],
        ["node", 225, 340, "训练"],
        ["node", 575, 340, "验证"],
        ["connector", 315, 220],
        ["connector", 490, 220],
      ],
      geometry: [
        ["ellipse", 260, 250],
        ["rectangle", 530, 250],
        ["diamond", 400, 250],
      ],
    };
    const plan = definitions[preset];
    if (!plan) return false;
    state.objects = plan.map(([type, x, y, text], index) => ({
      ...createObject(type, index),
      x,
      y,
      ...(text ? { text } : {}),
      color: COLOR_PRESETS[index % COLOR_PRESETS.length],
      profile: state.profile,
    }));
    state.selectedId = state.objects[0]?.id || null;
    render();
    commit();
    return true;
  };
  const setProfile = (profile, { commit: shouldCommit = true } = {}) => {
    const nextProfile = Object.hasOwn(PROFILE_COLORS, profile)
      ? profile
      : "svg_source";
    state.documents[state.profile] = structuredClone(state.objects);
    state.profile = nextProfile;
    canvas.dataset.drawingProfile = nextProfile;
    state.objects = structuredClone(
      state.documents[nextProfile] || createProfileDocument(nextProfile),
    );
    state.selectedId = state.objects[0]?.id || null;
    render();
    if (shouldCommit) commit();
    return nextProfile;
  };
  const replaceDocument = (
    profile,
    objects,
    { commit: shouldCommit = false } = {},
  ) => {
    if (!Array.isArray(objects)) return false;
    const nextProfile = Object.hasOwn(PROFILE_COLORS, profile)
      ? profile
      : "svg_source";
    state.documents[state.profile] = structuredClone(state.objects);
    state.profile = nextProfile;
    canvas.dataset.drawingProfile = nextProfile;
    state.objects = structuredClone(objects).map((object, index) => ({
      ...createObject(object?.type || "rectangle", index),
      ...object,
      id: String(object?.id || uid()),
      profile: nextProfile,
    }));
    state.documents[nextProfile] = structuredClone(state.objects);
    state.selectedId = state.objects[0]?.id || null;
    render();
    if (shouldCommit) commit();
    return true;
  };
  const applyProfileTemplate = (profile, template, options = {}) => {
    if (profile !== state.profile) setProfile(profile);
    state.objects = createProfileDocument(state.profile, template, options);
    state.documents[state.profile] = structuredClone(state.objects);
    state.selectedId = state.objects[0]?.id || null;
    render();
    commit();
    return true;
  };
  const setEnabled = (enabled) => {
    state.enabled = Boolean(enabled);
    canvas.classList.toggle("is-disabled", !state.enabled);
  };
  canvas.dataset.drawingProfile = state.profile;
  render();
  commit();
  return {
    state,
    add,
    beginConnection,
    addFormula,
    addGraphNode,
    addMindMapChild,
    zoomIn: () => zoomAt(1.2),
    zoomOut: () => zoomAt(1 / 1.2),
    resetViewport,
    fitViewport,
    setEnabled,
    commit,
    selected,
    updateSelected,
    updateProfileObject,
    deleteSelected,
    duplicateSelected,
    moveLayer,
    applyPreset,
    setProfile,
    replaceDocument,
    applyProfileTemplate,
  };
}
