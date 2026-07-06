/**
 * LaTeXSnipper WPS CommandLayer v3.0
 * Unified command router + WPS adapter (plain JS, no build needed).
 *
 * This is the runtime implementation of core-protocol/command.schema.ts
 * for the WPS JSAddIn environment. It mirrors the TypeScript types from
 * the bridge/ directory so that ribbon.js and taskpane.html always route
 * through the same dispatch() interface.
 *
 * Usage in ribbon.js / taskpane.html:
 *   CommandLayer.dispatch("wps", { type: "InsertFormula", payload: { latex, display } })
 *     .then(result => { ... })
 *
 * Adapter extension (e.g. adding ConvertToOMML):
 *   CommandLayer.registerAdapter("wps", { execute(cmd) { ... } })
 */
(function () {
  "use strict";

  // ─── Router ────────────────────────────────────────────────────────
  var adapters = {};

  function dispatch(host, cmd) {
    var adapter = adapters[host];
    if (!adapter) return Promise.resolve({ ok: false, error: "No adapter for host: " + host });
    try {
      var result = adapter.execute(cmd);
      return Promise.resolve(result);
    } catch (e) {
      return Promise.resolve({ ok: false, error: e.message || String(e) });
    }
  }

  function registerAdapter(host, adapter) {
    adapters[host] = adapter;
  }

  // ─── WPS Adapter ───────────────────────────────────────────────────
  // Maps each Command type to the appropriate WPS JSAPI calls.
  // References: https://open.wps.cn/docs/wps-addin

  function getApp() {
    return window.Application;
  }

  function getDoc() {
    var app = getApp();
    return (app && app.ActiveDocument) || null;
  }

  function getSelection() {
    var app = getApp();
    return (app && app.Selection) || null;
  }

  function isPPT() {
    try {
      var app = getApp();
      return !!app.ActivePresentation && !app.ActiveDocument;
    } catch (e) { return false; }
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  var _idCounter = 0;
  function _nextFormulaId() {
    return 'wps-' + Date.now().toString(36) + '-' + (++_idCounter);
  }

  var wpsAdapter = {
    execute: function (cmd) {
      switch (cmd.type) {
        // ── Formula insertion ──────────────────────────────────────
        case "InsertFormula": {
          return this._insertFormula(cmd.payload);
        }

        // ── Selection ───────────────────────────────────────────────
        case "GetSelection": {
          var sel = getSelection();
          if (!sel) return { ok: false, error: "No selection" };
          return { ok: true, data: sel.Text || "" };
        }

        case "ReplaceSelection": {
          var sel = getSelection();
          if (!sel) return { ok: false, error: "No selection" };
          try { sel.Range.Delete(); } catch (e) {}
          sel.TypeText(cmd.payload.content || "");
          return { ok: true };
        }

        // ── UI commands ─────────────────────────────────────────────
        case "OpenEditor":
          return this._showTaskPane();

        case "OpenSettings":
          return this._showTaskPane();

        // ── Unsupported ─────────────────────────────────────────────
        default:
          return { ok: false, error: "Unsupported command: " + cmd.type };
      }
    },

    // ── Insert formula (with OMath BuildUp) ─────────────────────────
    _insertFormula: function (payload) {
      var doc = getDoc();
      if (!doc) return { ok: false, error: "No active document" };
        // PPT does not support OMath — caller should use InsertImage
        return { ok: false, error: "PPT requires InsertAsImage" };
      }

      var sel = getSelection();
      if (!sel) return { ok: false, error: "No selection" };

      var latex = payload.latex || "";
      if (!latex) return { ok: false, error: "Empty formula" };
      var fid = payload.formulaId || _nextFormulaId();

      try {
        sel.Range.Collapse(0);
        var startPos = sel.Range.End;
        sel.TypeText(latex);
        var endPos = sel.Range.End;
        var insertedRange = doc.Range(startPos, endPos);
        insertedRange.Select();
        sel.OMaths.Add(sel.Range);

        if (sel.OMaths.Count > 0) {
          var oMath = sel.OMaths.Item(1);
          if (payload.display === "block" || payload.display === "numbered") {
            try { oMath.Justification = 1; } catch (e) {}
          }
          try { oMath.BuildUp(); } catch (e) {}
          sel.Range.Collapse(0);
          return { ok: true };
        }
        sel.Range.Collapse(0);
        return { ok: false, error: "OMath creation failed" };
      } catch (e) {
        return { ok: false, error: "Insert failed: " + e.message };
      }
    },

    // ── Taskpane toggle ─────────────────────────────────────────────
    _showTaskPane: function () {
      try {
        var app = getApp();
        var tsId = app.PluginStorage.getItem("taskpane_id");
        if (!tsId) {
          var tskpane = app.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html");
          tsId = tskpane.ID;
          app.PluginStorage.setItem("taskpane_id", tsId);
          tskpane.Visible = true;
        } else {
          var pane = app.GetTaskPane(tsId);
          pane.Visible = !pane.Visible;
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
  };

  // ─── Register ──────────────────────────────────────────────────────
  registerAdapter("wps", wpsAdapter);

  // ─── Export ────────────────────────────────────────────────────────
  window.CommandLayer = {
    dispatch: dispatch,
    registerAdapter: registerAdapter
  };

  // ─── Notify ────────────────────────────────────────────────────────
  try {
    window.bridgeLog && window.bridgeLog("CommandLayer loaded");
  } catch (e) {}
})();
