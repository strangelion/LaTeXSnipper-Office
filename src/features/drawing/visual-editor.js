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
    text: type === "label" ? "标注" : "节点",
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

function objectBody(object) {
  const width = object.width;
  const height = object.height;
  const x = -width / 2;
  const y = -height / 2;
  switch (object.type) {
    case "line":
      return `<path d="M${x} 0H${width / 2}" fill="none" stroke="${object.color}" stroke-width="7" stroke-linecap="round"/>`;
    case "arrow":
    case "connector":
      return `<path d="M${x} 0H${width / 2}" fill="none" stroke="${object.color}" stroke-width="7" stroke-linecap="round" marker-end="url(#drawing-arrow)"/>`;
    case "ellipse":
      return `<ellipse rx="${width / 2}" ry="${height / 2}" fill="${object.fill}" stroke="${object.color}" stroke-width="6"/>`;
    case "diamond":
      return `<path d="M0 ${y}L${width / 2} 0L0 ${height / 2}L${x} 0Z" fill="${object.fill}" stroke="${object.color}" stroke-width="6"/>`;
    case "label":
      return `<text x="0" y="12" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="42" fill="${object.color}">${escapeXml(object.text)}</text>`;
    case "axes":
      return `<path d="M${x} 0H${width / 2}M0 ${height / 2}V${y}" fill="none" stroke="${object.color}" stroke-width="5" marker-end="url(#drawing-arrow)"/><text x="${width / 2 - 18}" y="-14" font-size="30" fill="${object.color}">x</text><text x="16" y="${y + 28}" font-size="30" fill="${object.color}">y</text>`;
    case "plot": {
      const points = Array.from({ length: 41 }, (_, index) => {
        const ratio = index / 40;
        const pointX = x + width * ratio;
        const pointY = Math.sin(ratio * Math.PI * 2) * (-height * 0.4);
        return `${pointX.toFixed(1)},${pointY.toFixed(1)}`;
      }).join(" ");
      return `<polyline points="${points}" fill="none" stroke="${object.color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "node":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24" fill="${object.fill}" stroke="${object.color}" stroke-width="6"/><text x="0" y="12" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="36" fill="#172033">${escapeXml(object.text)}</text>`;
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${object.fill}" stroke="${object.color}" stroke-width="6"/>`;
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}"><defs><marker id="drawing-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>${content}</svg>`;
}

export function createVisualDrawingEditor({ canvas, onSourceChange }) {
  const state = {
    objects: [createObject("node", 0), createObject("arrow", 1)],
    selectedId: null,
    drag: null,
    frame: null,
    enabled: true,
  };
  const selected = () =>
    state.objects.find((object) => object.id === state.selectedId) || null;
  const render = () => {
    state.frame = null;
    canvas.innerHTML = `<svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" role="img" aria-label="可视化绘图画布"><defs><marker id="drawing-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>${state.objects.map((object) => objectMarkup(object, object.id === state.selectedId)).join("")}</svg>`;
  };
  const scheduleRender = () => {
    if (state.frame !== null) return;
    state.frame = requestAnimationFrame(render);
  };
  const commit = () => onSourceChange?.(serializeVisualDrawing(state.objects));
  const point = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * VIEW_WIDTH) / bounds.width,
      y: ((event.clientY - bounds.top) * VIEW_HEIGHT) / bounds.height,
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
      object.rotation =
        Math.round(
          (state.drag.rotation + ((angle - state.drag.angle) * 180) / Math.PI) /
            5,
        ) * 5;
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

  const add = (type) => {
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
    ]);
    const object = createObject(
      supported.has(type) ? type : "rectangle",
      state.objects.length,
    );
    state.objects.push(object);
    state.selectedId = object.id;
    render();
    commit();
  };
  const setEnabled = (enabled) => {
    state.enabled = Boolean(enabled);
    canvas.classList.toggle("is-disabled", !state.enabled);
  };
  render();
  commit();
  return { state, add, setEnabled, commit };
}
