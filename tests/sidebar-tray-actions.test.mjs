import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src", "index.html"), "utf8");
const main = readFileSync(resolve(root, "src", "main.js"), "utf8");
const css = readFileSync(resolve(root, "src", "styles", "main.css"), "utf8");
const tauri = readFileSync(resolve(root, "src-tauri", "src", "lib.rs"), "utf8");

test("formula-library launcher supports click, drag, and an accessible context menu", () => {
  assert.match(html, /id="sidebarTriggerMenu"[\s\S]*?role="menu"/);
  for (const action of ["open", "lock", "reset", "appearance"]) {
    assert.match(html, new RegExp(`data-sidebar-trigger-action="${action}"`));
  }
  assert.match(main, /sidebarTrigger\?\.addEventListener\("click"/);
  assert.match(main, /sidebarTrigger\?\.addEventListener\("pointermove"/);
  assert.match(main, /sidebarTrigger\?\.addEventListener\("contextmenu"/);
  assert.match(main, /latexsnipper\.sidebarTriggerLocked/);
  assert.match(
    main,
    /localStorage\.removeItem\("latexsnipper\.sidebarTriggerTop"\)/,
  );
  assert.match(main, /openSettingsPage\("settingsAppearance"\)/);
  assert.match(css, /\.sidebar-trigger-menu\[hidden\]\s*{\s*display:\s*none/);
});

test("Tauri tray owns explicit left-click toggle and right-click menu actions", () => {
  assert.match(tauri, /show_menu_on_left_click\(false\)/);
  assert.match(tauri, /TRAY_SHOW_ID/);
  assert.match(tauri, /TRAY_HIDE_ID/);
  assert.match(tauri, /TRAY_QUIT_ID/);
  assert.match(tauri, /toggle_main_window\(tray_icon\.app_handle\(\)\)/);
  assert.match(tauri, /CloseRequested\s*{\s*api,\s*\.\./);
  assert.match(tauri, /api\.prevent_close\(\)/);
  assert.match(tauri, /window_to_hide\.hide\(\)/);
});
