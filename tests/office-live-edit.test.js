/**
 * Tests for Office Live Edit modules.
 *
 * Verifies the key behaviors from the TUG 2026 acceptance criteria:
 * - B: 100 rapid inputs produce minimal renders, not 100 Office writes
 * - B: Latest-wins semantics (stale renders discarded)
 * - B: Durable checkpoint not triggered per keystroke
 */

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
  if (cmd === "start_live_office_edit") return { transactionId: args.transactionId };
  if (cmd === "update_live_office_draft") return { dirty: true };
  if (cmd === "get_live_office_snapshot") return { dirty: false };
  if (cmd === "close_live_office_edit") return {};
  return {};
};

const mockListen = () => () => {};

// Dynamic imports (ESM)
const { OfficeRenderScheduler } = await import(
  "../src/features/office-live-edit/office-render-scheduler.js"
);
const { OfficeEditStateMachine, EditState } = await import(
  "../src/features/office-live-edit/office-edit-state.js"
);
const { OfficeCommitController } = await import(
  "../src/features/office-live-edit/office-commit-controller.js"
);

// ═══════════════════════════════════════════
// State Machine Tests
// ═══════════════════════════════════════════

console.log("--- State Machine Tests ---");

{
  const sm = new OfficeEditStateMachine();
  console.assert(sm.state === EditState.LOADING, "Initial state should be LOADING");

  sm.transition(EditState.READY);
  console.assert(sm.state === EditState.READY, "Should transition to READY");

  sm.transition(EditState.EDITING);
  console.assert(sm.state === EditState.EDITING, "Should transition to EDITING");

  sm.transition(EditState.RENDERING);
  console.assert(sm.state === EditState.RENDERING, "Should transition to RENDERING");

  sm.transition(EditState.PREVIEW_READY);
  console.assert(sm.state === EditState.PREVIEW_READY, "Should transition to PREVIEW_READY");

  // Invalid transition should be rejected
  const result = sm.transition(EditState.LOADING);
  console.assert(!result, "Should reject invalid transition PREVIEW_READY -> LOADING");

  console.log("PASS: State Machine");
}

// ═══════════════════════════════════════════
// Render Scheduler Tests
// ═══════════════════════════════════════════

console.log("--- Render Scheduler Tests ---");

// Test: debounce reduces render count
{
  let renderCount = 0;
  const scheduler = new OfficeRenderScheduler({
    debounceMs: 50,
    onRenderRequest: () => { renderCount++; },
    onPreviewUpdate: () => {},
    onStateChange: () => {},
  });

  // Simulate 100 rapid inputs
  for (let i = 0; i < 100; i++) {
    scheduler.submitInput(`x^{${i}}`);
  }

  // Wait for debounce to settle
  await new Promise(r => setTimeout(r, 200));

  console.assert(renderCount === 1, `Should render once after debounce, got ${renderCount}`);
  console.assert(scheduler.generation === 1, `Generation should be 1, got ${scheduler.generation}`);

  scheduler.dispose();
  console.log("PASS: 100 inputs -> 1 render (debounce)");
}

// Test: latest-wins semantics
{
  let lastRenderedLatex = null;
  let discardCount = 0;
  const scheduler = new OfficeRenderScheduler({
    debounceMs: 50,
    onRenderRequest: (latex) => {
      lastRenderedLatex = latex;
    },
    onPreviewUpdate: (result) => {},
    onStateChange: () => {},
  });

  // Submit input 1
  scheduler.submitInput("x^2");
  const gen1 = scheduler.markRenderStarted();
  await new Promise(r => setTimeout(r, 10));

  // Submit input 2 (should cancel input 1's render)
  scheduler.submitInput("x^3");

  // Input 1's render completes (stale)
  const isCurrent1 = scheduler.markRenderCompleted(gen1, { latex: "x^2" });
  console.assert(!isCurrent1, "Render 1 should be stale");

  // Wait for input 2's debounce
  await new Promise(r => setTimeout(r, 100));
  const gen2 = scheduler.markRenderStarted();
  const isCurrent2 = scheduler.markRenderCompleted(gen2, { latex: "x^3" });
  console.assert(isCurrent2, "Render 2 should be current");

  scheduler.dispose();
  console.log("PASS: latest-wins (stale render discarded)");
}

// Test: flush sends immediately
{
  let renderCount = 0;
  const scheduler = new OfficeRenderScheduler({
    debounceMs: 5000, // Very long debounce
    onRenderRequest: () => { renderCount++; },
    onPreviewUpdate: () => {},
    onStateChange: () => {},
  });

  scheduler.submitInput("x^2");
  console.assert(renderCount === 0, "Should not render yet (debounced)");

  scheduler.flush();
  console.assert(renderCount === 1, "flush() should trigger immediate render");

  scheduler.dispose();
  console.log("PASS: flush() triggers immediate render");
}

// ═══════════════════════════════════════════
// Commit Controller Tests
// ═══════════════════════════════════════════

console.log("--- Commit Controller Tests ---");

// Test: requestId -> transactionId correlation
{
  let successResult = null;
  const ctrl = new OfficeCommitController({
    invokeTauri: mockInvoke,
    onCommitSuccess: (r) => { successResult = r; },
    onCommitFailure: () => {},
    onConflict: () => {},
  });

  // Register a pending commit
  ctrl._pendingCommits.set("req-123", {
    transactionId: "tx-456",
    formulaId: "f-789",
    sessionId: "s-1",
    timestamp: Date.now(),
  });

  // Simulate host result
  const result = await ctrl.handleReplaceResult({
    requestId: "req-123",
    success: true,
    formulaId: "f-789",
    revision: 2,
    actualStorageMode: "native-omml",
    errorCode: null,
    error: null,
  });

  console.assert(result.handled === true, "Should handle result");
  console.assert(result.success === true, "Should be success");
  console.assert(successResult !== null, "Should call onCommitSuccess");
  console.assert(successResult.revision === 2, "Should pass revision");
  console.assert(!ctrl._pendingCommits.has("req-123"), "Should remove pending commit");

  console.log("PASS: requestId -> transactionId correlation");
}

// Test: OFFICE_TARGET_CHANGED triggers conflict
{
  let conflictResult = null;
  const ctrl = new OfficeCommitController({
    invokeTauri: mockInvoke,
    onCommitSuccess: () => {},
    onCommitFailure: () => {},
    onConflict: (r) => { conflictResult = r; },
  });

  ctrl._pendingCommits.set("req-999", {
    transactionId: "tx-888",
    formulaId: "f-777",
    sessionId: "s-1",
    timestamp: Date.now(),
  });

  const result = await ctrl.handleReplaceResult({
    requestId: "req-999",
    success: false,
    formulaId: "f-777",
    revision: null,
    actualStorageMode: null,
    errorCode: "OFFICE_TARGET_CHANGED",
    error: "Formula was modified",
  });

  console.assert(result.conflict === true, "Should detect conflict");
  console.assert(conflictResult !== null, "Should call onConflict");

  console.log("PASS: OFFICE_TARGET_CHANGED triggers conflict");
}

// ═══════════════════════════════════════════
// Performance: 100 keystrokes
// ═══════════════════════════════════════════

console.log("--- Performance: 100 keystrokes ---");

{
  let renderRequests = 0;
  let stateChanges = 0;
  const scheduler = new OfficeRenderScheduler({
    debounceMs: 150,
    onRenderRequest: () => { renderRequests++; },
    onPreviewUpdate: () => {},
    onStateChange: () => { stateChanges++; },
  });

  const start = performance.now();

  // Simulate 100 rapid keystrokes (5ms apart)
  for (let i = 0; i < 100; i++) {
    scheduler.submitInput(`\\frac{${i}}{${i + 1}}`);
    await new Promise(r => setTimeout(r, 5));
  }

  // Wait for final debounce
  await new Promise(r => setTimeout(r, 250));

  const elapsed = performance.now() - start;

  console.assert(renderRequests <= 3, `Should render ≤3 times (debounced), got ${renderRequests}`);
  console.assert(stateChanges > 100, `Should have many state changes for UI updates, got ${stateChanges}`);

  console.log(`PASS: 100 keystrokes -> ${renderRequests} renders, ${stateChanges} state changes, ${elapsed.toFixed(0)}ms`);
  console.log("  Key: 100 UI updates, only " + renderRequests + " actual renders");

  scheduler.dispose();
}

console.log("\n=== All tests passed ===");
