import {
  drawingAdapterReadiness,
  selectDrawingOfficeRoute,
} from "./office-routing.js";

const DEFAULT_SOURCES = Object.freeze({
  svg_source:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="12" y="12" width="296" height="156" rx="18" fill="#eef2ff" stroke="#4f46e5" stroke-width="4"/><path d="M72 112 L140 52 L248 126" fill="none" stroke="#0f172a" stroke-width="6"/><circle cx="140" cy="52" r="9" fill="#4f46e5"/></svg>',
  tikz: "\\draw[->, thick] (0,0) -- (3,0) node[right] {$x$};\n\\draw[->, thick] (0,0) -- (0,2) node[above] {$y$};",
  graphviz_dot: "digraph G { rankdir=LR; Input -> Parse -> Office; }",
});

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
  insertDrawing,
  loadReadiness,
}) {
  const state = {
    mode: "formula",
    language: "svg_source",
    packageProfiles: [],
    compiling: false,
    lastResult: null,
  };

  const status = (message) => {
    if (elements.status) elements.status.textContent = message;
  };

  const activateMode = (mode) => {
    state.mode = mode === "drawing" ? "drawing" : "formula";
    const drawing = state.mode === "drawing";
    setSelected(elements.formulaTab, !drawing);
    setSelected(elements.drawingTab, drawing);
    if (elements.formulaWorkspace) elements.formulaWorkspace.hidden = drawing;
    if (elements.drawingWorkspace) elements.drawingWorkspace.hidden = !drawing;
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
    if (elements.source)
      elements.source.value = DEFAULT_SOURCES[language] || "";
    state.lastResult = null;
    if (elements.insertButton) elements.insertButton.disabled = true;
    status("源码已切换，请安全编译");
  };

  const compile = async () => {
    if (state.compiling) return null;
    state.compiling = true;
    state.lastResult = null;
    if (elements.compileButton) elements.compileButton.disabled = true;
    if (elements.insertButton) elements.insertButton.disabled = true;
    status("正在安全编译…");
    try {
      const result = await compileDrawing({
        drawingId: globalThis.crypto?.randomUUID?.() || `drawing-${Date.now()}`,
        language: state.language,
        source: elements.source?.value || "",
        packageProfiles: state.packageProfiles,
        packageLockSha256: null,
        rendererId: null,
      });
      if (!result?.success || !result.payload || !result.svg) {
        throw new Error(result?.error || "DRAWING_COMPILE_FAILED");
      }
      state.lastResult = result;
      if (elements.preview) elements.preview.innerHTML = result.svg;
      if (elements.insertButton) elements.insertButton.disabled = false;
      status(
        `编译完成 · ${result.payload.widthPoints} × ${result.payload.heightPoints} pt`,
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

  const refreshReadiness = async () => {
    try {
      const readiness = await loadReadiness();
      const adapters = drawingAdapterReadiness(readiness);
      if (elements.readiness) {
        elements.readiness.textContent = adapters
          .map((adapter) => {
            const stateLabel = adapter.blocked
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
  for (const tab of [elements.formulaTab, elements.drawingTab]) {
    tab?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next =
        state.mode === "formula" ? elements.drawingTab : elements.formulaTab;
      activateMode(state.mode === "formula" ? "drawing" : "formula");
      next?.focus?.();
    });
  }
  for (const button of elements.languageButtons) {
    button.addEventListener("click", () => chooseLanguage(button));
  }
  elements.compileButton?.addEventListener("click", compile);
  elements.insertButton?.addEventListener("click", insert);
  activateMode("formula");

  return {
    state,
    activateMode,
    chooseLanguage,
    compile,
    insert,
    refreshReadiness,
  };
}

export function drawingWorkspaceElements(root = document) {
  return {
    formulaTab: root.getElementById("formulaModeTab"),
    drawingTab: root.getElementById("drawingModeTab"),
    formulaWorkspace: root.getElementById("formulaWorkspace"),
    drawingWorkspace: root.getElementById("drawingWorkspace"),
    languageButtons: [...root.querySelectorAll("[data-drawing-language]")],
    source: root.getElementById("drawingSource"),
    compileButton: root.getElementById("drawingCompileBtn"),
    insertButton: root.getElementById("drawingInsertBtn"),
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
    insertDrawing,
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
