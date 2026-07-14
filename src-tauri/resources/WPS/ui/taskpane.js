(function () {
  "use strict";

  var root = window.parent.window;
  var layer = root.CommandLayer;
  var bridge = root.WpsBridgeClient;
  var host = root.WpsHostDetection.detectHost(root.Application);
  var adapterKey = layer.getActiveAdapterKey();
  var capabilities = layer.getCapabilities();
  var hostNames = {
    wps: "WPS Writer",
    et: "WPS Spreadsheets",
    wpp: "WPS Presentation",
    unknown: "未知宿主",
  };
  var elements = {
    hostName: document.getElementById("hostName"),
    status: document.getElementById("status"),
    latex: document.getElementById("latexSource"),
    preview: document.getElementById("preview"),
    writerModes: document.getElementById("writerModes"),
    numberedMode: document.getElementById("numberedMode"),
    imageOptions: document.getElementById("imageOptions"),
    naturalSize: document.getElementById("naturalSize"),
    load: document.getElementById("loadButton"),
    insert: document.getElementById("insertButton"),
    update: document.getElementById("updateButton"),
    remove: document.getElementById("deleteButton"),
    renumber: document.getElementById("renumberButton"),
  };

  function status(kind, text) {
    elements.status.className = kind || "";
    elements.status.textContent = text;
  }

  function mode() {
    var selected = document.querySelector('input[name="mode"]:checked');
    return selected ? selected.value : "inline";
  }

  function payload() {
    return {
      latex: elements.latex.value.trim(),
      mode: host === "wps" ? mode() : "block",
      display: host === "wps" ? mode() : "block",
      naturalSize: elements.naturalSize.checked,
    };
  }

  function dispatch(type) {
    return layer.dispatch(adapterKey, { type: type, payload: payload() }).then(function (result) {
      if (!result.ok) {
        status("error", (result.errorCode || "COMMAND_FAILED") + "：" + result.error);
      }
      return result;
    });
  }

  function refreshPreview() {
    var latex = elements.latex.value.trim();
    if (!latex) {
      elements.preview.textContent = "输入公式后显示预览";
      return;
    }
    bridge
      .convert(latex, mode() === "inline" ? "inline" : "block", "png")
      .then(function (result) {
        elements.preview.innerHTML = "";
        var image = document.createElement("img");
        image.alt = "公式预览";
        image.src = "data:image/png;base64," + result.content;
        elements.preview.appendChild(image);
      })
      .catch(function (error) {
        elements.preview.textContent = "预览失败：" + error.message;
      });
  }

  elements.hostName.textContent = hostNames[host] || hostNames.unknown;
  elements.writerModes.hidden = host !== "wps";
  elements.imageOptions.hidden = host === "wps";
  elements.numberedMode.disabled = capabilities.numberedEquation !== true;
  elements.renumber.hidden = capabilities.numberedEquation !== true;
  elements.insert.disabled = capabilities.insertFormula !== true;
  elements.load.disabled = capabilities.readFormula !== true;
  elements.update.disabled = capabilities.updateFormula !== true;
  elements.remove.disabled = capabilities.deleteFormula !== true;

  elements.insert.addEventListener("click", function () {
    if (!elements.latex.value.trim()) return status("error", "请输入 LaTeX 公式。");
    dispatch("InsertFormula").then(function (result) {
      if (result.ok) status("success", "公式插入成功。");
    });
  });
  elements.load.addEventListener("click", function () {
    dispatch("ReadFormula").then(function (result) {
      if (!result.ok) return;
      elements.latex.value = result.data.latex || "";
      var target = document.querySelector(
        'input[name="mode"][value="' + (result.data.displayMode || "inline") + '"]',
      );
      if (target) target.checked = true;
      refreshPreview();
      status("success", "已加载选中的公式。");
    });
  });
  elements.update.addEventListener("click", function () {
    if (!elements.latex.value.trim()) return status("error", "请输入 LaTeX 公式。");
    dispatch("UpdateFormula").then(function (result) {
      if (result.ok) status("success", "公式更新成功。");
    });
  });
  elements.remove.addEventListener("click", function () {
    dispatch("DeleteFormula").then(function (result) {
      if (result.ok) status("success", "公式已删除。");
    });
  });
  elements.renumber.addEventListener("click", function () {
    dispatch("RenumberEquations").then(function (result) {
      if (result.ok) status("success", "已重新编号 LaTeXSnipper 公式。");
    });
  });

  var previewTimer = null;
  elements.latex.addEventListener("input", function () {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(refreshPreview, 350);
    try {
      root.Application.PluginStorage.setItem("current_latex", elements.latex.value);
    } catch (_error) {
      console.warn("[LaTeXSnipper WPS] operation failed", {
        operation: "persist-taskpane-draft",
        host: host,
        formulaId: null,
        errorCode: "WPS_API_ERROR",
        message: _error.message || String(_error),
      });
    }
  });
  document.querySelectorAll('input[name="mode"]').forEach(function (input) {
    input.addEventListener("change", refreshPreview);
  });

  bridge
    .startHeartbeat(host, capabilities, function (online, error) {
      status(
        online ? "success" : "error",
        online ? "Bridge 已连接，宿主心跳正常。" : "BRIDGE_OFFLINE：" + error.message,
      );
    })
    .catch(function (error) {
      status("error", (error.code || "BRIDGE_OFFLINE") + "：" + error.message);
    });
})();
