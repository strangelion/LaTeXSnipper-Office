import {
  drawingAdapterReadiness,
  selectDrawingOfficeRoute,
} from "./office-routing.js";
import { renderDrawingLocally } from "./local-renderers.js";
import { createVisualDrawingEditor } from "./visual-editor.js";

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
    tikz: "\\node[draw, rounded corners] (A) at (0,0) {节点};",
    graphviz_dot: 'A [label="节点", shape=box];',
    mermaid: "A[节点]",
  },
  rectangle: {
    svg_source:
      '<rect x="60" y="50" width="200" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\node[draw, minimum width=3cm, minimum height=1.5cm] {矩形};",
  },
  ellipse: {
    svg_source:
      '<ellipse cx="160" cy="100" rx="100" ry="55" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\node[draw, ellipse, minimum width=3cm] {椭圆};",
  },
  diamond: {
    svg_source:
      '<path d="M160 35 L270 100 L160 165 L50 100 Z" fill="none" stroke="currentColor" stroke-width="4"/>',
    tikz: "\\node[draw, diamond, aspect=2] {判断};",
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

function setSelected(element, selected) {
  element?.classList?.toggle("active", selected);
  element?.setAttribute?.("aria-selected", String(selected));
  if (element) element.tabIndex = selected ? 0 : -1;
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
  loadReadiness,
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
    editorMode: "visual",
  };

  const status = (message) => {
    if (elements.status) elements.status.textContent = message;
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
    state.language = language;
    state.packageProfiles = button.dataset.drawingProfile
      ? [button.dataset.drawingProfile]
      : [];
    for (const candidate of elements.languageButtons) {
      candidate.classList?.toggle("active", candidate === button);
    }
    if (elements.source) {
      const preset = button.dataset.drawingProfile || language;
      elements.source.value =
        DEFAULT_SOURCES[preset] || DEFAULT_SOURCES[language] || "";
    }
    state.lastResult = null;
    if (elements.insertButton) elements.insertButton.disabled = true;
    setEditorMode(language === "svg_source" ? state.editorMode : "source");
    status("源码已切换，本地安全预览已排队");
    schedulePreview();
  };

  const compile = async ({ automatic = false } = {}) => {
    if (state.compiling) return null;
    const revision = ++state.revision;
    state.compiling = true;
    state.lastResult = null;
    if (elements.compileButton) elements.compileButton.disabled = true;
    if (elements.insertButton) elements.insertButton.disabled = true;
    status("正在安全编译…");
    try {
      const drawingId =
        globalThis.crypto?.randomUUID?.() || `drawing-${Date.now()}`;
      const originalSource = elements.source?.value || "";
      const renderedSvg = renderLocal
        ? await renderLocal({
            language: state.language,
            source: originalSource,
            packageProfiles: state.packageProfiles,
            graphvizEngine: elements.graphvizEngine?.value || "dot",
            previewHost: elements.preview,
            renderId: drawingId,
          })
        : null;
      if (revision !== state.revision) return null;
      if (renderedSvg && elements.preview) {
        elements.preview.innerHTML = renderedSvg;
        fitDrawingPreview(elements.preview);
        status("本地预览已生成，正在由 Core 执行安全校验…");
      }
      let result;
      try {
        result = await compileDrawing({
          drawingId,
          language: renderedSvg ? "svg_source" : state.language,
          source: renderedSvg || originalSource,
          packageProfiles: renderedSvg ? [] : state.packageProfiles,
          packageLockSha256: null,
          rendererId: renderedSvg ? `bundled-${state.language}@1` : null,
        });
      } catch (error) {
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
      result.originalLanguage = state.language;
      state.lastResult = result;
      if (elements.preview) {
        elements.preview.innerHTML = result.svg;
        fitDrawingPreview(elements.preview);
      }
      if (elements.insertButton) elements.insertButton.disabled = false;
      status(
        `${automatic ? "实时预览" : "编译完成"} · ${result.payload.widthPoints} × ${result.payload.heightPoints} pt · 本地离线`,
      );
      return result;
    } catch (error) {
      status(`编译失败：${userFacingError(error)}`);
      return null;
    } finally {
      state.compiling = false;
      if (elements.compileButton) elements.compileButton.disabled = false;
    }
  };

  function schedulePreview() {
    if (!state.autoPreview) return;
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(
      () => void compile({ automatic: true }),
      520,
    );
  }

  let visualEditor = null;
  const setEditorMode = (mode) => {
    const visualAvailable = state.language === "svg_source";
    state.editorMode =
      mode === "visual" && visualAvailable ? "visual" : "source";
    const visual = state.editorMode === "visual";
    if (elements.visualEditor) elements.visualEditor.hidden = !visual;
    if (elements.sourceEditor) elements.sourceEditor.hidden = visual;
    elements.visualModeButton?.classList?.toggle("active", visual);
    elements.sourceModeButton?.classList?.toggle("active", !visual);
    elements.visualModeButton?.setAttribute("aria-selected", String(visual));
    elements.sourceModeButton?.setAttribute("aria-selected", String(!visual));
    if (elements.visualModeButton) {
      elements.visualModeButton.disabled = !visualAvailable;
      elements.visualModeButton.title = visualAvailable
        ? ""
        : "当前语言使用源码编辑器与实时预览";
    }
    visualEditor?.setEnabled(visual);
    if (visual) visualEditor?.commit();
  };

  if (elements.visualCanvas) {
    visualEditor = createVisualDrawingEditor({
      canvas: elements.visualCanvas,
      onSourceChange: (source) => {
        if (elements.source) elements.source.value = source;
        state.lastResult = null;
        if (elements.insertButton) elements.insertButton.disabled = true;
        status("可视化图形已同步，安全预览已排队");
        schedulePreview();
      },
    });
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
      const report = await copyDrawing({
        source: state.lastResult.originalSource || elements.source?.value || "",
        svg: state.lastResult.svg,
        pngBase64: null,
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
  elements.visualModeButton?.addEventListener("click", () =>
    setEditorMode("visual"),
  );
  elements.sourceModeButton?.addEventListener("click", () =>
    setEditorMode("source"),
  );
  elements.compileButton?.addEventListener("click", compile);
  elements.insertButton?.addEventListener("click", insert);
  elements.copyButton?.addEventListener("click", copy);
  elements.source?.addEventListener("input", () => {
    state.lastResult = null;
    if (elements.insertButton) elements.insertButton.disabled = true;
    status("正在等待输入稳定…");
    schedulePreview();
  });
  elements.autoPreview?.addEventListener("change", () => {
    state.autoPreview = elements.autoPreview.checked;
    if (state.autoPreview) schedulePreview();
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
  for (const tool of elements.toolButtons || []) {
    tool.addEventListener("click", () => {
      if (
        state.editorMode === "visual" &&
        state.language === "svg_source" &&
        visualEditor
      ) {
        visualEditor.add(tool.dataset.drawingTool);
        status("对象已添加；可直接拖动、缩放或旋转");
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
      schedulePreview();
    });
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
    compileButton: root.getElementById("drawingCompileBtn"),
    insertButton: root.getElementById("drawingInsertBtn"),
    copyButton: root.getElementById("drawingCopyBtn"),
    autoPreview: root.getElementById("drawingAutoPreview"),
    gridToggle: root.getElementById("drawingGridToggle"),
    zoom: root.getElementById("drawingZoom"),
    zoomValue: root.getElementById("drawingZoomValue"),
    graphvizEngine: root.getElementById("drawingGraphvizEngine"),
    toolButtons: [...root.querySelectorAll("[data-drawing-tool]")],
    status: root.getElementById("drawingCompileStatus"),
    preview: root.getElementById("drawingPreview"),
    readiness: root.getElementById("drawingReadiness"),
  };
}

export function initDrawingWorkspace({
  invoke,
  insertDrawing,
  root = document,
}) {
  const controller = createDrawingWorkspaceController({
    elements: drawingWorkspaceElements(root),
    compileDrawing: (request) => invoke("compile_drawing_svg", { request }),
    renderLocal: renderDrawingLocally,
    insertDrawing,
    copyDrawing: (request) => invoke("copy_drawing_bundle", { request }),
    loadReadiness: () => invoke("get_drawing_readiness"),
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
