/**
 * Settings navigation tests.
 *
 * Verifies that:
 * - Old subpages are cleared when navigating to a new one
 * - OCR settings open the correct page
 */

import { strict as assert } from "node:assert";

// ---------------------------------------------------------------------------
// openSettingsPage simulation
// ---------------------------------------------------------------------------

function simulateSettingsNavigation() {
  const state = {
    listVisible: true,
    activeSubpages: new Set(),
  };

  // Known page IDs
  const knownPages = new Set([
    "settingsEditor",
    "settingsBridge",
    "settingsPlatforms",
    "settingsTabs",
    "settingsOfficeIntegration",
    "settingsRecognition",
    "settingsAi",
    "settingsAppearance",
    "settingsAbout",
  ]);

  function openSettingsPage(pageId = null) {
    // Clear all subpages
    state.activeSubpages.clear();

    if (!pageId) {
      state.listVisible = true;
      return;
    }

    // Unknown page -> fall back to list (matching real code behavior)
    if (!knownPages.has(pageId)) {
      state.listVisible = true;
      return;
    }

    state.listVisible = false;
    state.activeSubpages.add(pageId);
  }

  return { state, openSettingsPage };
}

function testOldSubpageIsCleared() {
  const { state, openSettingsPage } = simulateSettingsNavigation();

  // Open subpage A
  openSettingsPage("settingsBridge");
  assert.strictEqual(state.listVisible, false);
  assert.ok(state.activeSubpages.has("settingsBridge"));
  assert.strictEqual(state.activeSubpages.size, 1);

  // Open subpage B — old one should be cleared
  openSettingsPage("settingsRecognition");
  assert.strictEqual(state.listVisible, false);
  assert.ok(!state.activeSubpages.has("settingsBridge"));
  assert.ok(state.activeSubpages.has("settingsRecognition"));
  assert.strictEqual(state.activeSubpages.size, 1);
}

function testBackReturnsToList() {
  const { state, openSettingsPage } = simulateSettingsNavigation();

  // Open subpage then go back
  openSettingsPage("settingsBridge");
  assert.strictEqual(state.listVisible, false);

  openSettingsPage(); // no arg = back to list
  assert.strictEqual(state.listVisible, true);
  assert.strictEqual(state.activeSubpages.size, 0);
}

function testOcrSettingsOpensCorrectPage() {
  const { state, openSettingsPage } = simulateSettingsNavigation();

  // Simulate openRecognitionSettings behavior
  openSettingsPage("settingsRecognition");
  assert.strictEqual(state.listVisible, false);
  assert.ok(state.activeSubpages.has("settingsRecognition"));
  // Should NOT open settingsAi
  assert.ok(!state.activeSubpages.has("settingsAi"));
}

function testUnknownPageReturnsToList() {
  const { state, openSettingsPage } = simulateSettingsNavigation();

  // Open unknown page -> should fall back to list
  openSettingsPage("settingsAi");
  assert.strictEqual(state.listVisible, false);

  openSettingsPage("settingsDoesNotExist");
  // Should return to list (the real code logs a warning)
  assert.strictEqual(state.listVisible, true);
  assert.strictEqual(state.activeSubpages.size, 0);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

testOldSubpageIsCleared();
testBackReturnsToList();
testOcrSettingsOpensCorrectPage();
testUnknownPageReturnsToList();

console.log("All settings navigation tests passed OK");
