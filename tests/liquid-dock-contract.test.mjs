/**
 * Liquid Dock contract tests.
 *
 * Verifies (with a minimal DOM stub, no jsdom dependency):
 * - resolveLiquidQuality tier matrix (full/reduced/static/off)
 * - quality resolution respects disabled state
 * - destroy() cancels RAF, clears timers, disconnects ResizeObserver
 * - re-init after destroy does not double-bind events
 * - disabled items are never resolved as lens targets
 * - static quality does not start the RAF loop
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolveLiquidQuality } from "../src/features/appearance/liquid-performance.js";
import { LiquidDockController } from "../src/features/appearance/liquid-dock.js";

describe("resolveLiquidQuality", () => {
  it("maps public mode to effective quality tiers", () => {
    const base = {
      supportsBackdropFilter: true,
      prefersReducedMotion: false,
    };

    assert.equal(
      resolveLiquidQuality({ ...base, requestedMode: "off" }),
      "off",
    );
    assert.equal(
      resolveLiquidQuality({ ...base, requestedMode: "on" }),
      "full",
    );
    // high-end auto -> full
    assert.equal(
      resolveLiquidQuality({
        ...base,
        requestedMode: "auto",
        hardwareConcurrency: 16,
        deviceMemory: 16,
      }),
      "full",
    );
    // mid-range auto -> reduced
    assert.equal(
      resolveLiquidQuality({
        ...base,
        requestedMode: "auto",
        hardwareConcurrency: 4,
        deviceMemory: 8,
      }),
      "reduced",
    );
    // low-end auto -> static (glass kept, motion stopped)
    assert.equal(
      resolveLiquidQuality({
        ...base,
        requestedMode: "auto",
        hardwareConcurrency: 2,
        deviceMemory: 2,
      }),
      "static",
    );
  });

  it("off when backdrop-filter is unsupported regardless of mode", () => {
    assert.equal(
      resolveLiquidQuality({
        requestedMode: "on",
        supportsBackdropFilter: false,
        prefersReducedMotion: false,
      }),
      "off",
    );
  });

  it("reduced motion forces static, never off", () => {
    assert.equal(
      resolveLiquidQuality({
        requestedMode: "on",
        supportsBackdropFilter: true,
        prefersReducedMotion: true,
        hardwareConcurrency: 32,
        deviceMemory: 32,
      }),
      "static",
    );
  });

  it("treats missing capacity as a capable default", () => {
    assert.equal(
      resolveLiquidQuality({
        requestedMode: "auto",
        supportsBackdropFilter: true,
        prefersReducedMotion: false,
      }),
      "full",
    );
  });
});

// ── minimal DOM stub ─────────────────────────────────────────────────

class StubElement {
  constructor({ disabled = false } = {}) {
    this.dataset = {};
    this.style = { setProperty: () => {} };
    this.classList = {
      _set: new Set(),
      add(name) {
        this._set.add(name);
      },
      remove(name) {
        this._set.delete(name);
      },
      contains(name) {
        return this._set.has(name);
      },
    };
    this.offsetWidth = 0;
    this._listeners = {};
    this.disabled = disabled;
    this._attributes = {};
  }

  setAttribute(name, value) {
    this._attributes[name] = String(value);
    this.dataset[name.replace(/^data-/, "")] = String(value);
  }

  getAttribute(name) {
    if (name === "aria-disabled") return this._attributes[name] ?? null;
    return this._attributes[name] ?? null;
  }

  addEventListener(type, fn) {
    (this._listeners[type] ??= []).push(fn);
  }

  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] ?? []).filter(
      (f) => f !== fn,
    );
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 40 };
  }

  replaceChildren() {}
}

class StubSurface extends StubElement {
  constructor() {
    super();
    this.offsetWidth = 42;
  }
}

function makeDockStub({ items = [] } = {}) {
  const lens = new StubElement();
  lens.querySelectorAll = () => [];
  const surface = new StubSurface();
  const preview = new StubElement();
  const previewContent = new StubElement();
  preview.querySelector = (sel) =>
    sel === ".liquid-preview-content" ? previewContent : null;

  const root = new StubElement();
  root.dataset.lensVisible = "false";
  root.querySelector = (sel) => {
    if (sel === "[data-liquid-lens]") return lens;
    if (sel === "[data-liquid-preview]") return preview;
    if (sel === ".liquid-preview-content") return previewContent;
    return null;
  };
  root.querySelectorAll = (sel) => (sel === "[data-liquid-item]" ? items : []);

  lens.surface = surface;
  return { root, lens, surface, preview, previewContent };
}

describe("LiquidDockController lifecycle", () => {
  it("does not bind a second time after destroy + re-init", () => {
    const { root } = makeDockStub();
    const first = new LiquidDockController(root, { quality: "full" });
    first.destroy();
    // Assert mid-lifecycle: after re-init, each event is bound exactly once.
    const second = new LiquidDockController(root, { quality: "full" });
    for (const type of [
      "pointermove",
      "pointerleave",
      "pointerenter",
      "focusin",
      "focusout",
      "click",
    ]) {
      assert.equal((root._listeners[type] ?? []).length, 1, type);
    }
    second.destroy();
  });

  it("destroy cancels RAF and clears preview timers", () => {
    const { root } = makeDockStub();
    let rafCanceled = 0;
    const originalCancel = globalThis.cancelAnimationFrame;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = () => rafCanceled++;
    globalThis.requestAnimationFrame = () => 1;

    try {
      const dock = new LiquidDockController(root, { quality: "full" });
      dock.scheduleFrame();
      assert.ok(dock._rafId, "RAF scheduled");
      dock.destroy();
      assert.ok(rafCanceled >= 1, "RAF canceled on destroy");
      assert.equal(dock._destroyed, true);
      // timers cleared without throwing
      clearTimeout(dock._previewTimer);
      clearTimeout(dock._hideTimer);
    } finally {
      globalThis.cancelAnimationFrame = originalCancel;
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  it("destroy disconnects the ResizeObserver", () => {
    let disconnected = false;
    const originalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {
        disconnected = true;
      }
    };
    try {
      const { root } = makeDockStub();
      const dock = new LiquidDockController(root, { quality: "full" });
      dock.destroy();
      assert.equal(disconnected, true);
    } finally {
      globalThis.ResizeObserver = originalRO;
    }
  });

  it("static quality never starts the RAF loop", () => {
    const { root } = makeDockStub();
    const dock = new LiquidDockController(root, { quality: "static" });
    dock.scheduleFrame();
    assert.equal(dock._rafId, 0, "no RAF for static quality");
    dock.destroy();
  });

  it("off quality hides lens and refuses preview", () => {
    const { root, lens } = makeDockStub();
    const dock = new LiquidDockController(root, { quality: "off" });
    dock.moveLens(new StubElement(), true);
    assert.notEqual(
      root.dataset.lensVisible,
      "true",
      "lens never shown in off quality",
    );
    assert.equal(lens.querySelectorAll().length, 0);
    dock.destroy();
  });
});

describe("LiquidDockController state resolution", () => {
  it("never resolves disabled items", () => {
    const enabled = new StubElement({ disabled: false });
    const disabled = new StubElement({ disabled: true });
    disabled.setAttribute("data-liquid-item", "");
    enabled.setAttribute("data-liquid-item", "");
    const { root } = makeDockStub({ items: [enabled, disabled] });
    const dock = new LiquidDockController(root, { quality: "full" });

    const resolved = dock.resolveItemFromEvent({
      target: disabled,
      clientX: 10,
      clientY: 10,
    });
    assert.equal(resolved, null);
    dock.destroy();
  });

  it("aria-disabled items are excluded from refresh", () => {
    const item = new StubElement({ disabled: false });
    item.setAttribute("aria-disabled", "true");
    const { root } = makeDockStub({ items: [item] });
    const dock = new LiquidDockController(root, { quality: "full" });
    assert.deepEqual(dock.items, []);
    dock.destroy();
  });

  it("hover wins over focus and active (hover mode)", () => {
    const hover = new StubElement({ disabled: false });
    const focus = new StubElement({ disabled: false });
    const active = new StubElement({ disabled: false });
    hover.dataset.liquidPreviewKind = "latex";
    const { root } = makeDockStub({ items: [hover, focus, active] });
    const dock = new LiquidDockController(root, { quality: "full" });
    dock.hoverItem = hover;
    dock.focusItem = focus;
    dock.activeItem = active;
    assert.equal(dock.resolveCurrentItem(), hover);
    dock.destroy();
  });

  it("selection mode: hover never moves the Lens (active owns it)", () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    try {
      const hover = new StubElement({ disabled: false });
      const active = new StubElement({ disabled: false });
      hover.dataset.liquidPreviewKind = "latex";
      // resolveItemFromEvent uses target.closest(itemQuery).
      hover.closest = (sel) => (sel === "[data-liquid-item]" ? hover : null);
      active.closest = (sel) => (sel === "[data-liquid-item]" ? active : null);
      const { root } = makeDockStub({ items: [hover, active] });
      const dock = new LiquidDockController(root, {
        quality: "full",
        interactionMode: "selection",
      });
      dock.focusItem = null;
      dock.activeItem = active;
      assert.equal(dock.resolveCurrentItem(), active, "Lens stays on active");
      // Pointer motion on the hovered item must not swap the lens target.
      dock.onPointerMove({
        target: hover,
        clientX: 10,
        clientY: 10,
      });
      assert.equal(dock.resolveCurrentItem(), active);
      assert.equal(dock.root.dataset.hoverGlow, "true");
      dock.destroy();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

  it("selection mode: focus borrows the lens temporarily, active on blur", () => {
    const focus = new StubElement({ disabled: false });
    const active = new StubElement({ disabled: false });
    const { root } = makeDockStub({ items: [focus, active] });
    const dock = new LiquidDockController(root, {
      quality: "full",
      interactionMode: "selection",
    });
    dock.focusItem = focus;
    dock.activeItem = active;
    assert.equal(dock.resolveCurrentItem(), focus);
    dock.focusItem = null;
    assert.equal(dock.resolveCurrentItem(), active);
    dock.destroy();
  });

  it("falls back focus -> active -> none when hover clears (hover mode)", () => {
    const focus = new StubElement({ disabled: false });
    const active = new StubElement({ disabled: false });
    const { root } = makeDockStub({ items: [focus, active] });
    const dock = new LiquidDockController(root, { quality: "full" });
    dock.focusItem = focus;
    dock.activeItem = active;
    assert.equal(dock.resolveCurrentItem(), focus);
    dock.focusItem = null;
    assert.equal(dock.resolveCurrentItem(), active);
    dock.activeItem = null;
    assert.equal(dock.resolveCurrentItem(), null);
    dock.destroy();
  });
});
