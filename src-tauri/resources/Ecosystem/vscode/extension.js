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
  get bridgeUrl() {
    return vscode.workspace.getConfiguration("latexsnipper").get("bridgeUrl", "http://127.0.0.1:19876");
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
  async register(clientId, clientName) {
    return this.request("/api/ecosystem/clients/register", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        clientType: "vscode",
        clientName,
        capabilities: ["insert_formula", "replace_selection", "read_selection", "open_editor"],
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
  async next(clientId) {
    return this.request(
      `/api/ecosystem/actions/next?clientId=${encodeURIComponent(clientId)}&target=vscode`
    );
  }
  async complete(actionId, ok, result, error) {
    return this.request("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({ actionId, clientId: "vscode-default", ok, result, error })
    });
  }
  async heartbeat(clientId) {
    return this.request("/api/ecosystem/clients/heartbeat", {
      method: "POST",
      body: JSON.stringify({ clientId })
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
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
}
function getSelectedText() {
  const editor = getActiveEditor();
  return editor.document.getText(editor.selection);
}

// src/commands.ts
function registerCommands(context, bridge) {
  context.subscriptions.push(
    vscode3.commands.registerCommand("latexsnipper.insertInlineFormula", async () => {
      await insertText("$ $");
      vscode3.window.showInformationMessage("Inline formula placeholder inserted.");
    }),
    vscode3.commands.registerCommand("latexsnipper.insertDisplayFormula", async () => {
      await insertText("$$\n\n$$");
      vscode3.window.showInformationMessage("Display formula placeholder inserted.");
    }),
    vscode3.commands.registerCommand("latexsnipper.openSelectionInDesktop", async () => {
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
        vscode3.window.showErrorMessage(`Failed to send to LaTeXSnipper: ${e.message}`);
      }
    })
  );
}

// src/action-poller.ts
function startActionPoller(bridge, statusBar) {
  const timer = setInterval(async () => {
    try {
      const data = await bridge.next("vscode-default");
      if (!data?.found || !data.action?.actionId) return;
      const action = data.action;
      if (action.actionType === "InsertFormula" || action.actionType === "ReplaceSelection") {
        const latex = action.payload?.latex ?? "";
        const display = !!action.payload?.display;
        const markdown = action.payload?.markdown ?? (display ? `$$
${latex}
$$` : `$${latex}$`);
        await insertText(markdown);
        await bridge.complete(action.actionId, true, { inserted: true });
        statusBar.text = "$(check) LaTeXSnipper: formula inserted";
        setTimeout(() => {
          statusBar.text = "$(symbol-event) LaTeXSnipper";
        }, 3e3);
      }
    } catch {
    }
  }, 1500);
  return () => clearInterval(timer);
}

// src/extension.ts
var statusBarItem;
function activate(context) {
  console.log("[LaTeXSnipper] Activating...");
  statusBarItem = vscode4.window.createStatusBarItem(vscode4.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(symbol-event) LaTeXSnipper";
  statusBarItem.tooltip = "LaTeXSnipper: click to insert inline formula";
  statusBarItem.command = "latexsnipper.insertInlineFormula";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  const bridge = new BridgeClient();
  registerCommands(context, bridge);
  const stopPoller = startActionPoller(bridge, statusBarItem);
  context.subscriptions.push({ dispose: stopPoller });
  bridge.register("vscode-default", "VS Code").catch(() => {
    statusBarItem.text = "$(warning) LaTeXSnipper (offline)";
    statusBarItem.tooltip = "LaTeXSnipper desktop not running";
  });
  const heartbeatTimer = setInterval(() => {
    bridge.heartbeat("vscode-default").catch(() => {
    });
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
