import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const cdpUrl = process.env.WEBVIEW2_CDP_URL;
if (cdpUrl) {
  assert.equal(
    process.env.TAURI_UI_ISOLATED_PROFILE,
    "1",
    "Use an isolated test profile",
  );
  assert.match(
    process.env.EXPECTED_TAURI_SOURCE_COMMIT || "",
    /^[a-f0-9]{40}$/,
  );
}
const output = `output/playwright/inline-completion${cdpUrl ? "-webview" : ""}`;
mkdirSync(output, { recursive: true });
const executablePath = [
  process.env.PW_CHROMIUM,
  chromium.executablePath(),
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
]
  .filter(Boolean)
  .find(existsSync);
if (!executablePath && !cdpUrl)
  throw new Error("No Chromium browser is available");
const browser = cdpUrl
  ? await chromium.connectOverCDP(cdpUrl)
  : await chromium.launch({ executablePath, headless: true });
try {
  const page = cdpUrl
    ? browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) =>
          candidate.url().startsWith("http://tauri.localhost/"),
        )
    : await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  assert.ok(page, "No application page found");
  let backend;
  if (cdpUrl) {
    await page.setViewportSize({ width: 1280, height: 800 });
    backend = await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("export_diagnostics"),
    );
    assert.equal(
      backend.sourceCommitSha,
      process.env.EXPECTED_TAURI_SOURCE_COMMIT,
    );
  } else
    await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
      waitUntil: "networkidle",
    });
  const editor = page.locator("#formulaSourceEditor .cm-content");
  const ghost = page.locator("#formulaSourceEditor .formula-inline-suggestion");
  const options = page.locator(".cm-tooltip-autocomplete [role='option']");
  await page.getByRole("checkbox", { name: "本地偏好排序（实验）" }).check();
  await editor.fill("\\sq");
  await ghost.waitFor({ state: "visible" });
  assert.equal(await page.locator("#latexSource").inputValue(), "\\sq");
  assert.match(await ghost.textContent(), /^rt\{\}Tab$/);
  await editor.press("Tab");
  assert.equal(await page.locator("#latexSource").inputValue(), "\\sqrt{}");
  await editor.press("Control+z");
  assert.equal(await page.locator("#latexSource").inputValue(), "\\sq");
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            "latexsnipper.formula-completion-preferences.v1",
          ),
        ).entries.c1,
    ),
    undefined,
  );
  await editor.press("End");
  await ghost.waitFor({ state: "visible" });
  await editor.press("Escape");
  assert.equal(await ghost.count(), 0);
  await editor.press("Control+Space");
  await ghost.waitFor({ state: "visible" });
  await editor.press("Control+a");
  assert.equal(await ghost.count(), 0);
  const themes = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await editor.fill("\\");
    await editor.press("Control+Space");
    await options.first().waitFor({ state: "visible" });
    assert.ok((await options.count()) > 70);
    const colors = await page
      .locator(".cm-tooltip-autocomplete")
      .evaluate((node) => {
        const rgb = (text) =>
          text
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map((value) => {
              const channel =
                Number(value) / (text.startsWith("color(srgb") ? 1 : 255);
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            });
        const luminance = (text) => {
          const [r, g, b] = rgb(text);
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const style = getComputedStyle(node);
        const selected = getComputedStyle(
          node.querySelector('[aria-selected="true"]'),
        );
        const contrast = (a, b) =>
          (Math.max(luminance(a), luminance(b)) + 0.05) /
          (Math.min(luminance(a), luminance(b)) + 0.05);
        return {
          background: style.backgroundColor,
          foreground: style.color,
          contrast: contrast(style.backgroundColor, style.color),
          selectedContrast: contrast(selected.backgroundColor, selected.color),
        };
      });
    assert.ok(colors.contrast >= 4.5 && colors.selectedContrast >= 4.5);
    themes.push({ theme, ...colors });
    await page.screenshot({ path: `${output}/${theme}.png` });
    await editor.press("Escape");
  }
  await editor.fill("\\int_0^1 f(x) \\");
  await editor.press("Control+Space");
  await options.first().waitFor({ state: "visible" });
  assert.match(await options.first().textContent(), /积分微分模板/);
  await editor.press("Tab");
  assert.equal(
    await page.locator("#latexSource").inputValue(),
    "\\int_0^1 f(x) \\mathrm{d}x",
  );
  await editor.fill("\\begin{matrix}x&y\n\\end{ma");
  await ghost.waitFor({ state: "visible" });
  await editor.press("Tab");
  assert.equal(
    await page.locator("#latexSource").inputValue(),
    "\\begin{matrix}x&y\n\\end{matrix}",
  );
  await editor.fill("x^");
  await ghost.waitFor({ state: "visible" });
  await editor.press("Tab");
  assert.equal(await page.locator("#latexSource").inputValue(), "x^{2}");
  await editor.fill("% \\sq");
  assert.equal(await ghost.count(), 0);
  await editor.fill("\\unknown");
  assert.equal(await ghost.count(), 0);
  const beforePublicAcceptance = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("latexsnipper.formula-completion-preferences.v1"),
      ).entries,
  );
  await editor.fill("\\co");
  await ghost.waitFor({ state: "visible" });
  await editor.press("Tab");
  assert.equal(await page.locator("#latexSource").inputValue(), "\\cos");
  assert.ok(
    await page.evaluate((before) => {
      const value = JSON.parse(
        localStorage.getItem("latexsnipper.formula-completion-preferences.v1"),
      );
      return Object.entries(value.entries).some(
        ([key, entry]) =>
          Number(key.slice(1)) >= 13 && !before[key] && entry.count === 1,
      );
    }, beforePublicAcceptance),
  );
  await page.evaluate(() => {
    localStorage.setItem(
      "latexsnipper.custom-symbols.v1",
      JSON.stringify([
        {
          symbol: {
            id: "inline-fixture",
            name: "补全验证符号",
            latexCommand: "\\mysuggest",
          },
          svg: {
            mimeType: "image/svg+xml",
            dataBase64: btoa(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path d="M1 5h18" stroke="#2563eb"/></svg>',
            ),
          },
        },
      ]),
    );
    window.dispatchEvent(
      new Event("latexsnipper:custom-symbol-library-changed"),
    );
  });
  await editor.fill("\\mysu");
  await ghost.waitFor({ state: "visible" });
  await editor.press("Control+Space");
  await options.first().waitFor({ state: "visible" });
  assert.match(await options.first().textContent(), /已保存符号/);
  await editor.press("Tab");
  assert.equal(await page.locator("#latexSource").inputValue(), "\\mysuggest");
  await page.evaluate(() => {
    localStorage.removeItem("latexsnipper.custom-symbols.v1");
    window.dispatchEvent(
      new Event("latexsnipper:custom-symbol-library-changed"),
    );
  });
  await editor.fill("\\mysu");
  assert.equal(await ghost.count(), 0);
  assert.deepEqual(errors, []);
  const result = {
    pass: true,
    runtime: cdpUrl
      ? "Tauri release WebView2"
      : "Chromium development frontend",
    sourceCommitSha: backend?.sourceCommitSha,
    themes,
    tabAndUndo: true,
    escapedAndSelectedTextGuard: true,
    dynamicIntegralEnvironmentAndScript: true,
    savedSymbolAddAndRemove: true,
    expandedPublicCatalogFeedback: true,
    errors,
    scope: "deterministic structural suggestions, no mathematical inference",
  };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
