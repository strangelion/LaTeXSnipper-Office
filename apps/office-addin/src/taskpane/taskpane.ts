/**
 * LaTeXSnipper Office Add-in — Taskpane UI v3.0
 *
 * All host operations route through router.dispatch("office", cmd).
 * No direct Word.run / Excel.run / Office.context calls here.
 */

import { router } from "core-protocol/command.router";
import { OfficeHostAdapter } from "../adapters/unified-adapter";

type InsertMode = "inline" | "display" | "display-numbered";
type StatusType = "info" | "success" | "error";

// ─── Register adapter once ──────────────────────────────────────────

let registered = false;

function ensureAdapter(): void {
  if (!registered) {
    router.register("office", new OfficeHostAdapter());
    registered = true;
  }
}

// ─── Bridge base URL ────────────────────────────────────────────────

const bridgeBase = (() => {
  const { protocol, hostname, port } = window.location;
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port === "19876") {
    return "";
  }
  return "https://127.0.0.1:19876";
})();

// ─── Dispatch wrapper ───────────────────────────────────────────────

async function exec(cmd: any): Promise<any> {
  ensureAdapter();
  return router.dispatch("office", cmd);
}

// ─── UI handlers ────────────────────────────────────────────────────

Office.onReady((info) => {
  ensureAdapter();
  const hostName = info.host ? String(info.host) : "Office";
  setHostLabel(hostName);
  void sendHeartbeat(hostName);

  document.getElementById("loadBtn")?.addEventListener("click", () => void handleLoad());
  document.getElementById("insertBtn")?.addEventListener("click", () => void handleInsert());
  document.getElementById("deleteBtn")?.addEventListener("click", () => void handleDelete());
  setStatus("Ready");
});

async function sendHeartbeat(host: string) {
  try {
    await fetch(`${bridgeBase}/api/office/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host }),
    });
  } catch {
    // Desktop bridge may be offline; document editing still works
  }
}

function setStatus(message: string, type: StatusType = "info") {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = message;
  el.className = `status ${type}`;
}

function setHostLabel(host: string) {
  const el = document.getElementById("hostLabel");
  if (el) el.textContent = host;
}

function getEditorContent(): string {
  const el = document.getElementById("editor") as HTMLTextAreaElement | null;
  return el?.value?.trim() || "";
}

function setEditorContent(text: string) {
  const el = document.getElementById("editor") as HTMLTextAreaElement | null;
  if (el) el.value = text;
}

function getInsertMode(): InsertMode {
  const sel = document.getElementById("modeSelect") as HTMLSelectElement | null;
  if (sel?.value === "numbered") return "display-numbered";
  if (sel?.value === "inline") return "inline";
  return "display";
}

function modeToDisplay(mode: InsertMode): "inline" | "block" | "numbered" {
  if (mode === "inline") return "inline";
  if (mode === "display-numbered") return "numbered";
  return "block";
}

async function handleLoad() {
  setStatus("Loading selection...");
  const result = await exec({ type: "GetSelection" });
  if (!result.ok || !result.data) {
    setStatus("No supported selection found", "error");
    return;
  }
  setEditorContent(result.data);
  setStatus("Loaded selection", "success");
}

async function handleInsert() {
  const content = getEditorContent();
  if (!content) {
    setStatus("Enter a LaTeX formula first", "error");
    return;
  }
  setStatus("Inserting...");
  const result = await exec({
    type: "InsertFormula",
    payload: { latex: content, display: modeToDisplay(getInsertMode()) },
  });
  if (result.ok) {
    setStatus("Inserted", "success");
  } else {
    setStatus(`Insert failed: ${result.error}`, "error");
  }
}

async function handleDelete() {
  setStatus("Deleting...");
  const result = await exec({ type: "ReplaceSelection", payload: { content: "" } });
  if (result.ok) {
    setStatus("Deleted", "success");
  } else {
    setStatus(`Delete failed: ${result.error}`, "error");
  }
}
