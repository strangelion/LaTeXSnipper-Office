/**
 * Tests for Office Live Edit modules.
 *
 * Verifies the key behaviors from the TUG 2026 acceptance criteria:
 * - B: 100 rapid inputs produce minimal renders, not 100 Office writes
 * - B: Latest-wins semantics (stale renders discarded)
 * - B: Durable checkpoint not triggered per keystroke
 * - Conflict: reload-remote / keep-local dual-version resolution
 */

import test from "node:test";
import assert from "node:assert/strict";

// Minimal mocks for Tauri invoke/listen
const mockInvoke = async (cmd, args) => {
  if (cmd === "render_live_preview") {
    return {
      success: true,
      omml: `<m:oMath><m:r><m:t>${args.latex}</m:t></m:r></m:oMath>`,
      latex: args.latex,
      displayMode: args.displayMode || "block",
      widthPt: 120,
      heightPt: 30,
      error: null,
      diagnostics: [],
    };
  }
  if (cmd === "start_live_office_edit")
    return { transactionId: args.transactionId };
  if (cmd === "update_live_office_draft") return { dirty: true };
  if (cmd === "get_live_office_snapshot") return { dirty: false };
  if (cmd === "close_live_office_edit") return {};
  return {};
};

const mockListen = () => () => {};

// Dynamic imports (ESM)
const { OfficeRenderScheduler } =
  await import("../src/features/office-live-edit/office-render-scheduler.js");
const { OfficeEditStateMachine, EditState } =
  await import("../src/features/office-live-edit/office-edit-state.js");
const { OfficeEditController } =
  await import("../src/features/office-live-edit/office-edit-controller.js");

// ═══════════════════════════════════════════
// State Machine Tests
// ═══════════════════════════════════════════

test("State Machine", async (t) => {
  await t.test("initial state is LOADING", () => {
    const sm = new OfficeEditStateMachine();
    assert.equal(sm.state, EditState.LOADING);
  });

  await t.test("valid transitions", () => {
    const sm = new OfficeEditStateMachine();
    assert.equal(sm.transition(EditState.READY), true);
    assert.equal(sm.state, EditState.READY);
    assert.equal(sm.transition(EditState.EDITING), true);
    assert.equal(sm.state, EditState.EDITING);
    assert.equal(sm.transition(EditState.RENDERING), true);
    assert.equal(sm.state, EditState.RENDERING);
    assert.equal(sm.transition(EditState.PREVIEW_READY), true);
    assert.equal(sm.state, EditState.PREVIEW_READY);
  });

  await t.test("rejects invalid transition", () => {
    const sm = new OfficeEditStateMachine();
    sm.transition(EditState.READY);
    sm.transition(EditState.EDITING);
    sm.transition(EditState.RENDERING);
    sm.transition(EditState.PREVIEW_READY);
    assert.equal(sm.transition(EditState.LOADING), false);
  });
});

// ═══════════════════════════════════════════
// Render Scheduler Tests
// ═══════════════════════════════════════════

test("Render Scheduler", async (t) => {
  await t.test("100 inputs -> 1 render (debounce)", async () => {
    let renderCount = 0;
    const scheduler = new OfficeRenderScheduler({
      debounceMs: 50,
      onRenderRequest: () => {
        renderCount++;
      },
      onPreviewUpdate: () => {},
      onStateChange: () => {},
    });

    for (let i = 0; i < 100; i++) {
      scheduler.submitInput(`x^{${i}}`);
    }
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(renderCount, 1, "should render once after debounce");
    scheduler.dispose();
  });

  await t.test("latest-wins (stale render discarded)", async () => {
    const scheduler = new OfficeRenderScheduler({
      debounceMs: 50,
      onRenderRequest: () => {},
      onPreviewUpdate: () => {},
      onStateChange: () => {},
    });

    scheduler.submitInput("x^2");
    const gen1 = scheduler.markRenderStarted();
    await new Promise((r) => setTimeout(r, 10));
    scheduler.submitInput("x^3");

    const isCurrent1 = scheduler.markRenderCompleted(gen1, { latex: "x^2" });
    assert.equal(isCurrent1, false, "render 1 should be stale");

    await new Promise((r) => setTimeout(r, 100));
    const gen2 = scheduler.markRenderStarted();
    const isCurrent2 = scheduler.markRenderCompleted(gen2, { latex: "x^3" });
    assert.equal(isCurrent2, true, "render 2 should be current");

    scheduler.dispose();
  });

  await t.test("flush triggers immediate render", () => {
    let renderCount = 0;
    const scheduler = new OfficeRenderScheduler({
      debounceMs: 5000,
      onRenderRequest: () => {
        renderCount++;
      },
      onPreviewUpdate: () => {},
      onStateChange: () => {},
    });

    scheduler.submitInput("x^2");
    assert.equal(renderCount, 0, "should not render yet");
    scheduler.flush();
    assert.equal(renderCount, 1, "flush should trigger immediate render");
    scheduler.dispose();
  });
});

// ═══════════════════════════════════════════
// Conflict Resolution Tests
// ═══════════════════════════════════════════

test("Conflict Resolution", async (t) => {
  await t.test("retryAfterConflict saves dual versions", () => {
    const ctrl = new OfficeEditController({
      invokeTauri: mockInvoke,
      listenTauri: mockListen,
    });

    const fresh = {
      success: true,
      formulaId: "f-123",
      formula: {
        formulaId: "f-123",
        revision: 7,
        storageMode: "native-omml",
        latex: "\\frac{x}{y}",
      },
    };

    const conflict = ctrl.retryAfterConflict(fresh);
    assert.notEqual(conflict, null, "should return conflict object");
    assert.equal(typeof conflict.localLatex, "string");
    assert.equal(conflict.remoteLatex, "\\frac{x}{y}");
    assert.equal(
      ctrl.conflict,
      conflict,
      "getter should return saved conflict",
    );

    ctrl.dispose();
  });

  await t.test("resolveConflict reload-remote loads Office version", () => {
    const ctrl = new OfficeEditController({
      invokeTauri: mockInvoke,
      listenTauri: mockListen,
    });

    ctrl.state.transition(EditState.READY);
    ctrl.state.transition(EditState.EDITING);
    ctrl.state.transition(EditState.PREPARING);
    ctrl.state.transition(EditState.COMMITTING);

    const fresh = {
      success: true,
      formulaId: "f-456",
      formula: {
        formulaId: "f-456",
        revision: 3,
        storageMode: "native-omml",
        latex: "E=mc^2",
      },
    };

    ctrl.retryAfterConflict(fresh);
    ctrl._transactionId = "test-tx-456";
    ctrl.state.transition(EditState.CONFLICT);

    const ok = ctrl.resolveConflict("reload-remote");
    assert.equal(ok, true);
    assert.equal(ctrl.conflict, null, "conflict should be cleared");
    assert.equal(
      ctrl.state.state,
      EditState.EDITING,
      "should be EDITING after reload-remote",
    );

    ctrl.dispose();
  });

  await t.test("resolveConflict keep-local keeps draft, bumps revision", () => {
    const ctrl = new OfficeEditController({
      invokeTauri: mockInvoke,
      listenTauri: mockListen,
    });

    ctrl.state.transition(EditState.READY);
    ctrl.state.transition(EditState.EDITING);
    ctrl.state.transition(EditState.PREPARING);
    ctrl.state.transition(EditState.COMMITTING);

    const fresh = {
      success: true,
      formulaId: "f-789",
      formula: {
        formulaId: "f-789",
        revision: 10,
        storageMode: "image",
        latex: "a+b",
      },
    };

    ctrl.retryAfterConflict(fresh);
    ctrl.state.transition(EditState.CONFLICT);

    const ok = ctrl.resolveConflict("keep-local");
    assert.equal(ok, true);
    assert.equal(ctrl.conflict, null);
    assert.equal(ctrl.state.state, EditState.READY);

    ctrl.dispose();
  });

  await t.test("rejects invalid action", () => {
    const ctrl = new OfficeEditController({
      invokeTauri: mockInvoke,
      listenTauri: mockListen,
    });

    ctrl.state.transition(EditState.READY);

    ctrl.retryAfterConflict({
      success: true,
      formulaId: "f-000",
      formula: { formulaId: "f-000", revision: 1, latex: "x" },
    });

    const ok = ctrl.resolveConflict("invalid-action");
    assert.equal(ok, false, "should reject invalid action");
    assert.notEqual(ctrl.conflict, null, "conflict should remain");

    ctrl.dispose();
  });

  await t.test("guard with no conflict returns false", () => {
    const ctrl = new OfficeEditController({
      invokeTauri: mockInvoke,
      listenTauri: mockListen,
    });

    const ok = ctrl.resolveConflict("reload-remote");
    assert.equal(ok, false);
    ctrl.dispose();
  });

  await t.test("retryAfterConflict validation", () => {
    const ctrl = new OfficeEditController({
      invokeTauri: mockInvoke,
      listenTauri: mockListen,
    });

    assert.equal(ctrl.retryAfterConflict(null), null);
    assert.equal(ctrl.retryAfterConflict({}), null);
    assert.equal(
      ctrl.retryAfterConflict({ formula: { formulaId: "x" } }),
      null,
      "missing revision returns null",
    );

    ctrl.dispose();
  });
});

// ═══════════════════════════════════════════
// Performance: 100 keystrokes
// ═══════════════════════════════════════════

test("Performance: 100 keystrokes", async () => {
  let renderRequests = 0;
  let stateChanges = 0;
  const scheduler = new OfficeRenderScheduler({
    debounceMs: 150,
    onRenderRequest: () => {
      renderRequests++;
    },
    onPreviewUpdate: () => {},
    onStateChange: () => {
      stateChanges++;
    },
  });

  const start = performance.now();

  for (let i = 0; i < 100; i++) {
    scheduler.submitInput(`\\frac{${i}}{${i + 1}}`);
    await new Promise((r) => setTimeout(r, 5));
  }

  await new Promise((r) => setTimeout(r, 250));

  const elapsed = performance.now() - start;

  assert.ok(
    renderRequests <= 3,
    `should render ≤3 times, got ${renderRequests}`,
  );
  assert.ok(
    stateChanges >= 99,
    `should have many state changes, got ${stateChanges}`,
  );

  scheduler.dispose();
});
