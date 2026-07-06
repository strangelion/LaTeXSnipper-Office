// LaTeXSnipper v3.0 — WPS Ribbon
// Calls unified WPSBridge.execute() for all operations

(function () {
  const bridge = window.WPSBridge;

  window.InsertFormula = function () {
    const latex = document.getElementById("latexInput")?.value || "x^2";
    bridge.execute({ type: "InsertFormula", payload: { latex, display: "inline" } });
  };

  window.ReadSelection = async function () {
    const result = await bridge.execute({ type: "GetSelection" });
    if (result.ok && result.data) {
      alert("Selection: " + result.data);
    }
  };

  window.ReplaceSelection = function () {
    const latex = document.getElementById("latexInput")?.value || "x^2";
    bridge.execute({ type: "ReplaceSelection", payload: { content: `$${latex}$` } });
  };
})();
