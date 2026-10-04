import { router } from "core-protocol/command.router";
import { OfficeHostAdapter } from "../adapters/unified-adapter";
import { WordSelectionLatex } from "../adapters/word-selection-latex";
import { OfficeBridgeClient } from "../adapters/bridge-client";
import {
  openFormatConversionDialog,
  downloadFormatArtifact,
  type FormatArtifact,
} from "../../../../src/services/office-format-conversion.js";
import "../../../../src/services/office-format-conversion.css";

type InsertMode = "inline" | "display" | "display-numbered";
type StatusType = "info" | "success" | "error";
interface CapabilityResult {
  host: string;
  insertFormula: boolean;
  readFormula: boolean;
  replaceFormula: boolean;
  deleteFormula: boolean;
  numberedFormula: boolean;
  persistentMetadata: boolean;
  equationReference: boolean;
  diagnostic?: string;
}

let registered = false;
let busy = false;
let capabilities: CapabilityResult | null = null;
let selectedFormulaId: string | undefined;
let bridgeConnected = false;
let selectionConversion: WordSelectionLatex | null = null;
let selectionPreviewUrl: string | null = null;

const CLIENT_ID_KEY = "latexsnipper-office-client-id";

function getClientId(): string {
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

async function resolveDocumentContext(): Promise<string> {
  const directUrl = Office.context.document.url;
  if (directUrl && directUrl.trim().length > 0) return directUrl;
  return await new Promise<string>((resolve) => {
    try {
      Office.context.document.getFilePropertiesAsync((result) => {
        if (
          result.status === Office.AsyncResultStatus.Succeeded &&
          result.value?.url
        ) {
          resolve(result.value.url);
        } else {
          resolve("unsaved:" + getClientId());
        }
      });
    } catch {
      resolve("unsaved:" + getClientId());
    }
  });
}

const bridgeBase = (() => {
  const { hostname, port } = window.location;
  return (hostname === "127.0.0.1" || hostname === "localhost") &&
    port === "19876"
    ? ""
    : "https://127.0.0.1:19876";
})();

function ensureAdapter(): void {
  if (!registered) {
    router.register("office", new OfficeHostAdapter());
    registered = true;
  }
}

async function exec(command: any): Promise<any> {
  ensureAdapter();
  return router.dispatch("office", command);
}

Office.onReady((info) => {
  ensureAdapter();
  document
    .getElementById("formatConversionBtn")
    ?.addEventListener("click", () => void handleFormatConversion());
  const hostName = info.host ? String(info.host) : "Office";
  setText("hostLabel", hostName);
  document
    .getElementById("selectionLatexBtn")
    ?.addEventListener("click", () => void handleSelectionLatex());
  document
    .getElementById("confirmSelectionLatexBtn")
    ?.addEventListener("click", () => void handleConfirmSelectionLatex());
  document
    .getElementById("cancelSelectionLatexBtn")
    ?.addEventListener("click", () => void cancelSelectionLatex());
  document
    .getElementById("loadBtn")
    ?.addEventListener("click", () => void handleLoad());
  document
    .getElementById("insertBtn")
    ?.addEventListener("click", () => void handleInsert());
  document
    .getElementById("updateBtn")
    ?.addEventListener("click", () => void handleUpdate());
  document
    .getElementById("deleteBtn")
    ?.addEventListener("click", () => void handleDelete());
  document
    .getElementById("referenceBtn")
    ?.addEventListener("click", () => void handleReference());
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-workspace]",
  )) {
    button.addEventListener(
      "click",
      () => void handleOpenWorkspace(button.dataset.workspace || "editor"),
    );
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-convert-format]",
  )) {
    button.addEventListener(
      "click",
      () => void handleConvert(button.dataset.convertFormat || "omml"),
    );
  }
  document
    .getElementById("modeSelect")
    ?.addEventListener("change", updateNumberingControls);
  document
    .getElementById("layoutProfile")
    ?.addEventListener("change", updateNumberingPreview);
  document.getElementById("editor")?.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void (selectedFormulaId ? handleUpdate() : handleInsert());
    }
  });
  void initializeHost(hostName);
});

async function initializeHost(host: string): Promise<void> {
  setStatus("正在检查 Office 宿主能力…");
  const result = await exec({ type: "GetHostCapabilities", payload: {} });
  capabilities = result.ok ? (result.data as CapabilityResult) : null;
  applyCapabilities();
  await updateBridgeState(host);
  window.setInterval(() => void updateBridgeState(host), 10000);
  window.setInterval(() => void pollActions(), 1000);
  setStatus(
    capabilities ? "已就绪" : result.error || "不支持当前 Office 宿主",
    capabilities ? "success" : "error",
  );
}

async function updateBridgeState(host: string): Promise<void> {
  let connected = false;
  try {
    const response = await fetch(`${bridgeBase}/api/office/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: getClientId(),
        host,
        documentContext: await resolveDocumentContext(),
        documentTitle: document.title || null,
      }),
    });
    connected = response.ok;
  } catch {
    connected = false;
  }
  setText("bridgeStatus", `桥接服务：${connected ? "已连接" : "离线"}`);
  setConnectionState("bridgeChip", connected ? "ready" : "offline");
  bridgeConnected = connected;
  applyBridgeCapabilities();
}

function applyCapabilities(): void {
  const map: Array<[string, keyof CapabilityResult]> = [
    ["loadBtn", "readFormula"],
    ["insertBtn", "insertFormula"],
    ["updateBtn", "replaceFormula"],
    ["deleteBtn", "deleteFormula"],
  ];
  for (const [id, key] of map) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.disabled = busy || !capabilities?.[key];
  }
  const referenceButton = document.getElementById(
    "referenceBtn",
  ) as HTMLButtonElement | null;
  if (referenceButton)
    referenceButton.disabled =
      busy || !capabilities?.equationReference || !selectedFormulaId;
  setText(
    "capabilityStatus",
    capabilities ? `宿主：${capabilities.host}` : "宿主：不支持",
  );
  setConnectionState("capabilityChip", capabilities ? "ready" : "offline");
  setText(
    "selectionStatus",
    selectedFormulaId ? "已加载可编辑公式" : "尚未加载公式",
  );
  updateNumberingControls();
  applyBridgeCapabilities();
}

function applyBridgeCapabilities(): void {
  const formatButton = document.getElementById(
    "formatConversionBtn",
  ) as HTMLButtonElement | null;
  if (formatButton) formatButton.disabled = busy;
  const selectionButton = document.getElementById(
    "selectionLatexBtn",
  ) as HTMLButtonElement | null;
  if (selectionButton)
    selectionButton.disabled =
      busy || !bridgeConnected || capabilities?.host !== "word";
  const confirm = document.getElementById(
    "confirmSelectionLatexBtn",
  ) as HTMLButtonElement | null;
  if (confirm)
    confirm.disabled = busy || !bridgeConnected || !selectionConversion;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-workspace], [data-convert-format]",
  )) {
    button.dataset.connectedTitle ??= button.title;
    button.disabled = busy || !bridgeConnected;
    button.title = bridgeConnected
      ? button.dataset.connectedTitle || ""
      : "需要启动 LaTeXSnipper 桌面端并连接本地桥接服务";
  }
}

type PaneConversion =
  | {
      kind: "selection";
      latex: string;
      svg: string;
      controller: WordSelectionLatex;
    }
  | { kind: "export"; latex: string; artifact: FormatArtifact };

async function handleFormatConversion(): Promise<void> {
  if (busy) return;
  setBusy(true);
  try {
    await selectionConversion?.cancel();
    selectionConversion = null;
    clearSelectionPreview();
    const bridge = new OfficeBridgeClient();
    const latex = getEditorContent();
    const mode = modeToDisplay(getInsertMode());
    const answer = await openFormatConversionDialog<PaneConversion>({
      context: {
        native: false,
        connected: bridgeConnected,
        host: capabilities?.host,
        documentContext: await resolveDocumentContext(),
        documentTitle: Office.context.document.url || "当前未保存文档",
        managed: false,
        editor: Boolean(latex.trim()),
        engine: bridgeConnected,
        ole: false,
      },
      prepare: async ({ source, format }) => {
        if (source === "selection") {
          const controller = new WordSelectionLatex(bridge);
          try {
            const prepared = await controller.prepare();
            return { ...prepared, kind: "selection", controller };
          } catch (error) {
            await controller.cancel();
            throw error;
          }
        }
        if (
          source !== "editor" ||
          !["latex", "omml", "svg", "png"].includes(format)
        )
          throw new Error("此 Office.js 宿主不支持该转换路径");
        const content =
          format === "latex"
            ? latex
            : (
                await bridge.convert(
                  "latex",
                  format as "omml" | "svg" | "png",
                  latex,
                  mode,
                )
              ).content;
        return {
          kind: "export",
          latex,
          artifact: {
            content,
            filename: `formula.${format === "latex" ? "tex" : format}`,
            mime:
              format === "svg"
                ? "image/svg+xml"
                : format === "png"
                  ? "image/png"
                  : format === "omml"
                    ? "application/xml;charset=utf-8"
                    : "text/plain;charset=utf-8",
            base64: format === "png",
          },
        };
      },
      renderPreview: async (prepared) => {
        if (
          prepared.kind === "export" &&
          prepared.artifact.filename.endsWith(".tex")
        ) {
          const code = document.createElement("pre");
          code.textContent = prepared.latex;
          return code;
        }
        if (prepared.kind === "export" && prepared.artifact.base64) {
          const image = document.createElement("img");
          image.alt = "导出 PNG 预览";
          image.src = `data:image/png;base64,${prepared.artifact.content.replace(/^data:image\/png;base64,/, "")}`;
          await image.decode();
          return image;
        }
        const svg =
          prepared.kind === "selection"
            ? prepared.svg
            : prepared.artifact.mime === "image/svg+xml"
              ? prepared.artifact.content
              : (await bridge.convert("latex", "svg", prepared.latex, mode))
                  .content;
        const url = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        const image = document.createElement("img");
        image.alt = "公式转换预览";
        image.src = url;
        try {
          await image.decode();
          return image;
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      dispose: async (prepared) => {
        if (prepared.kind === "selection") await prepared.controller.cancel();
      },
    });
    if (!answer) {
      setStatus("已取消，文档未修改");
      return;
    }
    if (answer.prepared.kind === "export") {
      downloadFormatArtifact(answer.prepared.artifact);
      setStatus("已导出副本，文档未修改", "success");
    } else {
      const payload = await answer.prepared.controller.confirm();
      selectedFormulaId = payload.formulaId;
      setEditorContent(payload.latex);
      setStatus("选区已转换为行内 OMML", "success");
    }
  } catch (error) {
    setStatus(`格式转换未完成：${String(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

function clearSelectionPreview(): void {
  const panel = document.getElementById("selectionLatexPreview");
  if (panel) panel.hidden = true;
  const image = document.getElementById(
    "selectionLatexImage",
  ) as HTMLImageElement | null;
  image?.removeAttribute("src");
  if (selectionPreviewUrl) URL.revokeObjectURL(selectionPreviewUrl);
  selectionPreviewUrl = null;
}

async function cancelSelectionLatex(): Promise<void> {
  if (busy) return;
  setBusy(true);
  const pending = selectionConversion;
  selectionConversion = null;
  clearSelectionPreview();
  try {
    await pending?.cancel();
    setStatus("已取消，Word 原文未修改");
  } catch (error) {
    setStatus(`释放选区失败：${String(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleSelectionLatex(): Promise<void> {
  if (busy || !bridgeConnected || capabilities?.host !== "word") return;
  setBusy(true);
  setStatus("正在预览 Word 选区，尚未修改文档…");
  try {
    await selectionConversion?.cancel();
    selectionConversion = null;
    clearSelectionPreview();
    const pending = new WordSelectionLatex();
    // Retain ownership even if image decoding fails, so the range is released.
    selectionConversion = pending;
    const prepared = await pending.prepare();
    const image = document.getElementById(
      "selectionLatexImage",
    ) as HTMLImageElement;
    selectionPreviewUrl = URL.createObjectURL(
      new Blob([prepared.svg], { type: "image/svg+xml" }),
    );
    image.src = selectionPreviewUrl;
    await image.decode();
    setText("selectionLatexSource", prepared.source);
    const panel = document.getElementById("selectionLatexPreview");
    if (panel) panel.hidden = false;
    setStatus("预览就绪。确认后仅替换此选区为行内 OMML；原文变化会拒绝替换");
  } catch (error) {
    const pending = selectionConversion;
    selectionConversion = null;
    clearSelectionPreview();
    try {
      await pending?.cancel();
    } finally {
      setStatus(`选区预览失败，原文未修改：${String(error)}`, "error");
    }
  } finally {
    setBusy(false);
  }
}

async function handleConfirmSelectionLatex(): Promise<void> {
  if (busy || !selectionConversion || !bridgeConnected) return;
  setBusy(true);
  const pending = selectionConversion;
  selectionConversion = null;
  clearSelectionPreview();
  setStatus("正在替换预览时的选区…");
  try {
    const payload = await pending.confirm();
    selectedFormulaId = payload.formulaId;
    setEditorContent(payload.latex);
    setStatus("选区已转换为可回读的行内 Word 公式", "success");
  } catch (error) {
    setStatus(`选区替换失败，请检查原文后重新预览：${String(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

function updateNumberingControls(): void {
  const modeSelect = document.getElementById(
    "modeSelect",
  ) as HTMLSelectElement | null;
  const option = modeSelect?.querySelector(
    'option[value="numbered"]',
  ) as HTMLOptionElement | null;
  if (option) option.disabled = !capabilities?.numberedFormula;
  if (modeSelect?.value === "numbered" && !capabilities?.numberedFormula)
    modeSelect.value = "display";
  const enabled =
    modeSelect?.value === "numbered" && Boolean(capabilities?.numberedFormula);
  const options = document.getElementById("numberingOptions");
  if (options) options.hidden = !enabled;
  for (const id of ["layoutProfile", "equationLabel"]) {
    const control = document.getElementById(id) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (control) control.disabled = !enabled;
  }
  updateNumberingPreview();
}

function updateNumberingPreview(): void {
  const profile = (
    document.getElementById("layoutProfile") as HTMLSelectElement | null
  )?.value;
  const preview =
    profile === "chapter-dot"
      ? "(2.1)"
      : profile === "chapter-hyphen"
        ? "(2-1)"
        : "(1)";
  setText(
    "numberingPreview",
    getInsertMode() === "display-numbered" ? `编号预览：${preview}` : "",
  );
}

async function handleLoad(): Promise<void> {
  if (busy) return;
  setBusy(true);
  setStatus("正在加载选中的公式…");
  try {
    const result = await exec({ type: "GetSelectedFormula", payload: {} });
    if (!result.ok || !result.data) {
      setStatus(result.error || "当前选区没有受支持的公式", "error");
      return;
    }
    selectedFormulaId = result.data.formulaId;
    setEditorContent(result.data.latex);
    const mode = document.getElementById(
      "modeSelect",
    ) as HTMLSelectElement | null;
    if (mode)
      mode.value =
        result.data.displayMode === "numbered"
          ? "numbered"
          : result.data.displayMode === "inline"
            ? "inline"
            : "display";
    updateNumberingControls();
    setStatus(`已加载公式（${result.data.source}）`, "success");
  } finally {
    setBusy(false);
  }
}

async function handleInsert(): Promise<void> {
  const latex = getEditorContent();
  if (!latex) {
    setStatus("请先输入 LaTeX 公式", "error");
    return;
  }
  if (busy) return;
  setBusy(true);
  setStatus("正在插入公式…");
  try {
    const result = await exec({
      type: "InsertFormula",
      payload: buildPayload(latex, false),
    });
    if (result.ok) {
      selectedFormulaId = result.data?.formulaId;
      setStatus("公式已插入", "success");
    } else setStatus(`插入失败：${result.error}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleUpdate(): Promise<void> {
  const latex = getEditorContent();
  if (!latex) {
    setStatus("请先输入 LaTeX 公式", "error");
    return;
  }
  if (busy) return;
  setBusy(true);
  setStatus("正在更新选中的公式…");
  try {
    const result = await exec({
      type: "ReplaceSelectedFormula",
      payload: buildPayload(latex, true),
    });
    if (result.ok) {
      selectedFormulaId = result.data?.formulaId;
      setStatus("公式已原位更新", "success");
    } else setStatus(`更新失败：${result.error}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleDelete(): Promise<void> {
  if (busy) return;
  setBusy(true);
  setStatus("正在删除公式…");
  try {
    const result = await exec({ type: "DeleteSelectedFormula", payload: {} });
    if (result.ok) {
      selectedFormulaId = undefined;
      setStatus("公式已删除", "success");
    } else setStatus(`删除失败：${result.error}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleReference(): Promise<void> {
  if (!selectedFormulaId) {
    setStatus("请先加载一个编号公式，再插入其交叉引用", "error");
    return;
  }
  if (busy) return;
  setBusy(true);
  setStatus("正在插入公式交叉引用…");
  try {
    const result = await exec({
      type: "InsertEquationReference",
      payload: { formulaId: selectedFormulaId },
    });
    setStatus(
      result.ok ? "公式交叉引用已插入" : `插入交叉引用失败：${result.error}`,
      result.ok ? "success" : "error",
    );
  } finally {
    setBusy(false);
  }
}

async function handleOpenWorkspace(workspace: string): Promise<void> {
  if (!bridgeConnected || busy) {
    setStatus("请先启动 LaTeXSnipper 桌面端", "error");
    return;
  }
  setBusy(true);
  setStatus("正在打开桌面工作区…");
  try {
    const response = await fetch(`${bridgeBase}/api/office/open-workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    });
    const result = await response.json().catch(() => null);
    setStatus(
      response.ok && result?.success
        ? "已在桌面端打开对应工作区"
        : `打开失败：${result?.message || response.status}`,
      response.ok && result?.success ? "success" : "error",
    );
  } catch (error) {
    setStatus(`打开失败：${String(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleConvert(targetFormat: string): Promise<void> {
  const latex = getEditorContent();
  if (!latex) {
    setStatus("请先输入要转换的 LaTeX 公式", "error");
    return;
  }
  if (!bridgeConnected || busy) {
    setStatus("公式转换需要连接 LaTeXSnipper 桌面端", "error");
    return;
  }
  setBusy(true);
  setStatus(`正在转换为 ${targetFormat.toUpperCase()}…`);
  try {
    const response = await fetch(`${bridgeBase}/api/office/convert/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceFormat: "latex",
        targetFormat,
        content: latex,
        displayMode: getInsertMode(),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result?.success || !result?.content) {
      throw new Error(result?.diagnostic || `HTTP ${response.status}`);
    }
    await copyText(result.content);
    setStatus(`${targetFormat.toUpperCase()} 已转换并复制到剪贴板`, "success");
  } catch (error) {
    setStatus(`转换失败：${String(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw new Error("浏览器拒绝访问剪贴板");
  }
}

function buildPayload(
  latex: string,
  preserveIdentity: boolean,
): Record<string, string | undefined> {
  const layoutProfileId = (
    document.getElementById("layoutProfile") as HTMLSelectElement | null
  )?.value;
  const equationLabel =
    (
      document.getElementById("equationLabel") as HTMLInputElement | null
    )?.value.trim() || undefined;
  return {
    latex,
    display: modeToDisplay(getInsertMode()),
    formulaId: preserveIdentity ? selectedFormulaId : undefined,
    layoutProfileId,
    equationLabel,
  };
}

async function pollActions(): Promise<void> {
  try {
    const response = await fetch(
      `${bridgeBase}/api/office/actions/next?clientId=${encodeURIComponent(getClientId())}`,
    );
    if (!response.ok) return;
    const result = await response.json();
    if (!result.action || !result.actionId) return;
    if (result.expectedDocumentContext) {
      const currentContext = await resolveDocumentContext();
      if (result.expectedDocumentContext !== currentContext) {
        await fetch(`${bridgeBase}/api/office/actions/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionId: result.actionId,
            success: false,
            error: "CONTEXT_CHANGED",
          }),
        });
        return;
      }
    }
    const execution = await executeBridgeAction(result.action);
    await fetch(`${bridgeBase}/api/office/actions/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: result.actionId,
        success: execution.success,
        error: execution.error ?? null,
      }),
    });
  } catch {
    /* bridge temporarily offline */
  }
}

function bridgeModeToDisplay(mode: string): "inline" | "block" | "numbered" {
  switch (mode) {
    case "display":
      return "block";
    case "display-numbered":
    case "numbered":
      return "numbered";
    default:
      return "inline";
  }
}

interface BridgeActionResult {
  success: boolean;
  error?: string;
}

async function executeBridgeAction(action: any): Promise<BridgeActionResult> {
  if (action.type === "InsertFormula") {
    const latex = action.latex ?? "";
    setEditorContent(latex);
    const result = await exec({
      type: "InsertFormula",
      payload: {
        latex,
        display: bridgeModeToDisplay(action.mode ?? "inline"),
      },
    });
    setStatus(
      result.ok ? "公式已自动插入" : `自动插入失败：${result.error}`,
      result.ok ? "success" : "error",
    );
    return {
      success: result.ok,
      error: result.ok ? undefined : result.error,
    };
  }
  return {
    success: false,
    error: `不支持的操作：${action.type}`,
  };
}

function setBusy(value: boolean): void {
  busy = value;
  document.getElementById("app")?.setAttribute("aria-busy", String(value));
  applyCapabilities();
  applyBridgeCapabilities();
}

function setStatus(message: string, type: StatusType = "info"): void {
  const element = document.getElementById("status");
  if (!element) return;
  element.textContent = message;
  element.className = `status ${type}`;
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setConnectionState(
  id: string,
  state: "checking" | "ready" | "offline",
): void {
  document.getElementById(id)?.setAttribute("data-state", state);
}

function getEditorContent(): string {
  return (
    (
      document.getElementById("editor") as HTMLTextAreaElement | null
    )?.value.trim() || ""
  );
}

function setEditorContent(value: string): void {
  const editor = document.getElementById(
    "editor",
  ) as HTMLTextAreaElement | null;
  if (editor) editor.value = value;
}

function getInsertMode(): InsertMode {
  const value = (
    document.getElementById("modeSelect") as HTMLSelectElement | null
  )?.value;
  return value === "numbered"
    ? "display-numbered"
    : value === "inline"
      ? "inline"
      : "display";
}

function modeToDisplay(mode: InsertMode): "inline" | "block" | "numbered" {
  return mode === "inline"
    ? "inline"
    : mode === "display-numbered"
      ? "numbered"
      : "block";
}
