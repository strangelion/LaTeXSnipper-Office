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

const clamp = (value, min, max) => {
  const numeric = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : min));
};

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
  return plan.map(([type, x, y, text, extra], index) => ({
    ...createObject(type, index),
    x,
    y,
    ...(text ? { text } : {}),
    ...(extra || {}),
    color: colors[index % colors.length],
    profile,
  }));
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
        ["label", 405, 155, "\u2220ABC"],
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
        ["axes", 385, 270],
        ["plot", 385, 260, null, { curve: "sin" }],
        ["label", 600, 105, "f(x)"],
      ],
      plot: [
        ["axes", 385, 270],
        [
          "plot",
          385,
          260,
          null,
          {
            curve: options.curve || "sin",
            expression: options.expression || "sin(x)",
            xMin: Number(options.xMin ?? -6.28),
            xMax: Number(options.xMax ?? 6.28),
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

function objectBody(object) {
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
      }" fill="none" stroke="${object.color}" stroke-width="${stroke}" stroke-linecap="round" marker-end="url(#drawing-arrow)"${vectorStroke}/>`;
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
      const points = Array.from({ length: 41 }, (_, index) => {
        const ratio = index / 40;
        const pointX = x + width * ratio;
        const unit = ratio * 2 - 1;
        const curve = object.curve || "sin";
        const value =
          curve === "quadratic"
            ? unit * unit * 2 - 1
            : curve === "gaussian"
              ? 1 - Math.exp(-unit * unit * 5) * 2
              : curve === "linear"
                ? unit
                : Math.sin(ratio * Math.PI * 2);
        const pointY = value * (-height * 0.4);
        return `${pointX.toFixed(1)},${pointY.toFixed(1)}`;
      }).join(" ");
      const rangeLabels =
        Number.isFinite(object.xMin) && Number.isFinite(object.xMax)
          ? `<text x="${x}" y="${height / 2 - 6}" font-size="18" fill="${object.color}">${escapeXml(object.xMin)}</text><text x="${width / 2}" y="${height / 2 - 6}" text-anchor="end" font-size="18" fill="${object.color}">${escapeXml(object.xMax)}</text>`
          : "";
      return `<polyline points="${points}" fill="none" stroke="${object.color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"${vectorStroke}/>${rangeLabels}`;
    }
    case "node":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${object.profile === "graphviz_dot" ? 8 : object.profile === "tikz" ? 3 : 24}" fill="${profileFill}" stroke="${object.color}" stroke-width="${stroke}"${vectorStroke}/>${label(36)}`;
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${object.profile === "tikz" ? 2 : 10}" fill="${profileFill}" stroke="${object.color}" stroke-width="${stroke}"${vectorStroke}/>${label()}`;
  }
}

function objectMarkup(object, selected = false) {
  const left = -object.width / 2 - 18;
  const right = object.width / 2 + 18;
  const top = -object.height / 2 - 18;
  const bottom = object.height / 2 + 18;
  const controls = selected
    ? `<g class="drawing-object-controls" aria-hidden="true">
        <rect class="drawing-selection-frame" x="${left}" y="${top}" width="${object.width + 36}" height="${object.height + 36}" rx="10"/>
        <line class="drawing-rotate-stem" x1="0" y1="${top}" x2="0" y2="${top - 64}"/>
        <circle class="drawing-transform-handle drawing-rotate-handle" data-drawing-handle="rotate" cx="0" cy="${top - 64}" r="14"/>
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${left}" cy="${top}" r="13"/>
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${right}" cy="${top}" r="13"/>
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${right}" cy="${bottom}" r="13"/>
        <circle class="drawing-transform-handle drawing-corner-handle" data-drawing-handle="scale" cx="${left}" cy="${bottom}" r="13"/>
        <rect class="drawing-transform-handle drawing-horizontal-handle" data-drawing-handle="scale-x" x="${left - 11}" y="-17" width="22" height="34" rx="6"/>
        <rect class="drawing-transform-handle drawing-horizontal-handle" data-drawing-handle="scale-x" x="${right - 11}" y="-17" width="22" height="34" rx="6"/>
        <rect class="drawing-transform-handle drawing-vertical-handle" data-drawing-handle="scale-y" x="-17" y="${top - 11}" width="34" height="22" rx="6"/>
        <rect class="drawing-transform-handle drawing-vertical-handle" data-drawing-handle="scale-y" x="-17" y="${bottom - 11}" width="34" height="22" rx="6"/>
      </g>`
    : "";
  return `<g class="drawing-visual-object${selected ? " is-selected" : ""}" data-drawing-object="${object.id}" transform="translate(${object.x} ${object.y}) rotate(${object.rotation})">${objectBody(object)}${controls}</g>`;
}

export function serializeVisualDrawing(objects) {
  const content = objects.map((object) => objectMarkup(object)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}"><defs><marker id="drawing-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="18" markerHeight="18" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>${content}</svg>`;
}

export function createVisualDrawingEditor({
  canvas,
  onSourceChange,
  onSelectionChange,
}) {
  const state = {
    profile: "svg_source",
    documents: {},
    objects: createProfileDocument("svg_source"),
    selectedId: null,
    drag: null,
    frame: null,
    enabled: true,
  };
  const selected = () =>
    state.objects.find((object) => object.id === state.selectedId) || null;
  const notifySelection = () =>
    onSelectionChange?.(structuredClone(selected()));
  const render = () => {
    state.frame = null;
    canvas.innerHTML = `<svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" role="img" aria-label="可视化绘图画布"><defs><marker id="drawing-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="18" markerHeight="18" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>${state.objects.map((object) => objectMarkup(object, object.id === state.selectedId)).join("")}</svg>`;
    notifySelection();
  };
  const scheduleRender = () => {
    if (state.frame !== null) return;
    state.frame = requestAnimationFrame(render);
  };
  const commit = () => onSourceChange?.(serializeVisualDrawing(state.objects));
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

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.enabled) return;
    const objectNode = event.target.closest("[data-drawing-object]");
    if (!objectNode) {
      state.selectedId = null;
      render();
      return;
    }
    state.selectedId = objectNode.dataset.drawingObject;
    const object = selected();
    const cursor = point(event);
    state.drag = {
      kind:
        event.target.closest("[data-drawing-handle]")?.dataset.drawingHandle ||
        "move",
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
    const object = selected();
    const cursor = point(event);
    if (state.drag.kind === "move") {
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
  const endDrag = () => {
    if (!state.drag) return;
    state.drag = null;
    render();
    commit();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("keydown", (event) => {
    if ((event.key === "Delete" || event.key === "Backspace") && selected()) {
      event.preventDefault();
      state.objects = state.objects.filter(
        (object) => object.id !== state.selectedId,
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
    Object.assign(object, patch, { profile: state.profile });
    state.objects.push(object);
    state.selectedId = object.id;
    render();
    commit();
    return structuredClone(object);
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
  const addGraphNode = (label = "新节点") => {
    const parent = selected();
    const index = state.objects.filter((item) => item.type === "node").length;
    const column = index % 3;
    const row = Math.floor(index / 3) % 3;
    const child = add("node", {
      text: String(label || "新节点").slice(0, 80),
      x: 180 + column * 220,
      y: 135 + row * 140,
      width: 175,
      height: 82,
    });
    if (parent && ["node", "ellipse", "diamond"].includes(parent.type)) {
      const dx = child.x - parent.x;
      const dy = child.y - parent.y;
      add("arrow", {
        x: (parent.x + child.x) / 2,
        y: (parent.y + child.y) / 2,
        width: Math.max(70, Math.hypot(dx, dy) - 120),
        height: 36,
        rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
        graphEdge: true,
      });
      state.selectedId = child.id;
      render();
      commit();
    }
    return child;
  };
  const addMindMapChild = (label = "新分支") => {
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
    const dx = child.x - 400;
    const dy = child.y - 260;
    add("connector", {
      x: (400 + child.x) / 2,
      y: (260 + child.y) / 2,
      width: Math.max(70, Math.hypot(dx, dy) - 120),
      height: 42,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      mindMapEdge: true,
    });
    state.selectedId = child.id;
    render();
    commit();
    return child;
  };
  const updateSelected = (patch) => {
    const object = selected();
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
    render();
    commit();
    return true;
  };
  const deleteSelected = () => {
    if (!selected()) return false;
    state.objects = state.objects.filter(
      (object) => object.id !== state.selectedId,
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
  const setProfile = (profile) => {
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
    commit();
    return nextProfile;
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
    addFormula,
    addGraphNode,
    addMindMapChild,
    setEnabled,
    commit,
    selected,
    updateSelected,
    deleteSelected,
    duplicateSelected,
    moveLayer,
    applyPreset,
    setProfile,
    applyProfileTemplate,
  };
}
