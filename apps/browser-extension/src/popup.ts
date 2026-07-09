(() => {
  const statusEl = document.getElementById("status")!;
  const formulasEl = document.getElementById("formulas")!;

  async function checkConnection() {
    try {
      const res = await fetch("http://127.0.0.1:19876/api/ecosystem/ping");
      if (res.ok) {
        statusEl.textContent = "Connected to LaTeXSnipper";
        statusEl.className = "status connected";
      } else {
        throw new Error("not ok");
      }
    } catch {
      statusEl.textContent = "Desktop app not running";
      statusEl.className = "status disconnected";
    }
  }

  document.getElementById("scanPage")!.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" });
      const formulas: Array<{ latex: string; display: boolean }> = resp?.formulas ?? [];
      formulasEl.innerHTML = formulas
        .slice(0, 20)
        .map((f) => `<div class="formula-item">${f.display ? "$$" : "$"}${f.latex.substring(0, 80)}${f.display ? "$$" : "$"}</div>`)
        .join("");
      if (formulas.length === 0) {
        formulasEl.innerHTML = "<div class='formula-item'>No formulas found on this page.</div>";
      }
    } catch {
      formulasEl.innerHTML = "<div class='formula-item'>Cannot scan this page.</div>";
    }
  });

  document.getElementById("sendSelection")!.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { type: "SCAN_SELECTION" });
    } catch {
      // silent
    }
  });

  checkConnection();
})();
