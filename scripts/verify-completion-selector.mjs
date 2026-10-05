// Local selector UI proof, not a learned-model quality or mathematical-accuracy benchmark.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

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
if (!executablePath) throw new Error("No Chromium browser is available");
const output = "output/playwright/completion-selector";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:2100/", {
    waitUntil: "networkidle",
  });
  const editor = page.locator("#formulaSourceEditor .cm-content");
  const toggle = page.getByRole("checkbox", { name: "本地偏好排序（实验）" });
  await toggle.waitFor({ state: "visible" });
  assert.equal(await toggle.isChecked(), false);
  const key = "latexsnipper.formula-completion-preferences.v1";
  const read = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  async function chooseRoot() {
    await editor.fill("\\");
    await editor.press("Control+Space");
    await page.getByRole("option").filter({ hasText: "\\sqrt{}" }).click();
    assert.equal(await page.locator("#latexSource").inputValue(), "\\sqrt{}");
  }
  await chooseRoot();
  assert.equal(await read(), null, "Disabled selector learned from acceptance");
  await toggle.check();
  await chooseRoot();
  assert.equal((await read()).entries.c1.count, 1);
  await editor.press("Control+z");
  assert.equal(await page.locator("#latexSource").inputValue(), "\\");
  assert.equal(
    (await read()).entries.c1,
    undefined,
    "Immediate undo retained preference feedback",
  );
  await chooseRoot();
  await editor.fill("\\");
  await editor.press("Control+Space");
  const suggestions = page.locator(".cm-tooltip-autocomplete [role='option']");
  await suggestions.first().waitFor({ state: "visible" });
  assert.match(await suggestions.first().textContent(), /\\sqrt/);
  await editor.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await toggle.isChecked(), true);
  assert.equal((await read()).entries.c1.count, 1);
  await editor.fill("private-fixture-text-not-to-be-stored");
  assert.ok(!JSON.stringify(await read()).includes("private-fixture"));
  const timing = await page.evaluate(async () => {
    const { createCompletionSelector } =
      await import("/features/formula-source/completion-selector.js");
    const selector = createCompletionSelector(["a", "b", "c"]);
    selector.setEnabled(true);
    selector.accept("b");
    const durations = Array.from({ length: 1000 }, () => {
      const start = performance.now();
      selector.rank();
      return performance.now() - start;
    }).sort((a, b) => a - b);
    return {
      samples: 1000,
      p95Milliseconds: durations[949],
      candidateCount: 3,
    };
  });
  await page.screenshot({ path: join(output, "controls.png") });
  await page.getByRole("button", { name: "清空偏好", exact: true }).click();
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await read(), null);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await toggle.isChecked(), false);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      { pass: true, timing, errors, scope: "synthetic local-selector UI only" },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ pass: true, timing, errors }));
} finally {
  await browser.close();
}
