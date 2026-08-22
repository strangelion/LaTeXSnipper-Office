import {
  materializeVisualObjects,
  serializeVisualDrawing,
} from "./visual-editor.js";
import { toPgfPlotsExpression } from "./math-expression.js";

const CONTRACT = "latexsnipper-visual-v1";
const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 520;

const utf8ToBase64Url = (value) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : globalThis.Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlToUtf8 = (value) => {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : globalThis.Buffer.from(padded, "base64").toString("binary");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const hashSource = (value) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const round = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
};

const escapeLatexText = (value) => {
  const replacements = {
    "\\": "\\textbackslash{}",
    "#": "\\#",
    $: "\\$",
    "%": "\\%",
    "&": "\\&",
    _: "\\_",
    "{": "\\{",
    "}": "\\}",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}",
  };
  return [...String(value || "")]
    .map((character) => replacements[character] || character)
    .join("");
};

const escapeQuoted = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n");

const escapeMermaid = (value) =>
  String(value || "")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, " ");

const colorName = (index) => `lscolor${index}`;

function visualPayload(profile, objects) {
  return utf8ToBase64Url(
    JSON.stringify({
      version: 1,
      profile,
      objects: structuredClone(objects || []),
    }),
  );
}

function metadataLine(profile, body, objects) {
  return `${CONTRACT}:${profile}:${hashSource(body)}:${visualPayload(profile, objects)}`;
}

function tikzPoint(object, dx = 0, dy = 0) {
  return `${round((Number(object.x) + dx - VIEW_WIDTH / 2) / 70)},${round((VIEW_HEIGHT / 2 - Number(object.y) - dy) / 70)}`;
}

function colorDefinitions(objects) {
  const colors = [
    ...new Set(objects.map((object) => object.color).filter(Boolean)),
  ];
  return {
    colors,
    source: colors
      .map(
        (color, index) =>
          `\\definecolor{${colorName(index)}}{HTML}{${color.replace("#", "")}}`,
      )
      .join("\n"),
  };
}

function tikzStyle(object, colors, extra = []) {
  const index = Math.max(0, colors.indexOf(object.color));
  return [
    `draw=${colorName(index)}`,
    `line width=${round(Math.max(1, Number(object.strokeWidth || 2)) / 3)}pt`,
    ...extra,
  ].join(", ");
}

function serializeTikz(objects) {
  const renderedObjects = materializeVisualObjects(objects);
  const { colors, source: definitions } = colorDefinitions(renderedObjects);
  const rows = renderedObjects.map((object, index) => {
    const xRadius = round(Number(object.width || 100) / 140);
    const yRadius = round(Number(object.height || 60) / 140);
    const center = tikzPoint(object);
    const rotate = Number(object.rotation || 0)
      ? `, rotate=${round(-Number(object.rotation))}`
      : "";
    const text = escapeLatexText(object.text);
    switch (object.type) {
      case "line":
      case "arrow":
      case "connector": {
        const angle = (Number(object.rotation || 0) * Math.PI) / 180;
        const dx = (Number(object.width || 100) / 2) * Math.cos(angle);
        const dy = (Number(object.width || 100) / 2) * Math.sin(angle);
        const options = tikzStyle(
          object,
          colors,
          [
            object.type === "line" ? "" : "->",
            object.type === "connector" ? "bend left=18" : "",
          ].filter(Boolean),
        );
        const edgeLabel = object.text
          ? ` node[midway, above] {${escapeLatexText(object.text)}}`
          : "";
        return `\\draw[${options}] (${tikzPoint(object, -dx, -dy)}) to${edgeLabel} (${tikzPoint(object, dx, dy)});`;
      }
      case "axes": {
        const [centerX, centerY] = center.split(",").map(Number);
        return [
          `\\draw[${tikzStyle(object, colors, ["->"])}] (${round(centerX - xRadius)},${centerY}) -- (${round(centerX + xRadius)},${centerY}) node[right] {$x$};`,
          `\\draw[${tikzStyle(object, colors, ["->"])}] (${centerX},${round(centerY - yRadius)}) -- (${centerX},${round(centerY + yRadius)}) node[above] {$y$};`,
        ].join("\n");
      }
      case "ellipse":
        return `\\draw[${tikzStyle(object, colors)}${rotate}] (${center}) ellipse [x radius=${xRadius}cm, y radius=${yRadius}cm];${text ? `\n\\node at (${center}) {${text}};` : ""}`;
      case "diamond": {
        const [centerX, centerY] = center.split(",").map(Number);
        return `\\draw[${tikzStyle(object, colors)}] (${centerX},${round(centerY + yRadius)}) -- (${round(centerX + xRadius)},${centerY}) -- (${centerX},${round(centerY - yRadius)}) -- (${round(centerX - xRadius)},${centerY}) -- cycle;${text ? `\n\\node at (${center}) {${text}};` : ""}`;
      }
      case "label":
        return `\\node[text=${colorName(Math.max(0, colors.indexOf(object.color)))}${rotate}] at (${center}) {${text}};`;
      case "formula":
        return `\\node[text=${colorName(Math.max(0, colors.indexOf(object.color)))}, inner sep=0pt${rotate}] at (${center}) {$${object.text || "x"}$};`;
      case "plot":
        return `\\draw[${tikzStyle(object, colors)}] plot[smooth, domain=-3:3, samples=80] (\\x,{sin(\\x r)});`;
      default:
        return `\\node[${tikzStyle(object, colors, [object.type === "node" ? "rounded corners=3pt" : "", `minimum width=${round(xRadius * 2)}cm`, `minimum height=${round(yRadius * 2)}cm`].filter(Boolean))}${rotate}] (n${index}) at (${center}) {${text}};`;
    }
  });
  return [definitions, ...rows].filter(Boolean).join("\n");
}

function pgfExpression(object) {
  const expression = String(object.expression || "").trim();
  if (expression) return toPgfPlotsExpression(expression);
  const curves = {
    quadratic: "x^2",
    gaussian: "exp(-x^2)",
    linear: "x",
    sin: "sin(deg(x))",
  };
  return curves[object.curve] || curves.sin;
}

function serializePgfPlots(objects) {
  const plots = objects.filter((object) => object.type === "plot");
  const axes = objects.find((object) => object.type === "axes") || {};
  const xMin = plots.length
    ? Math.min(...plots.map((object) => Number(object.xMin ?? -6.28)))
    : -3;
  const xMax = plots.length
    ? Math.max(...plots.map((object) => Number(object.xMax ?? 6.28)))
    : 3;
  const rows = plots.length
    ? plots.flatMap((object, index) => {
        const style = ["solid", "dashed", "dotted", "dashdotted"].includes(
          object.lineStyle,
        )
          ? object.lineStyle
          : "solid";
        const color = `color={rgb,255:red,${parseInt(object.color?.slice(1, 3) || "25", 16)};green,${parseInt(object.color?.slice(3, 5) || "63", 16)};blue,${parseInt(object.color?.slice(5, 7) || "EB", 16)}}`;
        const dataRows = (object.dataPoints || [])
          .filter(
            (point) =>
              Number.isFinite(Number(point.x)) &&
              Number.isFinite(Number(point.y)),
          )
          .map((point) => `    ${round(point.x)} ${round(point.y)} \\\\`);
        const samples = dataRows.length
          ? [
              `  \\addplot[only marks, mark=*, mark size=1.8pt, ${color}] table[row sep=\\\\] {`,
              "    x y \\\\",
              ...dataRows,
              "  };",
              `  \\addlegendentry{${escapeLatexText(object.dataLegend || "samples")}}`,
            ]
          : [];
        const plot = `  \\addplot[thick, ${style}, mark=none, ${color}, domain=${round(Number(object.xMin ?? xMin))}:${round(Number(object.xMax ?? xMax))}, samples=${Math.max(16, Math.min(600, Math.round(Number(object.samples || 120))))}] {${pgfExpression(object)}};`;
        const legend = escapeLatexText(
          object.legend || object.expression || `curve ${index + 1}`,
        );
        return [...samples, plot, `  \\addlegendentry{${legend}}`];
      })
    : ["  \\addplot[thick, domain=-3:3, samples=120] {x};"];
  const annotations = objects
    .filter((object) => object.type === "label")
    .map((object) => {
      const x = round(Math.max(0, Math.min(1, Number(object.x) / VIEW_WIDTH)));
      const y = round(
        Math.max(0, Math.min(1, 1 - Number(object.y) / VIEW_HEIGHT)),
      );
      return `  \\node[text={rgb,255:red,${parseInt(object.color?.slice(1, 3) || "25", 16)};green,${parseInt(object.color?.slice(3, 5) || "63", 16)};blue,${parseInt(object.color?.slice(5, 7) || "EB", 16)}}] at (axis description cs:${x},${y}) {${escapeLatexText(object.text)}};`;
    });
  const axisOptions = [
    `grid=${["none", "minor", "major", "both"].includes(axes.grid) ? axes.grid : "major"}`,
    "axis lines=middle",
    "unbounded coords=jump",
    `xmin=${round(xMin)}`,
    `xmax=${round(xMax)}`,
    Number.isFinite(Number(axes.yMin)) ? `ymin=${round(axes.yMin)}` : null,
    Number.isFinite(Number(axes.yMax)) ? `ymax=${round(axes.yMax)}` : null,
    `xlabel={${escapeLatexText(axes.xLabel || "x")}}`,
    `ylabel={${escapeLatexText(axes.yLabel || "f(x)")}}`,
    `legend pos=${axes.legendPosition || "north east"}`,
    "legend cell align=left",
  ].filter(Boolean);
  return [
    `\\begin{axis}[${axisOptions.join(", ")}]`,
    ...rows,
    ...annotations,
    "\\end{axis}",
  ].join("\n");
}

const nodeLike = (object) =>
  ["node", "rectangle", "ellipse", "diamond", "label"].includes(object.type);

function edgeEndpoints(edge, nodes) {
  if (nodes.length < 2) return null;
  const from = nodes.find((node) => node.object.id === edge.fromId);
  const to = nodes.find((node) => node.object.id === edge.toId);
  if (from && to && from.index !== to.index) return [from.index, to.index];
  const angle = (Number(edge.rotation || 0) * Math.PI) / 180;
  const dx = (Number(edge.width || 100) / 2) * Math.cos(angle);
  const dy = (Number(edge.width || 100) / 2) * Math.sin(angle);
  const nearest = (x, y, excluded) =>
    nodes
      .filter((node) => node.index !== excluded)
      .map((node) => ({
        ...node,
        distance: Math.hypot(
          Number(node.object.x) - x,
          Number(node.object.y) - y,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
  const nearestFrom = nearest(Number(edge.x) - dx, Number(edge.y) - dy);
  const nearestTo = nearest(
    Number(edge.x) + dx,
    Number(edge.y) + dy,
    nearestFrom?.index,
  );
  return nearestFrom && nearestTo ? [nearestFrom.index, nearestTo.index] : null;
}

function serializeGraphviz(objects) {
  const nodes = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => nodeLike(object));
  const rows = [
    "digraph LaTeXSnipper {",
    '  graph [layout=neato, overlap=true, splines=true, outputorder=edgesfirst, bgcolor="transparent", margin=0, pad=0.04];',
    '  node [fontname="Segoe UI", style="rounded,filled", fixedsize=true, margin=0];',
  ];
  for (const { object, index } of nodes) {
    const shapes = {
      ellipse: "ellipse",
      diamond: "diamond",
      label: "plaintext",
    };
    rows.push(
      `  n${index} [label="${escapeQuoted(object.text || `节点 ${index + 1}`)}", shape=${shapes[object.type] || "box"}, color="${object.color || "#2563EB"}", fillcolor="${object.fill || "#FFFFFF"}", penwidth=${round(Math.max(1, Number(object.strokeWidth || 2)) * 0.75)}, pos="${round(Number(object.x) / 96)},${round((VIEW_HEIGHT - Number(object.y)) / 96)}!", pin=true, width=${round(Math.max(0.3, Number(object.width) / 96))}, height=${round(Math.max(0.2, Number(object.height) / 96))}];`,
    );
  }
  for (const object of objects.filter((item) =>
    ["line", "arrow", "connector"].includes(item.type),
  )) {
    const endpoints = edgeEndpoints(object, nodes);
    if (endpoints) {
      const attributes = [
        `color="${object.color || "#2563EB"}"`,
        object.type === "line" ? "arrowhead=none" : null,
        object.text ? `label="${escapeQuoted(object.text)}"` : null,
        `penwidth=${round(Math.max(1, Number(object.strokeWidth || 2)) * 0.75)}`,
      ].filter(Boolean);
      rows.push(
        `  n${endpoints[0]} -> n${endpoints[1]} [${attributes.join(", ")}];`,
      );
    }
  }
  rows.push("}");
  return rows.join("\n");
}

function inferMermaidKind(objects) {
  if (
    objects.some((object) => object.mindMapChild || object.mindMapEdge) ||
    (objects[0]?.type === "ellipse" &&
      Math.abs(Number(objects[0].x) - 400) < 30 &&
      objects.filter((object) => object.type === "connector").length >= 3)
  )
    return "mindmap";
  const nodes = objects.filter((object) => nodeLike(object));
  if (
    nodes.length >= 3 &&
    nodes.every((object) => Number(object.y) < 170) &&
    objects.filter((object) => object.type === "arrow").length >= 2
  )
    return "sequence";
  if (nodes.filter((object) => object.type === "ellipse").length >= 2)
    return "state";
  return "flow";
}

function serializeMermaid(objects) {
  const kind = inferMermaidKind(objects);
  const nodes = objects
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => nodeLike(object));
  if (kind === "mindmap") {
    const root = nodes[0];
    const children = new Map();
    for (const edge of objects.filter((object) =>
      ["line", "arrow", "connector"].includes(object.type),
    )) {
      const endpoints = edgeEndpoints(edge, nodes);
      if (!endpoints) continue;
      const list = children.get(endpoints[0]) || [];
      list.push(endpoints[1]);
      children.set(endpoints[0], list);
    }
    const rows = [
      "mindmap",
      `  root((${escapeMermaid(root?.object?.text || "主题")}))`,
    ];
    const visited = new Set([root?.index]);
    const appendChildren = (parentIndex, depth) => {
      for (const childIndex of children.get(parentIndex) || []) {
        if (visited.has(childIndex)) continue;
        visited.add(childIndex);
        const child = nodes.find((node) => node.index === childIndex);
        rows.push(
          `${"  ".repeat(depth)}${escapeMermaid(child?.object?.text || "分支")}`,
        );
        appendChildren(childIndex, depth + 1);
      }
    };
    appendChildren(root?.index, 2);
    for (const { object, index } of nodes.slice(1)) {
      if (!visited.has(index))
        rows.push(`    ${escapeMermaid(object.text || "分支")}`);
    }
    return rows.join("\n");
  }
  if (kind === "sequence") {
    const rows = ["sequenceDiagram"];
    for (const { object, index } of nodes)
      rows.push(
        `  participant n${index} as ${escapeMermaid(object.text || `对象 ${index + 1}`)}`,
      );
    const edges = objects.filter((object) =>
      ["line", "arrow", "connector"].includes(object.type),
    );
    for (const edge of edges) {
      const endpoints = edgeEndpoints(edge, nodes);
      if (endpoints)
        rows.push(
          `  n${endpoints[0]}->>n${endpoints[1]}: ${escapeMermaid(edge.text || "交互")}`,
        );
    }
    if (!edges.length) {
      for (let index = 0; index < nodes.length - 1; index += 1)
        rows.push(
          `  n${nodes[index].index}->>n${nodes[index + 1].index}: 交互`,
        );
    }
    return rows.join("\n");
  }
  if (kind === "state") {
    const rows = ["stateDiagram-v2"];
    for (const { object, index } of nodes)
      rows.push(
        `  state "${escapeMermaid(object.text || `状态 ${index + 1}`)}" as n${index}`,
      );
    const edges = objects.filter((object) =>
      ["line", "arrow", "connector"].includes(object.type),
    );
    for (const edge of edges) {
      const endpoints = edgeEndpoints(edge, nodes);
      if (!endpoints) continue;
      rows.push(
        `  n${endpoints[0]} --> n${endpoints[1]}${edge.text ? `: ${escapeMermaid(edge.text)}` : ""}`,
      );
    }
    if (!edges.length) {
      for (let index = 0; index < nodes.length - 1; index += 1)
        rows.push(`  n${nodes[index].index} --> n${nodes[index + 1].index}`);
    }
    return rows.join("\n");
  }
  const rows = ["flowchart LR"];
  for (const { object, index } of nodes) {
    const label = escapeMermaid(object.text || `节点 ${index + 1}`);
    rows.push(
      object.type === "diamond"
        ? `  n${index}{"${label}"}`
        : object.type === "ellipse"
          ? `  n${index}(("${label}"))`
          : `  n${index}["${label}"]`,
    );
  }
  for (const object of objects.filter((item) =>
    ["line", "arrow", "connector"].includes(item.type),
  )) {
    const endpoints = edgeEndpoints(object, nodes);
    if (endpoints) {
      const label = object.text ? `|"${escapeMermaid(object.text)}"|` : "";
      rows.push(`  n${endpoints[0]} -->${label} n${endpoints[1]}`);
    }
  }
  for (const { object, index } of nodes) {
    const strokeWidth = round(Math.max(1, Number(object.strokeWidth || 2)));
    rows.push(
      `  style n${index} fill:${object.fill || "#EEF2FF"},stroke:${object.color || "#2563EB"},stroke-width:${strokeWidth}px`,
    );
  }
  return rows.join("\n");
}

function attachMetadata(profile, body, objects) {
  const metadata = metadataLine(profile, body, objects);
  if (profile === "svg_source") {
    return body.replace(/<svg\b([^>]*)>/i, `<svg$1><!-- ${metadata} -->`);
  }
  const prefix =
    profile === "mermaid" ? "%%" : profile === "graphviz_dot" ? "//" : "%";
  return `${prefix} ${metadata}\n${body}`;
}

export function serializeVisualDocument(profile, objects) {
  const normalizedProfile = [
    "svg_source",
    "tikz",
    "pgf_plots",
    "graphviz_dot",
    "mermaid",
  ].includes(profile)
    ? profile
    : "svg_source";
  const body =
    normalizedProfile === "svg_source"
      ? serializeVisualDrawing(objects)
      : normalizedProfile === "tikz"
        ? serializeTikz(objects)
        : normalizedProfile === "pgf_plots"
          ? serializePgfPlots(objects)
          : normalizedProfile === "graphviz_dot"
            ? serializeGraphviz(objects)
            : serializeMermaid(objects);
  return {
    language: ["tikz", "pgf_plots"].includes(normalizedProfile)
      ? "tikz"
      : normalizedProfile,
    packageProfiles: normalizedProfile === "pgf_plots" ? ["pgf_plots"] : [],
    graphvizEngine: normalizedProfile === "graphviz_dot" ? "neato" : null,
    source: attachMetadata(normalizedProfile, body, objects),
  };
}

function extractMetadata(profile, source) {
  const text = String(source || "");
  const escaped = CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${escaped}:([a-z_]+):([0-9a-f]{8}):([A-Za-z0-9_-]+)`,
  );
  const match = text.match(pattern);
  if (!match) return null;
  const body =
    profile === "svg_source"
      ? text.replace(/<!--\s*latexsnipper-visual-v1:[\s\S]*?-->\s*/i, "")
      : text.replace(
          /^\s*(?:%%|\/\/|%)\s*latexsnipper-visual-v1:[^\r\n]+\r?\n/i,
          "",
        );
  if (match[1] !== profile || hashSource(body) !== match[2]) return null;
  try {
    const payload = JSON.parse(base64UrlToUtf8(match[3]));
    if (
      payload?.version !== 1 ||
      payload?.profile !== profile ||
      !Array.isArray(payload?.objects)
    )
      return null;
    return { objects: payload.objects, body };
  } catch {
    return null;
  }
}

function parsePgfSubset(source) {
  const matches = [
    ...String(source).matchAll(/\\addplot\s*\[([^\]]*)\]\s*\{([^}]+)\}\s*;/g),
  ];
  if (!matches.length) return null;
  return matches.map((match, index) => {
    const domain = match[1].match(/domain\s*=\s*([-+\d.]+)\s*:\s*([-+\d.]+)/);
    return {
      id: `imported-plot-${index}`,
      profile: "pgf_plots",
      type: "plot",
      x: 385,
      y: 260,
      width: 300,
      height: 160,
      rotation: 0,
      color: "#7C3AED",
      fill: "#FFFFFF",
      strokeWidth: 4,
      text: "",
      expression: match[2].replace(/sin\(deg\(x\)\)/g, "sin(x)"),
      xMin: Number(domain?.[1] ?? -3),
      xMax: Number(domain?.[2] ?? 3),
    };
  });
}

function parseMermaidSubset(source) {
  const text = String(source || "");
  if (!/^\s*(?:flowchart|graph)\s+(?:LR|RL|TB|TD|BT)\b/m.test(text))
    return null;
  const definitions = new Map();
  const regex =
    /^\s*([\w-]+)\s*(\[|\{|\(\(|\()\s*["']?([^\]\})"']+)["']?\s*(?:\]|\}|\)\)|\))\s*$/gm;
  for (const match of text.matchAll(regex))
    definitions.set(match[1], { label: match[3].trim(), opener: match[2] });
  const ids = [...definitions.keys()];
  if (!ids.length) return null;
  return ids.map((id, index) => ({
    id: `imported-${id}`,
    profile: "mermaid",
    type:
      definitions.get(id).opener === "{"
        ? "diamond"
        : definitions.get(id).opener === "(("
          ? "ellipse"
          : "node",
    x: 150 + (index % 3) * 250,
    y: 150 + Math.floor(index / 3) * 170,
    width: 190,
    height: 90,
    rotation: 0,
    color: "#2563EB",
    fill: "#EEF2FF",
    strokeWidth: 4,
    text: definitions.get(id).label,
  }));
}

export function parseVisualDocument(profile, source) {
  const metadata = extractMetadata(profile, source);
  if (metadata) {
    return {
      ok: true,
      lossless: true,
      objects: structuredClone(metadata.objects),
      source: String(source),
      origin: "contract",
    };
  }
  const subset =
    profile === "pgf_plots"
      ? parsePgfSubset(source)
      : profile === "mermaid"
        ? parseMermaidSubset(source)
        : null;
  if (subset) {
    return {
      ok: true,
      lossless: false,
      objects: subset,
      source: String(source),
      origin: "supported-subset",
      warning:
        "已识别部分结构，但不能证明全部样式与选项可无损往返；源码和预览保持可用，可视化编辑已锁定",
    };
  }
  return {
    ok: false,
    lossless: false,
    objects: null,
    source: String(source),
    origin: "unsupported",
    warning:
      "当前源码包含尚不能无损反解析的语法；源码和预览保持可用，可视化编辑已锁定以防内容丢失",
  };
}

export function visualProfileKey(language, packageProfiles = []) {
  return packageProfiles.includes("pgf_plots") ? "pgf_plots" : language;
}
