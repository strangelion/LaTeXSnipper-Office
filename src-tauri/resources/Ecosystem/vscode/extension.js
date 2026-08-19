"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode4 = __toESM(require("vscode"));

// src/bridge-client.ts
var vscode = __toESM(require("vscode"));
var BridgeClient = class {
  constructor(clientId) {
    this.clientId = clientId;
  }
  get bridgeUrl() {
    return vscode.workspace.getConfiguration("latexsnipper").get("bridgeUrl", "http://127.0.0.1:19877");
  }
  get token() {
    return vscode.workspace.getConfiguration("latexsnipper").get("bridgeToken", "");
  }
  async request(path, init = {}) {
    const res = await fetch(`${this.bridgeUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...init.headers || {}
      }
    });
    if (!res.ok) throw new Error(`Bridge request failed: ${res.status}`);
    return await res.json();
  }
  async ping() {
    try {
      await this.request("/api/ecosystem/ping");
      return true;
    } catch {
      return false;
    }
  }
  async register(clientName) {
    return this.request("/api/ecosystem/clients/register", {
      method: "POST",
      body: JSON.stringify({
        clientId: this.clientId,
        clientType: "vscode",
        clientName,
        capabilities: [
          "insert_formula",
          "insert_image_attachment",
          "replace_selection",
          "read_selection",
          "open_editor"
        ],
        version: "0.1.0"
      })
    });
  }
  async enqueue(action) {
    return this.request("/api/ecosystem/actions/enqueue", {
      method: "POST",
      body: JSON.stringify(action)
    });
  }
  async next() {
    return this.request(
      `/api/ecosystem/actions/next?clientId=${encodeURIComponent(
        this.clientId
      )}&target=vscode`
    );
  }
  async complete(actionId, ok, result, error) {
    return this.request("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({
        actionId,
        clientId: this.clientId,
        ok,
        result,
        error
      })
    });
  }
  async heartbeat() {
    return this.request("/api/ecosystem/clients/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        clientId: this.clientId
      })
    });
  }
};

// src/commands.ts
var vscode3 = __toESM(require("vscode"));

// src/editor-adapter.ts
var vscode2 = __toESM(require("vscode"));
function getActiveEditor() {
  const editor = vscode2.window.activeTextEditor;
  if (!editor) throw new Error("No active editor.");
  return editor;
}
async function insertText(text) {
  const editor = getActiveEditor();
  const applied = await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
  if (!applied) {
    throw new Error("EDITOR_EDIT_REJECTED");
  }
}
function getSelectedText() {
  const editor = getActiveEditor();
  return editor.document.getText(editor.selection);
}
function decodePngBase64(value) {
  const encoded = value.replace(/^data:image\/png;base64,/, "");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length || signature.some((signatureByte, index) => bytes[index] !== signatureByte)) {
    throw new Error("VSCODE_IMAGE_INVALID_PNG");
  }
  if (bytes.byteLength > 16 * 1024 * 1024) {
    throw new Error("VSCODE_IMAGE_TOO_LARGE");
  }
  return bytes;
}
function safeImageName(value) {
  const stem = value.replace(/\.png$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${stem || "latexsnipper-image"}.png`;
}
async function insertPngAttachment(pngBase64, fileName = "latexsnipper-image.png", altText = "LaTeXSnipper image") {
  const editor = getActiveEditor();
  if (editor.document.uri.scheme !== "file") {
    throw new Error("VSCODE_IMAGE_REQUIRES_FILE_DOCUMENT");
  }
  const bytes = decodePngBase64(pngBase64);
  const documentFolder = vscode2.Uri.joinPath(editor.document.uri, "..");
  const assetFolder = vscode2.Uri.joinPath(
    documentFolder,
    ".latexsnipper-assets"
  );
  await vscode2.workspace.fs.createDirectory(assetFolder);
  const baseName = safeImageName(fileName);
  const stem = baseName.replace(/\.png$/i, "");
  let name = baseName;
  let target = vscode2.Uri.joinPath(assetFolder, name);
  let suffix = 2;
  while (true) {
    try {
      await vscode2.workspace.fs.stat(target);
      name = `${stem}-${suffix}.png`;
      target = vscode2.Uri.joinPath(assetFolder, name);
      suffix += 1;
    } catch {
      break;
    }
  }
  await vscode2.workspace.fs.writeFile(target, bytes);
  const safeAlt = altText.replace(/[\]\\]/g, " ").trim() || "LaTeXSnipper image";
  await insertText(
    `![${safeAlt}](.latexsnipper-assets/${encodeURIComponent(name)})`
  );
  return { path: target.fsPath, bytes: bytes.byteLength };
}

// src/commands.ts
function registerCommands(context, bridge) {
  context.subscriptions.push(
    vscode3.commands.registerCommand(
      "latexsnipper.insertInlineFormula",
      async () => {
        await insertText("$ $");
        vscode3.window.showInformationMessage(
          "Inline formula placeholder inserted."
        );
      }
    ),
    vscode3.commands.registerCommand(
      "latexsnipper.insertDisplayFormula",
      async () => {
        await insertText("$$\n\n$$");
        vscode3.window.showInformationMessage(
          "Display formula placeholder inserted."
        );
      }
    ),
    vscode3.commands.registerCommand(
      "latexsnipper.openSelectionInDesktop",
      async () => {
        const latex = getSelectedText();
        if (!latex.trim()) {
          vscode3.window.showWarningMessage("No formula selected.");
          return;
        }
        try {
          await bridge.enqueue({
            actionType: "EditFormula",
            origin: "vscode",
            target: "desktop",
            timeoutMs: 3e5,
            payload: {
              latex,
              display: latex.includes("\n") || latex.startsWith("$$"),
              source: "vscode-selection"
            }
          });
          vscode3.window.showInformationMessage("Sent to LaTeXSnipper.");
        } catch (e) {
          vscode3.window.showErrorMessage(
            `Failed to send to LaTeXSnipper: ${e.message}`
          );
        }
      }
    )
  );
}

// src/action-poller.ts
function startActionPoller(bridge, statusBar) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    let actionId = null;
    try {
      const data = await bridge.next();
      if (!data?.found || !data.action?.actionId) return;
      const action = data.action;
      actionId = action.actionId;
      let result = null;
      if (action.actionType === "InsertImage") {
        result = await insertPngAttachment(
          action.payload?.pngBase64 ?? "",
          action.payload?.fileName,
          action.payload?.altText
        );
      } else {
        const latex = action.payload?.latex ?? "";
        const display = !!action.payload?.display;
        const markdown = action.payload?.markdown ?? (display ? `$$
${latex}
$$` : `$${latex}$`);
        await insertText(markdown);
      }
      await bridge.complete(actionId, true, {
        inserted: true,
        data: result
      });
      statusBar.text = `$(check) LaTeXSnipper: ${action.actionType === "InsertImage" ? "image" : "formula"} inserted`;
      setTimeout(() => {
        statusBar.text = "$(symbol-event) LaTeXSnipper";
      }, 3e3);
    } catch (error) {
      if (actionId) {
        await bridge.complete(actionId, false, null, {
          code: "VSCODE_ACTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }).catch(() => {
        });
      }
      console.error("[LaTeXSnipper] VS Code ecosystem action failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 1500);
  return () => clearInterval(timer);
}

// src/extension.ts
var statusBarItem;
async function activate(context) {
  console.log("[LaTeXSnipper] Activating...");
  statusBarItem = vscode4.window.createStatusBarItem(
    vscode4.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(symbol-event) LaTeXSnipper";
  statusBarItem.tooltip = "LaTeXSnipper: click to insert inline formula";
  statusBarItem.command = "latexsnipper.insertInlineFormula";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  let clientId = context.globalState.get(
    "latexsnipper.ecosystemClientId"
  );
  if (!clientId) {
    clientId = `vscode-${crypto.randomUUID()}`;
    await context.globalState.update(
      "latexsnipper.ecosystemClientId",
      clientId
    );
  }
  const bridge = new BridgeClient(clientId);
  registerCommands(context, bridge);
  const stopPoller = startActionPoller(bridge, statusBarItem);
  context.subscriptions.push({ dispose: stopPoller });
  bridge.register("VS Code").catch(() => {
    statusBarItem.text = "$(warning) LaTeXSnipper (offline)";
    statusBarItem.tooltip = "LaTeXSnipper desktop not running";
  });
  const heartbeatTimer = setInterval(async () => {
    try {
      const result = await bridge.heartbeat();
      if (result?.registered === false) {
        await bridge.register("VS Code").catch(() => {
        });
      }
    } catch {
    }
  }, 1e4);
  context.subscriptions.push({ dispose: () => clearInterval(heartbeatTimer) });
  console.log("[LaTeXSnipper] Activated.");
}
function deactivate() {
  console.log("[LaTeXSnipper] Deactivated.");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
