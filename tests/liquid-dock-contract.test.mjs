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

describe("LiquidDockController fluid-pointer mode", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let rafCalls = 0;
  let cancelled = 0;

  function withRaf(fn) {
    globalThis.requestAnimationFrame = () => {
      rafCalls++;
      return rafCalls;
    };
    globalThis.cancelAnimationFrame = () => cancelled++;
    try {
      return fn();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  }

  function makeFluidDock({ onSelect } = {}) {
    const item = new StubElement({ disabled: false });
    item.setAttribute("data-liquid-item", "");
    item.closest = (sel) => (sel === "[data-liquid-item]" ? item : null);
    const { root, lens } = makeDockStub({ items: [item] });
    // Give the root a real-ish bounding rect so droplet math runs.
    root.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 52,
    });
    item.getBoundingClientRect = () => ({
      left: 50,
      top: 10,
      width: 90,
      height: 32,
    });
    const dock = new LiquidDockController(root, {
      quality: "full",
      interactionMode: "fluid-pointer",
      onSelect,
    });
    return { dock, root, lens, item };
  }

  it("tracks the cursor continuously on every pointermove", () => {
    withRaf(() => {
      const { dock, root } = makeFluidDock();
      // First move enters the dock and sets the droplet position.
      dock.onPointerEnter();
      dock.onPointerMove({ target: null, clientX: 100, clientY: 20 });
      const p1 = { ...dock.droplet };
      // Move again within the same "item" region: position must update.
      dock.onPointerMove({ target: null, clientX: 160, clientY: 24 });
      assert.notEqual(dock.droplet.pointerX, p1.pointerX, "pointerX tracks");
      assert.notEqual(dock.droplet.pointerY, p1.pointerY, "pointerY tracks");
      // The lens becomes visible once the RAF loop runs.
      dock.animate();
      assert.equal(root.dataset.lensVisible, "true");
      dock.destroy();
    });
  });

  it("velocity is computed on every move (stretch input)", () => {
    withRaf(() => {
      const { dock } = makeFluidDock();
      dock.onPointerEnter();
      dock.onPointerMove({ target: null, clientX: 100, clientY: 20 });
      dock.onPointerMove({ target: null, clientX: 130, clientY: 20 });
      assert.ok(Math.abs(dock.droplet.velocityX) > 0, "velocityX non-zero");
      dock.destroy();
    });
  });

  it("click captures the droplet onto the item and fires onSelect once", () => {
    withRaf(() => {
      let selects = 0;
      const { dock, root, item } = makeFluidDock({
        onSelect: () => selects++,
      });
      dock.setSelectedItem(item);
      assert.equal(selects, 1, "onSelect fired once");
      assert.equal(item.getAttribute("aria-selected"), "true");
      assert.equal(!!dock.droplet.captureItem, true, "droplet captured");
      // The droplet becomes visible when the RAF loop runs.
      dock.animate();
      assert.equal(root.dataset.lensVisible, "true");
      dock.destroy();
    });
  });

  it("pointer leave returns the droplet to the selected item (needs frames)", () => {
    withRaf(() => {
      const { dock, item } = makeFluidDock();
      dock.onPointerEnter();
      dock.onPointerMove({ target: null, clientX: 300, clientY: 40 });
      dock.setSelectedItem(item);
      dock.onPointerLeave();
      assert.equal(dock.droplet.inside, false, "inside cleared");
      assert.equal(dock.droplet.captureItem, null, "capture cleared");
      dock.destroy();
    });
  });

  it("resolveCurrentItem falls back to selection in fluid-pointer mode", () => {
    withRaf(() => {
      const { dock, item } = makeFluidDock();
      const other = new StubElement({ disabled: false });
      dock.hoverItem = other;
      dock.selectedItem = item;
      // Hover must NOT resolve as the current item (droplet is free).
      assert.equal(dock.resolveCurrentItem(), item);
      dock.destroy();
    });
  });
});

describe("LiquidDockController static quality sync", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let rafCalled = false;

  function withRaf(fn) {
    globalThis.requestAnimationFrame = () => {
      rafCalled = true;
      return 1;
    };
    globalThis.cancelAnimationFrame = () => {};
    try {
      return fn();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  }

  function makeStaticDock() {
    const itemA = new StubElement({ disabled: false });
    itemA.setAttribute("data-liquid-item", "");
    itemA.closest = (s) => (s === "[data-liquid-item]" ? itemA : null);
    itemA.getBoundingClientRect = () => ({
      left: 50,
      top: 10,
      width: 90,
      height: 32,
    });
    const itemB = new StubElement({ disabled: false });
    itemB.setAttribute("data-liquid-item", "");
    itemB.closest = (s) => (s === "[data-liquid-item]" ? itemB : null);
    itemB.getBoundingClientRect = () => ({
      left: 160,
      top: 10,
      width: 90,
      height: 32,
    });
    const { root } = makeDockStub({ items: [itemA, itemB] });
    root.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 52,
    });
    const dock = new LiquidDockController(root, {
      quality: "static",
      interactionMode: "fluid-pointer",
    });
    return { dock, root, itemA, itemB };
  }

  it("static quality snaps the droplet on setSelectedItem without RAF", () => {
    withRaf(() => {
      rafCalled = false;
      const { dock, itemA, itemB } = makeStaticDock();
      dock.setSelectedItem(itemA, { snap: true });
      const aX = dock.droplet.x;
      // Select B: the droplet must jump immediately, not wait for a frame.
      dock.setSelectedItem(itemB);
      assert.equal(rafCalled, false, "no RAF scheduled in static mode");
      assert.notEqual(
        dock.droplet.x,
        aX,
        "droplet position changed immediately",
      );
      assert.equal(
        dock.droplet.targetX,
        dock.droplet.x,
        "target synced for static",
      );
      assert.equal(dock.root.dataset.lensVisible, "true");
      dock.destroy();
    });
  });

  it("static quality stays visible and aligned after selection", () => {
    withRaf(() => {
      const { dock, root, itemB } = makeStaticDock();
      dock.setSelectedItem(itemB, { snap: true });
      assert.equal(root.dataset.lensVisible, "true");
      const bRect = itemB.getBoundingClientRect();
      const bCenter = bRect.left + bRect.width / 2;
      const dropletCenter = dock.droplet.x + dock.droplet.w / 2;
      assert.ok(
        Math.abs(dropletCenter - bCenter) < 1,
        "droplet centre aligns with item B",
      );
      dock.destroy();
    });
  });

  it("static quality follows the pointer via magnet target, not RAF", () => {
    withRaf(() => {
      rafCalled = false;
      const { dock, itemA } = makeStaticDock();
      dock.setSelectedItem(itemA, { snap: true });
      const before = dock.droplet.x;
      // Pointer moves onto item B (inside=true → magnet target follows).
      dock.droplet.inside = true;
      dock.droplet.pointerX = 205;
      dock.droplet.pointerY = 26;
      dock.scheduleFrame();
      assert.equal(rafCalled, false, "static never schedules a RAF");
      assert.notEqual(
        dock.droplet.x,
        before,
        "droplet snaps toward the pointer immediately",
      );
      assert.equal(
        dock.droplet.targetX,
        dock.droplet.x,
        "static keeps target == current",
      );
      dock.destroy();
    });
  });

  it("static quality snaps back to the selected item on leave", () => {
    withRaf(() => {
      const { dock, itemA } = makeStaticDock();
      dock.setSelectedItem(itemA, { snap: true });
      // Pointer leaves while on item B.
      dock.droplet.inside = true;
      dock.droplet.pointerX = 205;
      dock.droplet.pointerY = 26;
      dock.scheduleFrame();
      const onB = dock.droplet.x;
      dock.droplet.inside = false;
      dock.scheduleFrame();
      const aRect = itemA.getBoundingClientRect();
      const aCenter = aRect.left + aRect.width / 2;
      const dropletCenter = dock.droplet.x + dock.droplet.w / 2;
      assert.ok(
        Math.abs(dropletCenter - aCenter) < 1,
        "droplet returns to the selected item on leave",
      );
      assert.notEqual(dock.droplet.x, onB, "droplet actually moved");
      dock.destroy();
    });
  });
});

describe("LiquidDockController reanchor", () => {
  function withRaf(fn) {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    try {
      return fn();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  }

  function makeFluidDock() {
    const itemA = new StubElement({ disabled: false });
    itemA.setAttribute("data-liquid-item", "");
    itemA.closest = (s) => (s === "[data-liquid-item]" ? itemA : null);
    itemA.getBoundingClientRect = () => ({
      left: 50,
      top: 10,
      width: 90,
      height: 32,
    });
    const { root } = makeDockStub({ items: [itemA] });
    root.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 52,
    });
    const dock = new LiquidDockController(root, {
      quality: "full",
      interactionMode: "fluid-pointer",
    });
    return { dock, root, itemA };
  }

  it("reanchorSelectedItem re-places the droplet on the item's current centre", () => {
    withRaf(() => {
      const { dock, root, itemA } = makeFluidDock();
      dock.setSelectedItem(itemA, { snap: true });
      // Item moves after layout stabilisation (fonts/DPI/zoom).
      itemA.getBoundingClientRect = () => ({
        left: 90,
        top: 12,
        width: 110,
        height: 34,
      });
      dock.reanchorSelectedItem({ snap: true });
      const r = itemA.getBoundingClientRect();
      const movedCx = r.left + r.width / 2;
      const dropletCenter = dock.droplet.x + dock.droplet.w / 2;
      assert.ok(
        Math.abs(dropletCenter - movedCx) < 1,
        "droplet re-anchored onto the moved item",
      );
      assert.equal(root.dataset.lensVisible, "true");
      dock.destroy();
    });
  });

  it("reanchor does not fire onSelect or change aria-selected", () => {
    withRaf(() => {
      let selects = 0;
      const { dock, itemA } = makeFluidDock();
      dock.onSelect = () => selects++;
      dock.setSelectedItem(itemA, { snap: true });
      const afterSelect = selects;
      const before = itemA.getAttribute("aria-selected");
      itemA.getBoundingClientRect = () => ({
        left: 30,
        top: 8,
        width: 100,
        height: 30,
      });
      dock.reanchorSelectedItem({ snap: true });
      assert.equal(
        selects,
        afterSelect,
        "reanchor is not a selection transaction",
      );
      assert.equal(
        itemA.getAttribute("aria-selected"),
        before,
        "aria-selected untouched",
      );
      dock.destroy();
    });
  });

  it("reanchor is skipped while the pointer is actively tracking", () => {
    withRaf(() => {
      const { dock, itemA } = makeFluidDock();
      dock.setSelectedItem(itemA, { snap: true });
      dock.droplet.inside = true;
      const before = dock.droplet.x;
      itemA.getBoundingClientRect = () => ({
        left: 300,
        top: 20,
        width: 90,
        height: 32,
      });
      dock.reanchorSelectedItem({ snap: true });
      assert.equal(dock.droplet.x, before, "no yank while tracking");
      dock.destroy();
    });
  });
});

describe("LiquidDockController axis lock", () => {
  function withRaf(fn) {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    try {
      return fn();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  }

  function makeLockedDock() {
    const itemA = new StubElement({ disabled: false });
    itemA.setAttribute("data-liquid-item", "");
    itemA.closest = (s) => (s === "[data-liquid-item]" ? itemA : null);
    itemA.getBoundingClientRect = () => ({
      left: 50,
      top: 10,
      width: 90,
      height: 32,
    });
    const itemB = new StubElement({ disabled: false });
    itemB.setAttribute("data-liquid-item", "");
    itemB.closest = (s) => (s === "[data-liquid-item]" ? itemB : null);
    itemB.getBoundingClientRect = () => ({
      left: 160,
      top: 10,
      width: 90,
      height: 32,
    });
    const { root } = makeDockStub({ items: [itemA, itemB] });
    root.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 52,
    });
    const dock = new LiquidDockController(root, {
      quality: "full",
      interactionMode: "fluid-pointer",
    });
    return { dock, root, itemA, itemB };
  }

  it("locks Y to the item row regardless of pointer height", () => {
    withRaf(() => {
      const { dock } = makeLockedDock();
      // Row centre = 10 + 16 = 26.
      const low = dock.computeDropletGeometry({ x: 205, y: 5 });
      const high = dock.computeDropletGeometry({ x: 205, y: 48 });
      assert.equal(low.y + low.h / 2, 26, "Y locked at row centre (low)");
      assert.equal(high.y + high.h / 2, 26, "Y locked at row centre (high)");
      dock.destroy();
    });
  });

  it("clamps X to the label span when the pointer goes beyond", () => {
    withRaf(() => {
      const { dock } = makeLockedDock();
      // Label span: itemA left 50 … itemB right 250.
      const left = dock.computeDropletGeometry({ x: -200, y: 26 });
      const right = dock.computeDropletGeometry({ x: 900, y: 26 });
      assert.ok(
        left.x + left.w / 2 >= 50 - 2,
        `droplet centre does not escape left edge (got ${left.x + left.w / 2})`,
      );
      assert.ok(
        right.x + right.w / 2 <= 250 + 2,
        `droplet centre does not escape right edge (got ${right.x + right.w / 2})`,
      );
      dock.destroy();
    });
  });

  it("slides freely between items (not snapped to a single column)", () => {
    withRaf(() => {
      const { dock } = makeLockedDock();
      const mid = dock.computeDropletGeometry({ x: 180, y: 26 });
      assert.ok(mid.x + mid.w / 2 > 100, "droplet can rest between items");
      assert.ok(mid.x + mid.w / 2 < 250, "droplet stays within span");
      dock.destroy();
    });
  });
});
