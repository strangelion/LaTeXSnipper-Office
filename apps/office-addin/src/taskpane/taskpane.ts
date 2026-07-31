import { router } from "core-protocol/command.router";
import { OfficeHostAdapter } from "../adapters/unified-adapter";

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
  const hostName = info.host ? String(info.host) : "Office";
  setText("hostLabel", hostName);
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
  document
    .getElementById("modeSelect")
    ?.addEventListener("change", updateNumberingControls);
  document
    .getElementById("layoutProfile")
    ?.addEventListener("change", updateNumberingPreview);
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
  updateNumberingControls();
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
  applyCapabilities();
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
