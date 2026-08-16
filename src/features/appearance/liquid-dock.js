// Liquid Glass 2.0 fluid Dock controller.
//
// The Dock is one continuous glass surface; a single independent Liquid
// Lens slides between items with inertia, reacts to the pointer with a
// subtle local offset / micro deformation, and a Context Preview HUD shows
// real business state above the focused control.
//
// All pointer-move work is restricted to: read rects, update target
// numbers, requestAnimationFrame, write CSS custom properties. No layout
// thrashing, no renders, no Tauri invokes per pointermove.

import { resolveLiquidQuality } from "./liquid-performance.js";

// ── pure helpers (unit-tested without a DOM) ─────────────────────────

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(current, target, speed) {
  return current + (target - current) * speed;
}

/**
 * Lens geometry inside the Dock coordinate space.
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function computeLensGeometry(
  dockRect,
  itemRect,
  paddingX = 5,
  paddingY = 5,
) {
  return {
    x: itemRect.left - dockRect.left - paddingX,
    y: itemRect.top - dockRect.top - paddingY,
    width: itemRect.width + paddingX * 2,
    height: itemRect.height + paddingY * 2,
  };
}

/**
 * Local offset targets from the item center (bounded, tiny by design).
 * X bounded to ±7px, Y bounded to ±5px.
 */
export function computeLocalOffsetTargets(clientX, clientY, itemRect) {
  const cx = itemRect.left + itemRect.width / 2;
  const cy = itemRect.top + itemRect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  return {
    targetLocalX: clamp(dx * 0.08, -7, 7),
    targetLocalY: clamp(dy * 0.08, -5, 5),
  };
}

/**
 * Micro droplet deformation targets. Never more than ~±5%.
 */
export function computeDeformationTargets(clientX, clientY, itemRect) {
  const cx = itemRect.left + itemRect.width / 2;
  const cy = itemRect.top + itemRect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const nx = dx / Math.max(1, itemRect.width / 2);
  const ny = dy / Math.max(1, itemRect.height / 2);
  const hx = Math.min(Math.abs(nx), 1);
  const hy = Math.min(Math.abs(ny), 1);
  return {
    targetScaleX: 1 + hx * 0.035 - hy * 0.01,
    targetScaleY: 1 + hy * 0.025 - hx * 0.015,
  };
}

/**
 * Highlight spot position inside the Lens (kept away from the edges).
 */
export function computeHighlightTargets(clientX, clientY, itemRect) {
  const px = clamp(
    (clientX - itemRect.left) / Math.max(1, itemRect.width),
    0,
    1,
  );
  const py = clamp(
    (clientY - itemRect.top) / Math.max(1, itemRect.height),
    0,
    1,
  );
  return {
    targetHighlightX: 20 + px * 60, // 20%..80%
    targetHighlightY: 12 + py * 44, // 12%..56%
  };
}

/**
 * Fluid-pointer droplet target: the droplet follows the cursor freely but
 * is magnetically attracted toward the nearest item centre (partial, never
 * a snap). Returns the dock-local target box plus how strongly the nearest
 * item pulled it (0..1), which also drives the droplet's size blend.
 *
 * @param {{x:number,y:number}} pointer - dock-local cursor position
 * @param {Array<{x:number,y:number,w:number,h:number}>} itemBoxes
 * @param {{magneticRadius:number, magneticStrength:number}} opts
 * @param {{x:number,y:number,w:number,h:number}} fallbackSize - free-droplet size
 * @returns {{x:number,y:number,w:number,h:number,attraction:number,nearest:object|null}}
 */
export function computeDropletTarget(
  pointer,
  itemBoxes,
  opts = {},
  fallbackSize = { x: 0, y: 0, w: 30, h: 26 },
) {
  const magneticRadius = opts.magneticRadius ?? 64;
  const magneticStrength = opts.magneticStrength ?? 0.3;
  const paddingX = opts.paddingX ?? 4;
  const paddingY = opts.paddingY ?? 2;

  let nearest = null;
  let bestDist = Infinity;
  for (const box of itemBoxes) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const d = Math.hypot(pointer.x - cx, pointer.y - cy);
    if (d < bestDist) {
      bestDist = d;
      nearest = { box, cx, cy, dist: d };
    }
  }

  if (!nearest || bestDist > magneticRadius) {
    return {
      x: pointer.x - fallbackSize.w / 2,
      y: pointer.y - fallbackSize.h / 2,
      w: fallbackSize.w,
      h: fallbackSize.h,
      attraction: 0,
      nearest: null,
    };
  }

  const attraction = 1 - clamp(bestDist / magneticRadius, 0, 1);
  const pull = attraction * magneticStrength;
  const targetW = nearest.box.w + paddingX * 2;
  const targetH = nearest.box.h + paddingY * 2;
  const cx = lerp(pointer.x, nearest.cx, pull);
  const cy = lerp(pointer.y, nearest.cy, pull);
  const w = lerp(fallbackSize.w, targetW, attraction);
  const h = lerp(fallbackSize.h, targetH, attraction);
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    attraction,
    nearest,
  };
}

/**
 * Velocity-driven stretch: a fast horizontal sweep makes the droplet
 * elongate in the direction of motion (capped ~9%).
 */
export function computeVelocityStretch(
  velocityX,
  velocityY,
  maxStretch = 0.09,
) {
  const speed = Math.hypot(velocityX, velocityY);
  const stretch = clamp(speed * 0.006, 0, maxStretch);
  if (stretch < 0.001) {
    return { targetScaleX: 1, targetScaleY: 1 };
  }
  const angle = Math.atan2(velocityY, velocityX);
  const sx = 1 + stretch * Math.abs(Math.cos(angle));
  const sy = 1 + stretch * Math.abs(Math.sin(angle));
  return { targetScaleX: sx, targetScaleY: sy };
}

// ── controller ───────────────────────────────────────────────────────

const POINTER_SPEED_INSIDE = 0.12;
const POINTER_SPEED_LEAVE = 0.045;
const LENS_SPEED = 0.16;
const LOCAL_SPEED = 0.12;
const DEFORM_SPEED = 0.1;
const BRIDGE_MS = 420;
const PREVIEW_DELAY_MS = 180;
const PREVIEW_HIDE_MS = 80;
// fluid-pointer droplet dynamics
const DROPLET_FOLLOW = 0.16;
const DROPLET_RETURN = 0.075;
const DROPLET_DEFAULT_W = 46;
const DROPLET_DEFAULT_H = 32;
const VELOCITY_DAMPING = 0.78;

const DEFAULT_ITEM_QUERY = "[data-liquid-item]";

export class LiquidDockController {
  constructor(root, options = {}) {
    this.root = root;
    this.lens = root.querySelector("[data-liquid-lens]");
    this.surface = this.lens?.querySelector(".liquid-lens-surface");
    this.bridge = root.querySelector(".liquid-lens-bridge");
    this.preview = root.querySelector("[data-liquid-preview]");
    this.previewProvider = options.previewProvider ?? null;
    this.itemQuery = options.itemQuery ?? DEFAULT_ITEM_QUERY;
    // "hover":     the Lens follows the pointer (action dock).
    // "selection": the Lens stays locked on the active item; the pointer
    //              only drives the highlight field and hover glow (top nav).
    this.interactionMode = options.interactionMode ?? "hover";
    this.lensPaddingX = options.lensPaddingX ?? 5;
    this.lensPaddingY = options.lensPaddingY ?? 5;
    // Wider element that receives pointer events (defaults to the dock).
    this.trackingRoot = options.trackingRoot ?? null;

    // fluid-pointer droplet options
    this.dropletFollow = options.pointerFollow ?? DROPLET_FOLLOW;
    this.dropletReturn = options.returnFollow ?? DROPLET_RETURN;
    this.magneticRadius = options.magneticRadius ?? 64;
    this.magneticStrength = options.magneticStrength ?? 0.3;
    this.velocityStretch = options.velocityStretch ?? 0.08;
    this.onSelect = options.onSelect ?? null;

    this.activeItem = null;
    this.hoverItem = null;
    this.focusItem = null;
    // Semantic selection (fluid-pointer): which page is actually open. It
    // only drives accent text / aria-selected — not the big glass.
    this.selectedItem = null;

    this.pointer = {
      inside: false,
      targetX: 50,
      targetY: 24,
      currentX: 50,
      currentY: 24,
      // Lens box (dock-local px), animated on the same RAF clock as the
      // local fields so position, size, highlight and deformation stay in
      // sync — no CSS-transition vs RAF fight.
      targetLensX: 0,
      targetLensY: 0,
      targetLensW: 0,
      targetLensH: 0,
      currentLensX: 0,
      currentLensY: 0,
      currentLensW: 0,
      currentLensH: 0,
      targetLocalX: 0,
      targetLocalY: 0,
      currentLocalX: 0,
      currentLocalY: 0,
      targetScaleX: 1,
      targetScaleY: 1,
      currentScaleX: 1,
      currentScaleY: 1,
      targetHighlightX: 35,
      targetHighlightY: 26,
      currentHighlightX: 35,
      currentHighlightY: 26,
    };

    this.quality = options.quality ?? "full";
    this.frame = 0;
    this._rafId = 0;
    this._previewTimer = null;
    this._hideTimer = null;
    this._previewKind = null;
    this._previewKey = null;
    this._bridgeTimer = null;
    this._lastGeometry = null;
    this._bridgeFromX = 0;
    this._bridgeToX = 0;
    this._bridgeStart = 0;
    this._bridgeY = 24;
    this._bridgeH = 14;
    this._destroyed = false;
    // fluid-pointer: free droplet state (dock-local px, lerped on RAF).
    // targetX/Y/W/H persist between frames so needsAnotherFrame() can
    // check position error — not just velocity.
    this.droplet = {
      pointerX: 0,
      pointerY: 0,
      x: 0,
      y: 0,
      w: DROPLET_DEFAULT_W,
      h: DROPLET_DEFAULT_H,
      targetX: 0,
      targetY: 0,
      targetW: DROPLET_DEFAULT_W,
      targetH: DROPLET_DEFAULT_H,
      velocityX: 0,
      velocityY: 0,
      prevPointerX: 0,
      prevPointerY: 0,
      inside: false,
      captureItem: null,
    };

    this.resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => this.reflow())
        : null;

    this.bind();
    this.refreshItems();
    this.applyCssState();
  }

  bind() {
    // The tracking root can be wider than the visual dock (e.g. the whole
    // top bar) so the droplet keeps following the cursor near the nav;
    // coordinates are still converted into the dock's local space.
    const track = this.trackingRoot || this.root;
    track.addEventListener("pointermove", this.onPointerMove);
    track.addEventListener("pointerleave", this.onPointerLeave);
    track.addEventListener("pointerenter", this.onPointerEnter);
    track.addEventListener("focusin", this.onFocusIn);
    track.addEventListener("focusout", this.onFocusOut);
    track.addEventListener("click", this.onClick);
    if (this.resizeObserver) this.resizeObserver.observe(this.root);
    this._trackingRoot = track;
  }

  refreshItems() {
    this.items = [...this.root.querySelectorAll(this.itemQuery)].filter(
      (item) => !this.isDisabledItem(item),
    );
  }

  isDisabledItem(item) {
    return (
      item.disabled === true || item.getAttribute("aria-disabled") === "true"
    );
  }

  resolveItemFromEvent(event) {
    const target = event.target;
    // Guard for non-DOM environments and non-element targets.
    const item =
      typeof target?.closest === "function"
        ? target.closest(this.itemQuery)
        : null;
    if (!item || this.isDisabledItem(item)) return null;
    return item;
  }

  // ── pointer ────────────────────────────────────────────────────────

  onPointerEnter = () => {
    this.pointer.inside = true;
    if (this.interactionMode === "fluid-pointer") {
      this.droplet.inside = true;
    }
    this.scheduleFrame();
  };

  onPointerMove = (event) => {
    const rect = this.root.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const dockX = event.clientX - rect.left;
    const dockY = event.clientY - rect.top;

    this.pointer.targetX = clamp((dockX / rect.width) * 100, 0, 100);
    this.pointer.targetY = clamp((dockY / rect.height) * 100, 0, 100);

    if (this.interactionMode === "fluid-pointer") {
      // Continuous cursor tracking: velocity + target update on EVERY
      // pointermove (this was the old bug — glow froze inside one item).
      this.droplet.pointerX = dockX;
      this.droplet.pointerY = dockY;
      this.droplet.velocityX = dockX - this.droplet.prevPointerX;
      this.droplet.velocityY = dockY - this.droplet.prevPointerY;
      this.droplet.prevPointerX = dockX;
      this.droplet.prevPointerY = dockY;
      const hovered = this.resolveItemFromEvent(event);
      if (hovered !== this.hoverItem) {
        this.hoverItem = hovered;
        if (hovered) this.schedulePreview(hovered);
      }
      this.scheduleFrame();
      return;
    }

    const item = this.resolveItemFromEvent(event);
    if (item) {
      if (item !== this.hoverItem) {
        this.hoverItem = item;
        // In selection mode the Lens stays on the active item; the pointer
        // only drives the highlight field / hover glow. In hover mode the
        // Lens follows the pointer.
        if (this.interactionMode === "hover") {
          this.restoreResolvedItem();
          this.schedulePreview(item);
        } else {
          this.updateHoverGlow(item, event.clientX, event.clientY);
        }
      }
      // Highlight/offset coordinates are relative to the item the Lens is
      // currently on (active in selection mode, hovered in hover mode).
      const lensItem =
        this.interactionMode === "selection" ? this.resolveCurrentItem() : item;
      if (lensItem) {
        this.updateLocalLensField(lensItem, event.clientX, event.clientY);
      }
    } else {
      this.hoverItem = null;
      this.clearHoverGlow();
    }

    this.scheduleFrame();
  };

  onPointerLeave = () => {
    this.pointer.inside = false;
    this.pointer.targetX = 50;
    this.pointer.targetY = 24;
    this.hoverItem = null;
    this.clearHoverGlow();
    if (this.interactionMode === "fluid-pointer") {
      // Droplet loses the cursor: it flows back to the selected item
      // (low viscosity) — handled in animate().
      this.droplet.inside = false;
      this.droplet.captureItem = null;
      this.scheduleFrame();
      return;
    }
    // In selection mode the active item keeps the Lens; in hover mode the
    // pointer leaving restores focus/active or hides.
    if (this.interactionMode === "hover") {
      this.restoreResolvedItem();
    }
    this.hidePreview();
    this.scheduleFrame();
  };

  // ── focus ──────────────────────────────────────────────────────────

  onFocusIn = (event) => {
    const item = this.resolveItemFromEvent(event);
    if (!item) return;
    this.focusItem = item;
    this.restoreResolvedItem();
    this.schedulePreview(item);
  };

  onFocusOut = (event) => {
    const item = this.resolveItemFromEvent(event);
    if (!item) return;
    if (this.focusItem === item) {
      this.focusItem = null;
      this.restoreResolvedItem();
      this.hidePreview();
    }
  };

  // ── click / active ─────────────────────────────────────────────────

  onClick = (event) => {
    const item = this.resolveItemFromEvent(event);
    if (!item) {
      if (this.interactionMode === "hover") {
        this.activeItem = null;
        this.restoreResolvedItem();
      }
      this.hidePreview();
      return;
    }

    if (this.interactionMode === "fluid-pointer") {
      // Droplet capture: the droplet contracts onto the clicked item and
      // the semantic selection updates in the same transaction.
      this.setSelectedItem(item);
      this.pulse();
      return;
    }

    if (this.activeItem !== item) {
      this.activeItem = item;
      this.restoreResolvedItem();
    }
    this.pulse();
  };

  /**
   * fluid-pointer: update the semantic selection in one transaction —
   * business state (callback), droplet anchor, aria-selected — so the
   * glass and the page never disagree.
   */
  setSelectedItem(item, { snap = false } = {}) {
    if (!item) return;
    this.selectedItem = item;
    const dockRect = this.root.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const cx = itemRect.left - dockRect.left + itemRect.width / 2;
    const cy = itemRect.top - dockRect.top + itemRect.height / 2;
    // Capture target: the droplet homes in on the item centre.
    this.droplet.captureItem = item;
    this.droplet.pointerX = cx;
    this.droplet.pointerY = cy;
    if (snap || this.quality === "static") {
      // Initial placement OR static quality (no RAF animation): place the
      // droplet directly on the item so selection and glass never desync.
      this.droplet.x = cx - this.droplet.w / 2;
      this.droplet.y = cy - this.droplet.h / 2;
      this.droplet.targetX = this.droplet.x;
      this.droplet.targetY = this.droplet.y;
      this.root.dataset.lensVisible = "true";
    }
    // aria-selected on the nav items (visual accent is CSS-driven).
    this.items.forEach((candidate) => {
      candidate.setAttribute(
        "aria-selected",
        candidate === item ? "true" : "false",
      );
    });
    if (this.onSelect) this.onSelect(item);
    this.applyCssState();
    if (this.quality === "static") {
      // static: position is already synced; no RAF needed.
      return;
    }
    this.scheduleFrame();
  }

  // ── state resolution ───────────────────────────────────────────────

  resolveCurrentItem() {
    if (this.interactionMode === "selection") {
      // The Lens is owned by the active page; keyboard focus may borrow it
      // temporarily. Hover only drives the highlight field / glow.
      return this.focusItem || this.activeItem || null;
    }
    if (this.interactionMode === "fluid-pointer") {
      // The free droplet is not anchored to an item; the Lens target is
      // computed per frame from the pointer. This returns the semantic
      // selection for reflow / fallback.
      return this.focusItem || this.selectedItem || null;
    }
    return this.hoverItem || this.focusItem || this.activeItem || null;
  }

  restoreResolvedItem() {
    const item = this.resolveCurrentItem();
    if (item) {
      this.moveLens(item);
      this.updateLensFromItemCenter(item);
      this.schedulePreview(item);
    } else {
      this.hideLens();
    }
    this.scheduleFrame();
  }

  // ── lens geometry ──────────────────────────────────────────────────

  moveLens(item, animate = true) {
    if (!this.lens || this.quality === "off") return;
    const dockRect = this.root.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const geometry = computeLensGeometry(
      dockRect,
      itemRect,
      this.lensPaddingX,
      this.lensPaddingY,
    );

    // Set targets; the shared RAF loop interpolates position/size on the
    // same clock as highlight and deformation.
    this.pointer.targetLensX = geometry.x;
    this.pointer.targetLensY = geometry.y;
    this.pointer.targetLensW = geometry.width;
    this.pointer.targetLensH = geometry.height;
    this.root.dataset.lensVisible = "true";

    if (!animate) {
      // Snap (reflow / quality change): jump directly to the target.
      this.pointer.currentLensX = geometry.x;
      this.pointer.currentLensY = geometry.y;
      this.pointer.currentLensW = geometry.width;
      this.pointer.currentLensH = geometry.height;
      this.hideBridge();
      this.applyCssState();
      return;
    }

    // Stretch a liquid bridge from the previous lens box toward the new
    // one; it shrinks every frame as the lens closes in (see animate()).
    if (this._lastGeometry) {
      this.updateBridge(this._lastGeometry, geometry);
    }
    this._lastGeometry = geometry;
    this.scheduleFrame();
  }

  /**
   * Drive the liquid bridge: a thin stretched layer spanning from the
   * previous lens position toward the new one. It uses the dock-local
   * coordinate space (same as the lens positioner). The RAF loop narrows
   * it every frame as the lens approaches, so it reads as a liquid strand
   * being pulled back into the lens.
   */
  updateBridge(fromGeometry, toGeometry) {
    if (!this.bridge) return;
    const gap = toGeometry.x - fromGeometry.x;
    if (Math.abs(gap) < 2) {
      this.hideBridge();
      return;
    }
    const direction = gap > 0 ? 1 : -1;
    // Strand runs from the trailing edge of the old lens to the leading
    // edge of the new one, then shrinks to nothing on its own clock so
    // the "liquid pull" stays visible even on a fast glide.
    this._bridgeFromX =
      direction > 0 ? fromGeometry.x + fromGeometry.width : fromGeometry.x;
    this._bridgeToX =
      direction > 0 ? toGeometry.x : toGeometry.x + toGeometry.width;
    this._bridgeStart = performance.now();
    this._bridgeY =
      toGeometry.y +
      (toGeometry.height - Math.min(16, Math.round(toGeometry.height * 0.55))) /
        2;
    this._bridgeH = Math.min(16, Math.round(toGeometry.height * 0.55));
    this.root.dataset.bridgeVisible = "true";
  }

  /** Animate the strand toward the target edge while thinning out. */
  updateBridgeFrame() {
    if (!this.bridge || !this.root.dataset.bridgeVisible) return;
    const elapsed = performance.now() - this._bridgeStart;
    const t = Math.min(1, elapsed / BRIDGE_MS);
    const span = Math.abs(this._bridgeToX - this._bridgeFromX);
    const x = lerp(this._bridgeFromX, this._bridgeToX, t);
    const w = Math.max(0, span * (1 - t));
    if (w < 1) {
      this.hideBridge();
      return;
    }
    this.root.style.setProperty("--liquid-bridge-x", `${x}px`);
    this.root.style.setProperty("--liquid-bridge-y", `${this._bridgeY}px`);
    this.root.style.setProperty("--liquid-bridge-w", `${w}px`);
    this.root.style.setProperty("--liquid-bridge-h", `${this._bridgeH}px`);
  }

  hideBridge() {
    if (!this.bridge) return;
    clearTimeout(this._bridgeTimer);
    this.root.dataset.bridgeVisible = "false";
    this._bridgeFromX = 0;
    this._bridgeToX = 0;
  }

  updateLensFromItemCenter(item) {
    const rect = item.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    this.updateLocalLensField(item, cx, cy);
  }

  updateLocalLensField(item, clientX, clientY) {
    const itemRect = item.getBoundingClientRect();
    if (this.quality === "reduced") {
      const local = computeLocalOffsetTargets(clientX, clientY, itemRect);
      this.pointer.targetLocalX = clamp(local.targetLocalX, -3, 3);
      this.pointer.targetLocalY = clamp(local.targetLocalY, -3, 3);
      this.pointer.targetScaleX = 1;
      this.pointer.targetScaleY = 1;
    } else {
      const local = computeLocalOffsetTargets(clientX, clientY, itemRect);
      const deform = computeDeformationTargets(clientX, clientY, itemRect);
      this.pointer.targetLocalX = local.targetLocalX;
      this.pointer.targetLocalY = local.targetLocalY;
      this.pointer.targetScaleX = deform.targetScaleX;
      this.pointer.targetScaleY = deform.targetScaleY;
    }
    const highlight = computeHighlightTargets(clientX, clientY, itemRect);
    this.pointer.targetHighlightX = highlight.targetHighlightX;
    this.pointer.targetHighlightY = highlight.targetHighlightY;
  }

  /**
   * Selection-mode hover glow: a faint light spot on the hovered item.
   * Uses dock-local CSS vars so the sheen can be tinted per item without
   * moving the Lens itself.
   */
  updateHoverGlow(item, clientX, clientY) {
    const rect = item.getBoundingClientRect();
    const dockRect = this.root.getBoundingClientRect();
    const x = clientX - dockRect.left;
    const y = clientY - dockRect.top;
    const cx = (clientX - rect.left) / Math.max(1, rect.width);
    const cy = (clientY - rect.top) / Math.max(1, rect.height);
    this.root.style.setProperty("--liquid-glow-x", `${x}px`);
    this.root.style.setProperty("--liquid-glow-y", `${y}px`);
    this.root.style.setProperty("--liquid-glow-cx", `${clamp(cx, 0, 1)}`);
    this.root.style.setProperty("--liquid-glow-cy", `${clamp(cy, 0, 1)}`);
    this.root.dataset.hoverGlow = "true";
  }

  clearHoverGlow() {
    this.root.dataset.hoverGlow = "false";
  }

  // ── animation loop ─────────────────────────────────────────────────

  scheduleFrame() {
    if (this.quality === "static" || this.quality === "off") return;
    if (this._rafId || this._destroyed) return;
    this._rafId = requestAnimationFrame(this.animate);
  }

  animate = () => {
    this._rafId = 0;
    if (this._destroyed) return;

    if (this.interactionMode === "fluid-pointer") {
      this.animateDroplet();
      this.applyCssState();
      this.updateBridgeFrame();
      const bridgeActive = this.root.dataset.bridgeVisible === "true";
      if (this.needsAnotherFrame() || bridgeActive) {
        this.scheduleFrame();
      }
      return;
    }

    const p = this.pointer;
    const speed = p.inside ? POINTER_SPEED_INSIDE : POINTER_SPEED_LEAVE;

    p.currentX = lerp(p.currentX, p.targetX, speed);
    p.currentY = lerp(p.currentY, p.targetY, speed);
    p.currentLensX = lerp(p.currentLensX, p.targetLensX, LENS_SPEED);
    p.currentLensY = lerp(p.currentLensY, p.targetLensY, LENS_SPEED);
    p.currentLensW = lerp(p.currentLensW, p.targetLensW, LENS_SPEED);
    p.currentLensH = lerp(p.currentLensH, p.targetLensH, LENS_SPEED);
    p.currentLocalX = lerp(p.currentLocalX, p.targetLocalX, LOCAL_SPEED);
    p.currentLocalY = lerp(p.currentLocalY, p.targetLocalY, LOCAL_SPEED);
    p.currentScaleX = lerp(p.currentScaleX, p.targetScaleX, DEFORM_SPEED);
    p.currentScaleY = lerp(p.currentScaleY, p.targetScaleY, DEFORM_SPEED);
    p.currentHighlightX = lerp(
      p.currentHighlightX,
      p.targetHighlightX,
      LOCAL_SPEED,
    );
    p.currentHighlightY = lerp(
      p.currentHighlightY,
      p.targetHighlightY,
      LOCAL_SPEED,
    );

    this.applyCssState();
    this.updateBridgeFrame();

    // Keep driving while the lens moves OR the strand is still playing.
    const bridgeActive = this.root.dataset.bridgeVisible === "true";
    if (this.needsAnotherFrame() || bridgeActive) {
      this.scheduleFrame();
    }
  };

  /**
   * fluid-pointer frame: the droplet follows the cursor continuously
   * (viscosity), is magnetically pulled toward the nearest item centre
   * (partial), stretches with velocity, and flows back to the selected
   * item on leave. This is the "water droplet" model — the Lens is not a
   * snap-on slider.
   */
  animateDroplet() {
    const d = this.droplet;
    const dockRect = this.root.getBoundingClientRect();
    if (dockRect.width === 0) return;

    // static quality: no motion animation, but the position must sync
    // immediately so selection never desyncs from the glass.
    if (this.quality === "static") {
      this.snapDropletToTarget();
      return;
    }

    let pointer = { x: d.pointerX, y: d.pointerY };
    let viscosity = d.inside ? this.dropletFollow : this.dropletReturn;

    if (!d.inside) {
      // Flow back to the selected item centre (low viscosity = slow return).
      const anchor = this.selectedItem;
      if (anchor) {
        const ar = anchor.getBoundingClientRect();
        pointer = {
          x: ar.left - dockRect.left + ar.width / 2,
          y: ar.top - dockRect.top + ar.height / 2,
        };
      }
    }

    // Magnetic attraction toward the nearest item box.
    const boxes = this.items
      .map((item) => {
        const r = item.getBoundingClientRect();
        return {
          x: r.left - dockRect.left,
          y: r.top - dockRect.top,
          w: r.width,
          h: r.height,
        };
      })
      .filter((b) => b.w > 0 && b.h > 0);

    const fallback = {
      x: pointer.x - d.w / 2,
      y: pointer.y - d.h / 2,
      w: DROPLET_DEFAULT_W,
      h: DROPLET_DEFAULT_H,
    };
    const target = computeDropletTarget(
      pointer,
      boxes,
      {
        magneticRadius: this.magneticRadius,
        magneticStrength: this.magneticStrength,
        paddingX: this.lensPaddingX,
        paddingY: this.lensPaddingY,
      },
      fallback,
    );

    // Persist the target so needsAnotherFrame() can check position error.
    d.targetX = target.x;
    d.targetY = target.y;
    d.targetW = target.w;
    d.targetH = target.h;

    // Droplet lerps toward the (magnetised) pointer position.
    d.x = lerp(d.x, d.targetX, viscosity);
    d.y = lerp(d.y, d.targetY, viscosity);
    d.w = lerp(d.w, d.targetW, viscosity);
    d.h = lerp(d.h, d.targetH, viscosity);
    // Snap once settled so needsAnotherFrame() can stop the RAF loop
    // (position error check uses 0.15, so snap below that threshold).
    if (Math.abs(d.x - d.targetX) < 0.15) d.x = d.targetX;
    if (Math.abs(d.y - d.targetY) < 0.15) d.y = d.targetY;
    if (Math.abs(d.w - d.targetW) < 0.15) d.w = d.targetW;
    if (Math.abs(d.h - d.targetH) < 0.15) d.h = d.targetH;

    // Velocity-driven stretch (fast sweeps elongate the droplet).
    const stretch = computeVelocityStretch(
      d.velocityX,
      d.velocityY,
      this.velocityStretch,
    );
    this.pointer.targetScaleX = stretch.targetScaleX;
    this.pointer.targetScaleY = stretch.targetScaleY;
    this.pointer.currentScaleX = lerp(
      this.pointer.currentScaleX,
      stretch.targetScaleX,
      DEFORM_SPEED,
    );
    this.pointer.currentScaleY = lerp(
      this.pointer.currentScaleY,
      stretch.targetScaleY,
      DEFORM_SPEED,
    );
    // Snap scale once it is effectively settled so the RAF loop can stop
    // (a plain lerp asymptotes forever and would keep the loop alive).
    if (Math.abs(this.pointer.currentScaleX - stretch.targetScaleX) < 0.0005) {
      this.pointer.currentScaleX = stretch.targetScaleX;
    }
    if (Math.abs(this.pointer.currentScaleY - stretch.targetScaleY) < 0.0005) {
      this.pointer.currentScaleY = stretch.targetScaleY;
    }

    // Velocity damps like a liquid; zero below the jitter floor.
    d.velocityX *= VELOCITY_DAMPING;
    d.velocityY *= VELOCITY_DAMPING;
    if (Math.abs(d.velocityX) < 0.02) d.velocityX = 0;
    if (Math.abs(d.velocityY) < 0.02) d.velocityY = 0;

    // Highlight tracks the cursor *inside the droplet* (droplet-local
    // coordinates), so the light visibly flows within the glass.
    const localX = clamp((d.pointerX - d.x) / Math.max(1, d.w), 0, 1);
    const localY = clamp((d.pointerY - d.y) / Math.max(1, d.h), 0, 1);
    this.pointer.targetHighlightX = 18 + localX * 64;
    this.pointer.targetHighlightY = 12 + localY * 52;
    this.pointer.currentHighlightX = lerp(
      this.pointer.currentHighlightX,
      this.pointer.targetHighlightX,
      LOCAL_SPEED,
    );
    this.pointer.currentHighlightY = lerp(
      this.pointer.currentHighlightY,
      this.pointer.targetHighlightY,
      LOCAL_SPEED,
    );
    // Snap the highlight once settled so the RAF loop can stop.
    if (
      Math.abs(this.pointer.currentHighlightX - this.pointer.targetHighlightX) <
      0.05
    ) {
      this.pointer.currentHighlightX = this.pointer.targetHighlightX;
    }
    if (
      Math.abs(this.pointer.currentHighlightY - this.pointer.targetHighlightY) <
      0.05
    ) {
      this.pointer.currentHighlightY = this.pointer.targetHighlightY;
    }

    this.root.dataset.lensVisible = "true";
  }

  /**
   * static quality: no animation, but the droplet must land exactly on
   * the current target so selection and glass never desync.
   */
  snapDropletToTarget() {
    const d = this.droplet;
    const dockRect = this.root.getBoundingClientRect();
    if (dockRect.width === 0) return;
    const anchor = this.selectedItem;
    if (anchor) {
      const ar = anchor.getBoundingClientRect();
      const cx = ar.left - dockRect.left + ar.width / 2;
      const cy = ar.top - dockRect.top + ar.height / 2;
      d.x = cx - d.w / 2;
      d.y = cy - d.h / 2;
      d.targetX = d.x;
      d.targetY = d.y;
    } else {
      d.x = d.pointerX - d.w / 2;
      d.y = d.pointerY - d.h / 2;
      d.targetX = d.x;
      d.targetY = d.y;
    }
    this.pointer.currentScaleX = 1;
    this.pointer.currentScaleY = 1;
    this.root.dataset.lensVisible = "true";
    this.applyCssState();
  }

  needsAnotherFrame() {
    if (this.interactionMode === "fluid-pointer") {
      const d = this.droplet;
      // Stop only when the droplet has actually arrived at its target:
      // check position/size error, not just velocity (a slow move leaves
      // the droplet mid-flight otherwise).
      if (d.inside) {
        return (
          Math.abs(d.x - d.targetX) > 0.15 ||
          Math.abs(d.y - d.targetY) > 0.15 ||
          Math.abs(d.w - d.targetW) > 0.15 ||
          Math.abs(d.h - d.targetH) > 0.15 ||
          Math.abs(d.velocityX) > 0.02 ||
          Math.abs(d.velocityY) > 0.02 ||
          Math.abs(this.pointer.currentScaleX - this.pointer.targetScaleX) >
            0.0005 ||
          Math.abs(
            this.pointer.currentHighlightX - this.pointer.targetHighlightX,
          ) > 0.15
        );
      }
      // Leave: continue until the droplet reaches the selected item.
      return (
        Math.abs(d.x - d.targetX) > 0.15 || Math.abs(d.y - d.targetY) > 0.15
      );
    }
    const p = this.pointer;
    const threshold = 0.05;
    return (
      Math.abs(p.currentX - p.targetX) > threshold ||
      Math.abs(p.currentY - p.targetY) > threshold ||
      Math.abs(p.currentLensX - p.targetLensX) > 0.3 ||
      Math.abs(p.currentLensY - p.targetLensY) > 0.3 ||
      Math.abs(p.currentLensW - p.targetLensW) > 0.3 ||
      Math.abs(p.currentLensH - p.targetLensH) > 0.3 ||
      Math.abs(p.currentLocalX - p.targetLocalX) > threshold ||
      Math.abs(p.currentLocalY - p.targetLocalY) > threshold ||
      Math.abs(p.currentScaleX - p.targetScaleX) > 0.001 ||
      Math.abs(p.currentScaleY - p.targetScaleY) > 0.001 ||
      Math.abs(p.currentHighlightX - p.targetHighlightX) > threshold ||
      Math.abs(p.currentHighlightY - p.targetHighlightY) > threshold
    );
  }

  applyCssState() {
    const root = this.root;
    const p = this.pointer;
    const staticQuality = this.quality === "static" || this.quality === "off";

    if (!staticQuality) {
      root.style.setProperty("--liquid-pointer-x", `${p.currentX}%`);
      root.style.setProperty("--liquid-pointer-y", `${p.currentY}%`);
    } else {
      root.style.setProperty("--liquid-pointer-x", "50%");
      root.style.setProperty("--liquid-pointer-y", "24%");
    }

    if (this.interactionMode === "fluid-pointer") {
      // The droplet geometry IS the lens box.
      root.style.setProperty("--liquid-lens-x", `${this.droplet.x}px`);
      root.style.setProperty("--liquid-lens-y", `${this.droplet.y}px`);
      root.style.setProperty("--liquid-lens-w", `${this.droplet.w}px`);
      root.style.setProperty("--liquid-lens-h", `${this.droplet.h}px`);
      root.style.setProperty("--liquid-local-x", "0px");
      root.style.setProperty("--liquid-local-y", "0px");
    } else {
      root.style.setProperty("--liquid-lens-x", `${p.currentLensX}px`);
      root.style.setProperty("--liquid-lens-y", `${p.currentLensY}px`);
      root.style.setProperty("--liquid-lens-w", `${p.currentLensW}px`);
      root.style.setProperty("--liquid-lens-h", `${p.currentLensH}px`);
      if (this.surface) {
        root.style.setProperty("--liquid-local-x", `${p.currentLocalX}px`);
        root.style.setProperty("--liquid-local-y", `${p.currentLocalY}px`);
      }
    }

    if (this.surface) {
      root.style.setProperty(
        "--liquid-scale-x",
        staticQuality ? "1" : p.currentScaleX.toFixed(4),
      );
      root.style.setProperty(
        "--liquid-scale-y",
        staticQuality ? "1" : p.currentScaleY.toFixed(4),
      );
      root.style.setProperty(
        "--liquid-lens-highlight-x",
        `${p.currentHighlightX}%`,
      );
      root.style.setProperty(
        "--liquid-lens-highlight-y",
        `${p.currentHighlightY}%`,
      );
    }
  }

  hideLens() {
    if (!this.lens) return;
    this.root.dataset.lensVisible = "false";
    this.pointer.targetLocalX = 0;
    this.pointer.targetLocalY = 0;
    this.pointer.targetScaleX = 1;
    this.pointer.targetScaleY = 1;
  }

  // ── preview ────────────────────────────────────────────────────────

  schedulePreview(item) {
    if (!this.previewProvider || !this.preview || this.quality === "off") {
      return;
    }
    clearTimeout(this._previewTimer);
    clearTimeout(this._hideTimer);
    this._previewTimer = setTimeout(() => {
      if (this._destroyed) return;
      if (this.resolveCurrentItem() !== item) return;
      this.showPreview(item);
    }, PREVIEW_DELAY_MS);
  }

  showPreview(item) {
    if (!this.preview || !this.previewProvider) return;
    const kind = item.dataset.liquidPreviewKind || "";
    Promise.resolve(this.previewProvider(item)).then((result) => {
      if (this._destroyed) return;
      if (this.resolveCurrentItem() !== item) return;
      if (!result) return;
      const { key, node } = result;
      if (key !== undefined && key === this._previewKey) return;
      this._previewKey = key ?? null;
      this._previewKind = kind;
      const content = this.preview.querySelector(".liquid-preview-content");
      if (!content) return;
      content.replaceChildren(node);
      this.preview.dataset.visible = "true";
      this.preview.setAttribute("aria-hidden", "false");
    });
  }

  hidePreview() {
    if (!this.preview) return;
    clearTimeout(this._previewTimer);
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (this._destroyed) return;
      this.preview.dataset.visible = "false";
      this.preview.setAttribute("aria-hidden", "true");
      this._previewKey = null;
    }, PREVIEW_HIDE_MS);
  }

  // ── pulse ──────────────────────────────────────────────────────────

  pulse() {
    if (!this.surface || this.quality === "static" || this.quality === "off") {
      return;
    }
    this.surface.classList.remove("is-pulsing");
    // Force reflow so the animation restarts on rapid clicks.
    void this.surface.offsetWidth;
    this.surface.classList.add("is-pulsing");
    this.surface.addEventListener(
      "animationend",
      () => {
        this.surface?.classList.remove("is-pulsing");
      },
      { once: true },
    );
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  reflow() {
    if (this._destroyed) return;
    if (this.interactionMode === "fluid-pointer") {
      // The droplet is pointer-driven; a resize only needs a CSS re-apply.
      this.applyCssState();
      return;
    }
    const item = this.resolveCurrentItem();
    if (item) this.moveLens(item, false);
  }

  setQuality(quality) {
    this.quality = quality;
    const item = this.resolveCurrentItem();
    if (item) this.moveLens(item, false);
    else this.hideLens();
    this.applyCssState();
    if (quality === "static" || quality === "off") {
      this.pointer.currentX = 50;
      this.pointer.currentY = 24;
      this.pointer.currentLocalX = 0;
      this.pointer.currentLocalY = 0;
      this.pointer.currentScaleX = 1;
      this.pointer.currentScaleY = 1;
      this.hideBridge();
      this.applyCssState();
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    clearTimeout(this._previewTimer);
    clearTimeout(this._hideTimer);
    clearTimeout(this._bridgeTimer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.root.removeEventListener("pointermove", this.onPointerMove);
    this.root.removeEventListener("pointerleave", this.onPointerLeave);
    this.root.removeEventListener("pointerenter", this.onPointerEnter);
    this.root.removeEventListener("focusin", this.onFocusIn);
    this.root.removeEventListener("focusout", this.onFocusOut);
    this.root.removeEventListener("click", this.onClick);
  }
}

export function resolveDockQuality(mode, capabilities) {
  return resolveLiquidQuality({ requestedMode: mode, ...capabilities });
}
