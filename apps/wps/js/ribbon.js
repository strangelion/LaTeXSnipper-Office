// LaTeXSnipper WPS Ribbon callbacks. Every callback returns a primitive value.

function activeWpsAdapterKey() {
  return window.CommandLayer ? window.CommandLayer.getActiveAdapterKey() : null;
}

function activeWpsCapabilities() {
  return window.CommandLayer ? window.CommandLayer.getCapabilities() : {};
}

function OnAddinLoad(ribbonUI) {
  try {
    if (typeof window.Application.ribbonUI !== "object") {
      window.Application.ribbonUI = ribbonUI;
    }
    if (typeof window.Application.Enum !== "object") {
      window.Application.Enum = WPS_Enum;
    }
    window.bridgeLog = function (message) {
      console.log("[LaTeXSnipper WPS] " + String(message));
    };
    window.bridgeLog("Loaded host=" + String(activeWpsAdapterKey()));
  } catch (error) {
    console.error("[LaTeXSnipper WPS] Ribbon load failed", error && error.name);
    return false;
  }
  return true;
}

function dispatchWps(command) {
  if (!window.CommandLayer) {
    return Promise.resolve({ ok: false, error: "CommandLayer unavailable" });
  }
  return window.CommandLayer.dispatch(activeWpsAdapterKey(), command);
}

function insertFromStorage(mode) {
  var latex = window.Application.PluginStorage.getItem("current_latex") || "";
  if (!String(latex).trim()) {
    alert("请先在公式编辑器中输入 LaTeX 公式");
    return;
  }
  dispatchWps({
    type: "InsertFormula",
    payload: { latex: String(latex), mode: mode, display: mode },
  }).then(function (result) {
    if (!result.ok) alert("插入失败 [" + (result.errorCode || "UNKNOWN") + "]: " + result.error);
  });
}

function loadSelectedFormula() {
  dispatchWps({ type: "ReadFormula" }).then(function (result) {
    if (!result.ok || !result.data) {
      alert("加载失败 [" + (result.errorCode || "NO_FORMULA_SELECTED") + "]: " + result.error);
      return;
    }
    window.Application.PluginStorage.setItem("current_latex", result.data.latex || "");
    alert("已加载选中的 LaTeXSnipper 公式");
  });
}

function deleteSelectedFormula() {
  dispatchWps({ type: "DeleteFormula" }).then(function (result) {
    if (!result.ok) alert("删除失败 [" + (result.errorCode || "UNKNOWN") + "]: " + result.error);
  });
}

function renumberOwnedEquations() {
  dispatchWps({ type: "RenumberEquations" }).then(function (result) {
    if (!result.ok) {
      alert("重新编号失败 [" + (result.errorCode || "UNKNOWN") + "]: " + result.error);
    }
  });
}

function OnAction(control) {
  var id = String(control && control.Id ? control.Id : "");
  switch (id) {
    case "btnInsertInline":
      insertFromStorage("inline");
      break;
    case "btnInsertDisplay":
      insertFromStorage("block");
      break;
    case "btnInsertNumbered":
      insertFromStorage("numbered");
      break;
    case "btnLoadSelected":
      loadSelectedFormula();
      break;
    case "btnDeleteSelected":
      deleteSelectedFormula();
      break;
    case "btnAutoNumber":
    case "btnRenumber":
      renumberOwnedEquations();
      break;
    case "btnScreenshotOcr":
    case "btnShowTaskPane":
    case "btnSettings":
      dispatchWps({ type: "OpenEditor" });
      break;
    case "btnHelp":
      window.open("https://latexsnipper.readthedocs.io/", "_blank");
      break;
  }
  return true;
}

function GetImage(control) {
  var images = {
    btnInsertInline: "images/insert_inline.svg",
    btnInsertDisplay: "images/insert_display.svg",
    btnInsertNumbered: "images/insert_numbered.svg",
    btnScreenshotOcr: "images/screenshot_ocr.svg",
    btnLoadSelected: "images/load_selected.svg",
    btnDeleteSelected: "images/delete_selected.svg",
    btnAutoNumber: "images/auto_number.svg",
    btnRenumber: "images/renumber.svg",
    btnShowTaskPane: "images/task_pane.svg",
    btnSettings: "images/settings.svg",
    btnHelp: "images/help.svg",
  };
  return images[String(control && control.Id)] || "images/insert_inline.svg";
}

function OnGetEnabled(control) {
  var id = String(control && control.Id ? control.Id : "");
  var capabilities = activeWpsCapabilities();
  if (id === "btnInsertNumbered" || id === "btnAutoNumber" || id === "btnRenumber") {
    return capabilities.numberedEquation === true;
  }
  if (id === "btnLoadSelected") return capabilities.readFormula === true;
  if (id === "btnDeleteSelected") return capabilities.deleteFormula === true;
  if (id.indexOf("btnInsert") === 0) return capabilities.insertFormula === true;
  return true;
}

function OnGetVisible(_control) {
  return true;
}
