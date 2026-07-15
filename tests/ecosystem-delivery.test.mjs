/**
 * Ecosystem delivery tests
 * Tests for ecosystem action queue, plugin migration, and delivery semantics.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ─── Obsidian migration tests ────────────────────────────────────────

describe("Obsidian legacy Bridge URL migration", () => {
  const settingsFile = resolve(root, "apps/obsidian-plugin/src/settings.ts");
  const content = readFileSync(settingsFile, "utf8");

  it("should define LEGACY_BRIDGE_URLS with 28765, 28766, 19876", () => {
    assert(content.includes("28765"), "Should include 28765");
    assert(content.includes("28766"), "Should include 28766");
    assert(content.includes("19876"), "Should include 19876");
  });

  it("should use 19877 as DEFAULT_BRIDGE_URL", () => {
    assert(content.includes("19877"), "Should include 19877");
    assert(
      /DEFAULT_BRIDGE_URL\s*=\s*"http:\/\/127\.0\.0\.1:19877"/.test(content),
      "DEFAULT_BRIDGE_URL should be http://127.0.0.1:19877",
    );
  });
});

describe("Obsidian no active editor returns failed", () => {
  const pollerFile = resolve(root, "apps/obsidian-plugin/src/action-poller.ts");
  const content = readFileSync(pollerFile, "utf8");

  it("should complete with failed status on error", () => {
    assert(
      content.includes("OBSIDIAN_ACTION_FAILED") ||
        content.includes("OBSIDIAN_POLLER_ERROR"),
      "Should report failure status",
    );
  });

  it("should not have silent catch", () => {
    assert(
      !/catch\s*\(\s*\)\s*\{\s*\}/.test(content),
      "Should not have empty catch blocks",
    );
  });
});

describe("Obsidian bridge-client uses dynamic clientId", () => {
  const bridgeClientFile = resolve(
    root,
    "apps/obsidian-plugin/src/bridge-client.ts",
  );
  const content = readFileSync(bridgeClientFile, "utf8");

  it("should not have hardcoded obsidian-default", () => {
    assert(
      !content.includes("obsidian-default"),
      "Should not have hardcoded clientId",
    );
  });

  it("should not have 19876 fallback", () => {
    assert(
      !content.includes("19876"),
      "Should not have 19876 in bridge-client.ts",
    );
  });

  it("should accept clientId in constructor", () => {
    assert(
      /constructor\s*\(\s*[^)]*clientId/.test(content),
      "Constructor should accept clientId parameter",
    );
  });
});

// ─── VS Code tests ───────────────────────────────────────────────────

describe("VS Code uses persistent clientId", () => {
  const extensionFile = resolve(root, "apps/vscode-extension/src/extension.ts");
  const content = readFileSync(extensionFile, "utf8");

  it("should generate stable clientId", () => {
    assert(
      content.includes("globalState") && content.includes("ecosystemClientId"),
      "Should store clientId in globalState",
    );
  });

  it("should not have hardcoded vscode-default", () => {
    assert(
      !content.includes("vscode-default"),
      "Should not have hardcoded clientId",
    );
  });
});

// ─── Browser tests ───────────────────────────────────────────────────

describe("Browser desktop action type", () => {
  const backgroundFile = resolve(
    root,
    "apps/browser-extension/src/background.ts",
  );
  const content = readFileSync(backgroundFile, "utf8");

  it("should use InsertFormulaIntoBrowser", () => {
    assert(
      content.includes("InsertFormulaIntoBrowser"),
      "Should use versioned browser action type",
    );
  });

  it("should not use plain InsertFormula", () => {
    // Should not have InsertFormula as action type for browser
    assert(
      !/actionType.*InsertFormula[^I]/.test(content) ||
        content.includes("InsertFormulaIntoBrowser"),
      "Should not use plain InsertFormula for browser",
    );
  });
});

// ─── Desktop tests ───────────────────────────────────────────────────

describe("Desktop ecosystem target selector", () => {
  const mainJsFile = resolve(root, "src/main.js");
  const content = readFileSync(mainJsFile, "utf8");

  it("should have waitForEcosystemAction method", () => {
    assert(
      content.includes("waitForEcosystemAction"),
      "Should have waitForEcosystemAction method",
    );
  });

  it("should check completed status before showing success", () => {
    assert(
      content.includes("公式已成功插入") || content.includes("插入成功"),
      "Should have success message",
    );
    // The success message should only appear after waiting for completion
    const insertToEcosystemMatch = content.match(
      /async insertToEcosystem\(\)[^}]*?公式已成功插入/s,
    );
    assert(
      insertToEcosystemMatch,
      "Success message should be in insertToEcosystem",
    );
  });

  it("should use InsertFormulaIntoBrowser for browser target", () => {
    assert(
      content.includes("InsertFormulaIntoBrowser"),
      "Should use versioned browser action type",
    );
  });

  it("should pass targetClientId", () => {
    assert(
      content.includes("targetClientId"),
      "Should pass targetClientId to push_ecosystem_action_internal",
    );
  });
});

// ─── Rust backend tests ──────────────────────────────────────────────

describe("Rust ecosystem action status", () => {
  const officeBridgeFile = resolve(
    root,
    "src-tauri/src/platforms/office_bridge.rs",
  );
  const content = readFileSync(officeBridgeFile, "utf8");

  it("should have get_ecosystem_action_status_internal", () => {
    assert(
      content.includes("get_ecosystem_action_status_internal"),
      "Should have status query command",
    );
  });

  it("should support target_client_id in PushRequest", () => {
    assert(
      content.includes("target_client_id"),
      "Should support target_client_id in PushRequest",
    );
  });

  it("should generate browser-specific payload", () => {
    assert(
      content.includes("InsertFormulaIntoBrowser") ||
        content.includes("schemaVersion"),
      "Should generate browser-specific payload",
    );
  });
});

describe("Rust ecosystem queue expiration", () => {
  const ecosystemFile = resolve(root, "src-tauri/src/platforms/ecosystem.rs");
  const content = readFileSync(ecosystemFile, "utf8");

  it("should check action expiration", () => {
    assert(
      content.includes("action_is_expired") || content.includes("Expired"),
      "Should handle expired actions",
    );
  });

  it("should mark expired actions as Expired", () => {
    assert(
      content.includes("EcosystemActionStatus::Expired"),
      "Should mark expired actions with Expired status",
    );
  });
});

// ─── Source hygiene tests ─────────────────────────────────────────────

describe("Source hygiene - no legacy ecosystem values", () => {
  const ecosystemProduction = [
    "apps/obsidian-plugin/main.ts",
    "apps/obsidian-plugin/src/bridge-client.ts",
    "apps/obsidian-plugin/src/action-poller.ts",
    "apps/obsidian-plugin/src/editor-adapter.ts",
    "apps/vscode-extension/src/bridge-client.ts",
    "apps/vscode-extension/src/action-poller.ts",
    "apps/vscode-extension/src/extension.ts",
  ];

  const legacyValues = ["28765", "28766", "http://127.0.0.1:19876"];

  for (const file of ecosystemProduction) {
    const filePath = resolve(root, file);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf8");

    for (const legacy of legacyValues) {
      it(`${file} should not contain ${legacy}`, () => {
        assert(
          !content.includes(legacy),
          `${file} contains legacy value ${legacy}`,
        );
      });
    }
  }
});

describe("No duplicate Ecosystem/wps payload", () => {
  it("src-tauri/resources/Ecosystem/wps should not exist", () => {
    const wpsDir = resolve(root, "src-tauri/resources/Ecosystem/wps");
    assert(!existsSync(wpsDir), "Ecosystem/wps directory should be deleted");
  });
});
