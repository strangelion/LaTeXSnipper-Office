import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const endpoint = process.env.WEBVIEW2_CDP_URL || "http://127.0.0.1:9223";
const browser = await chromium.connectOverCDP(endpoint);
let page;

try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  page = pages.find((candidate) =>
    candidate.url().startsWith("http://tauri.localhost/"),
  );
  assert.ok(page, `No Tauri WebView page found at ${endpoint}`);

  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      consoleErrors.push(
        `${message.text()} @ ${location.url || "unknown"}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`,
      );
    }
  });
  page.on("pageerror", (error) =>
    consoleErrors.push(error.stack || String(error)),
  );
  page.on("requestfailed", (request) =>
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || "unknown",
    }),
  );

  await page.locator("#app").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.title(), "LaTeXSnipper Office");
  assert.equal(new URL(page.url()).hostname, "tauri.localhost");

  const csp = await page.evaluate(async () => {
    const minimalModule = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ]);
    await WebAssembly.compile(minimalModule);
    let dynamicCodeBlocked = false;
    try {
      // This must remain blocked even though bundled WASM is permitted.
      Function("return 1")();
    } catch {
      dynamicCodeBlocked = true;
    }
    return { wasmCompiled: true, dynamicCodeBlocked };
  });
  assert.equal(csp.wasmCompiled, true);
  assert.equal(csp.dynamicCodeBlocked, true);

  await page.locator("#editorBtn").click();
  await page.locator("#drawingModeTab").click();
  await page.locator('[data-drawing-language="graphviz_dot"]').first().click();
  await page.locator("#drawingSourceModeBtn").click();
  await page
    .locator("#drawingSource")
    .fill(
      'digraph G { rankdir=LR; input [label="输入"]; process [label="处理"]; output [label="输出"]; input -> process; process -> output; }',
    );
  await page.locator("#drawingCompileBtn").click();
  await page.locator("#drawingPreview svg").waitFor({ timeout: 45_000 });
  await page.waitForFunction(
    () =>
      !document.querySelector("#drawingCompileBtn")?.disabled &&
      !/正在安全编译/.test(
        document.querySelector("#drawingCompileStatus")?.textContent || "",
      ),
    null,
    { timeout: 45_000 },
  );

  const graphviz = await page.evaluate(() => {
    const svg = document.querySelector("#drawingPreview svg");
    const status =
      document.querySelector("#drawingCompileStatus")?.textContent || "";
    const box = svg?.getBBox?.();
    const values = (svg?.getAttribute("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    return {
      status,
      viewBox: svg?.getAttribute("viewBox") || "",
      width: svg?.getAttribute("width"),
      height: svg?.getAttribute("height"),
      text: svg?.textContent || "",
      inkWidthRatio: box && values[2] > 0 ? box.width / values[2] : 0,
      inkHeightRatio: box && values[3] > 0 ? box.height / values[3] : 0,
    };
  });
  assert.match(graphviz.viewBox, /^-?[\d.]+\s+-?[\d.]+\s+[\d.]+\s+[\d.]+$/);
  assert.equal(graphviz.width, null);
  assert.equal(graphviz.height, null);
  assert.match(graphviz.text, /输入/);
  assert.match(graphviz.text, /处理/);
  assert.match(graphviz.text, /输出/);
  assert.ok(graphviz.inkWidthRatio > 0.7);
  assert.ok(graphviz.inkHeightRatio > 0.7);
  assert.doesNotMatch(
    graphviz.status,
    /DRAWING_REMOTE_INCLUDE_FORBIDDEN|编译失败/i,
  );

  async function compileTikzProfile({ profile, source, label }) {
    const selector = profile
      ? `[data-drawing-language="tikz"][data-drawing-profile="${profile}"]`
      : '[data-drawing-language="tikz"]:not([data-drawing-profile])';
    await page.locator(selector).click();
    await page.locator("#drawingSourceModeBtn").click();
    await page
      .locator("#drawingCompileBtn")
      .waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForFunction(
      () => !document.querySelector("#drawingCompileBtn")?.disabled,
      null,
      { timeout: 45_000 },
    );
    await page.locator("#drawingSource").fill(source);
    await page.locator("#drawingCompileBtn").click();
    try {
      await page.locator("#drawingPreview svg").waitFor({ timeout: 45_000 });
      await page.waitForFunction(
        () =>
          !document.querySelector("#drawingCompileBtn")?.disabled &&
          !/正在安全编译/.test(
            document.querySelector("#drawingCompileStatus")?.textContent || "",
          ),
        null,
        { timeout: 45_000 },
      );
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        status:
          document.querySelector("#drawingCompileStatus")?.textContent || "",
        preview: document.querySelector("#drawingPreview")?.textContent || "",
      }));
      throw new Error(
        `${label} release render failed: ${JSON.stringify({
          ...diagnostic,
          consoleErrors,
          failedRequests,
        })}`,
        { cause: error },
      );
    }
    return page.evaluate(() => {
      const svg = document.querySelector("#drawingPreview svg");
      const box = svg?.getBBox?.();
      const values = (svg?.getAttribute("viewBox") || "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      return {
        status:
          document.querySelector("#drawingCompileStatus")?.textContent || "",
        viewBox: svg?.getAttribute("viewBox") || "",
        text: svg?.textContent || "",
        inkWidthRatio: box && values[2] > 0 ? box.width / values[2] : 0,
        inkHeightRatio: box && values[3] > 0 ? box.height / values[3] : 0,
      };
    });
  }

  const tikz = await compileTikzProfile({
    profile: null,
    label: "TikZ",
    source: String.raw`\draw[->, thick] (0,0) -- (3,0) node[right] {$x$};
\draw[->, thick] (0,0) -- (0,2) node[above] {$y$};`,
  });
  assert.match(tikz.viewBox, /^-?[\d.]+\s+-?[\d.]+\s+[\d.]+\s+[\d.]+$/);
  assert.doesNotMatch(tikz.status, /编译失败|未生成|超时/i);
  assert.ok(tikz.inkWidthRatio > 0.7);
  assert.ok(tikz.inkHeightRatio > 0.7);

  const pgfPlots = await compileTikzProfile({
    profile: "pgf_plots",
    label: "PGFPlots",
    source: String.raw`\begin{axis}[grid=major, xlabel={$x$}, ylabel={$f(x)$}]
  \addplot[blue, thick, domain=-3:3, samples=100] {x^2};
\end{axis}`,
  });
  assert.match(pgfPlots.viewBox, /^-?[\d.]+\s+-?[\d.]+\s+[\d.]+\s+[\d.]+$/);
  assert.doesNotMatch(pgfPlots.status, /编译失败|未生成|超时/i);
  assert.ok(pgfPlots.inkWidthRatio > 0.7);
  assert.ok(pgfPlots.inkHeightRatio > 0.7);

  await page.locator("#formulaModeTab").click();
  await page.evaluate(() => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><path d="M2 10h36" stroke="#2563eb" stroke-width="3"/></svg>';
    const dataBase64 = btoa(svg);
    localStorage.setItem(
      "latexsnipper.custom-symbols.v1",
      JSON.stringify([
        {
          symbol: { name: "Release symbol", latexCommand: "\\mysymbol" },
          svg: { mimeType: "image/svg+xml", dataBase64 },
        },
      ]),
    );
    window.dispatchEvent(
      new CustomEvent("latexsnipper:custom-symbol-library-changed"),
    );
  });
  await page.locator("#latexSource").fill("\\mysymbol\\frac12=");
  await page.locator("#latexSource").dispatchEvent("input");
  await page
    .locator(
      '#previewHost[data-preview-kind="formula"] [class*="latexsnipper-custom-symbol-"]',
    )
    .waitFor({ state: "visible", timeout: 10_000 });
  const customSymbol = await page.evaluate(() => {
    const preview = document.querySelector(
      '#previewHost[data-preview-kind="formula"] [class*="latexsnipper-custom-symbol-"]',
    );
    const editorPreview = document
      .querySelector("math-field")
      ?.shadowRoot?.querySelector('[class*="latexsnipper-custom-symbol-"]');
    return {
      previewClass: preview?.getAttribute("class") || "",
      editorClass: editorPreview?.getAttribute("class") || "",
      editorLatex:
        document.querySelector("math-field")?.getValue("latex") || "",
      width: preview?.getBoundingClientRect().width || 0,
      height: preview?.getBoundingClientRect().height || 0,
    };
  });
  assert.match(customSymbol.previewClass, /latexsnipper-custom-symbol-/);
  assert.match(customSymbol.editorClass, /latexsnipper-custom-symbol-/);
  assert.match(
    customSymbol.editorLatex,
    /^\\mysymbol\\frac(?:12|\{1\}\{2\})=$/,
  );
  assert.ok(customSymbol.width > 0 && customSymbol.height > 0);

  await page.evaluate(() => {
    window.__app.openFormulaLibraryPanel();
    window.__app.selectFormulaLibraryCategory("__custom_symbols__");
  });
  await page
    .locator('.custom-symbol-library-item img[alt*="Release symbol"]')
    .waitFor({ state: "visible", timeout: 10_000 });
  const customSymbolLibrary = await page.evaluate(() => {
    const image = document.querySelector(
      '.custom-symbol-library-item img[alt*="Release symbol"]',
    );
    const command = image
      ?.closest(".custom-symbol-library-item")
      ?.querySelector("code")?.textContent;
    return {
      command,
      width: image?.getBoundingClientRect().width || 0,
      height: image?.getBoundingClientRect().height || 0,
    };
  });
  assert.equal(customSymbolLibrary.command, "\\mysymbol");
  assert.ok(customSymbolLibrary.width > 0 && customSymbolLibrary.height > 0);

  const appearance = await page.evaluate(() => {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const themeButton = document.getElementById("themeToggle");
    const dock = document.getElementById("officeActionDock");
    return {
      theme: root.dataset.theme || "system",
      background: styles.getPropertyValue("--bg").trim(),
      foreground: styles.getPropertyValue("--fg").trim(),
      themeButtonVisible: Boolean(themeButton?.offsetParent),
      dockVisible: Boolean(dock?.offsetParent),
      liquidGlass: root.dataset.liquidGlass || "",
    };
  });
  assert.notEqual(appearance.background, "");
  assert.notEqual(appearance.foreground, "");
  assert.equal(appearance.themeButtonVisible, true);
  assert.equal(appearance.dockVisible, true);

  const relevantErrors = consoleErrors.filter(
    (message) =>
      !/office.*(bridge|host)|connection refused|failed to fetch/i.test(
        message,
      ),
  );
  assert.deepEqual(relevantErrors, []);

  console.log(
    JSON.stringify(
      {
        pass: true,
        runtime: "Tauri release WebView2",
        csp,
        graphviz,
        tikz,
        pgfPlots,
        customSymbol,
        customSymbolLibrary,
        appearance,
      },
      null,
      2,
    ),
  );
} finally {
  if (page) {
    try {
      await page.locator("#editorBtn").click();
      await page.locator("#drawingModeTab").click();
      await page
        .locator('[data-drawing-language="graphviz_dot"]')
        .first()
        .click();
      const autoPreview = page.locator("#drawingAutoPreview");
      if (!(await autoPreview.isChecked())) await autoPreview.check();
    } catch {
      // Cleanup is best-effort and must not hide the original verification error.
    }
  }
  await browser.close();
}
