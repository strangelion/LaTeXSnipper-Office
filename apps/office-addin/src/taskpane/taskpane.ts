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
  setStatus("Checking Office capabilities...");
  const result = await exec({ type: "GetHostCapabilities", payload: {} });
  capabilities = result.ok ? (result.data as CapabilityResult) : null;
  applyCapabilities();
  await updateBridgeState(host);
  window.setInterval(() => void updateBridgeState(host), 10000);
  setStatus(
    capabilities ? "Ready" : result.error || "Unsupported Office host",
    capabilities ? "success" : "error",
  );
}

async function updateBridgeState(host: string): Promise<void> {
  let connected = false;
  try {
    const response = await fetch(`${bridgeBase}/api/office/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host }),
    });
    connected = response.ok;
  } catch {
    connected = false;
  }
  setText("bridgeStatus", `Bridge: ${connected ? "connected" : "offline"}`);
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
    capabilities ? `Host: ${capabilities.host}` : "Host: unsupported",
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
    getInsertMode() === "display-numbered" ? `Numbering: ${preview}` : "",
  );
}

async function handleLoad(): Promise<void> {
  if (busy) return;
  setBusy(true);
  setStatus("Loading selected formula...");
  try {
    const result = await exec({ type: "GetSelectedFormula", payload: {} });
    if (!result.ok || !result.data) {
      setStatus(result.error || "No supported formula selected", "error");
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
    setStatus(`Loaded formula (${result.data.source})`, "success");
  } finally {
    setBusy(false);
  }
}

async function handleInsert(): Promise<void> {
  const latex = getEditorContent();
  if (!latex) {
    setStatus("Enter a LaTeX formula first", "error");
    return;
  }
  if (busy) return;
  setBusy(true);
  setStatus("Inserting formula...");
  try {
    const result = await exec({
      type: "InsertFormula",
      payload: buildPayload(latex, false),
    });
    if (result.ok) {
      selectedFormulaId = result.data?.formulaId;
      setStatus("Inserted", "success");
    } else setStatus(`Insert failed: ${result.error}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleUpdate(): Promise<void> {
  const latex = getEditorContent();
  if (!latex) {
    setStatus("Enter a LaTeX formula first", "error");
    return;
  }
  if (busy) return;
  setBusy(true);
  setStatus("Updating selected formula...");
  try {
    const result = await exec({
      type: "ReplaceSelectedFormula",
      payload: buildPayload(latex, true),
    });
    if (result.ok) {
      selectedFormulaId = result.data?.formulaId;
      setStatus("Updated in place", "success");
    } else setStatus(`Update failed: ${result.error}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleDelete(): Promise<void> {
  if (busy) return;
  setBusy(true);
  setStatus("Deleting formula...");
  try {
    const result = await exec({ type: "DeleteSelectedFormula", payload: {} });
    if (result.ok) {
      selectedFormulaId = undefined;
      setStatus("Deleted formula", "success");
    } else setStatus(`Delete failed: ${result.error}`, "error");
  } finally {
    setBusy(false);
  }
}

async function handleReference(): Promise<void> {
  if (!selectedFormulaId) {
    setStatus(
      "Load a numbered formula before inserting its reference",
      "error",
    );
    return;
  }
  if (busy) return;
  setBusy(true);
  setStatus("Inserting equation reference...");
  try {
    const result = await exec({
      type: "InsertEquationReference",
      payload: { formulaId: selectedFormulaId },
    });
    setStatus(
      result.ok
        ? "Inserted equation reference"
        : `Reference failed: ${result.error}`,
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
