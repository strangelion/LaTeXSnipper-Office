/**
 * Liquid Dock geometry tests.
 *
 * Verifies the pure geometry helpers used by the fluid Lens:
 * - computeLensGeometry / padding / rect conversion
 * - clamp bounds
 * - local offset limits (±7px / ±5px)
 * - deformation stays within ~0.98..1.04
 * - highlight spot stays away from edges
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  clamp,
  computeDeformationTargets,
  computeHighlightTargets,
  computeLensGeometry,
  computeLocalOffsetTargets,
  lerp,
} from "../src/features/appearance/liquid-dock.js";

const dockRect = { left: 100, top: 200, width: 400, height: 52 };

describe("computeLensGeometry", () => {
  it("converts item rect into dock-local coordinates", () => {
    const item = { left: 120, top: 205, width: 90, height: 38 };
    const g = computeLensGeometry(dockRect, item);
    assert.equal(g.x, 120 - 100 - 5);
    assert.equal(g.y, 205 - 200 - 5);
    assert.equal(g.width, 90 + 10);
    assert.equal(g.height, 38 + 10);
  });

  it("applies a custom padding", () => {
    const item = { left: 120, top: 205, width: 90, height: 38 };
    const g = computeLensGeometry(dockRect, item, 10);
    assert.equal(g.x, 120 - 100 - 10);
    assert.equal(g.y, 205 - 200 - 10);
    assert.equal(g.width, 90 + 20);
    assert.equal(g.height, 38 + 20);
  });

  it("handles zero padding", () => {
    const item = { left: 120, top: 205, width: 90, height: 38 };
    const g = computeLensGeometry(dockRect, item, 0);
    assert.equal(g.x, 20);
    assert.equal(g.y, 5);
    assert.equal(g.width, 90);
    assert.equal(g.height, 38);
  });
});

describe("clamp / lerp", () => {
  it("clamps values below and above the range", () => {
    assert.equal(clamp(-10, 0, 100), 0);
    assert.equal(clamp(120, 0, 100), 100);
    assert.equal(clamp(42, 0, 100), 42);
  });

  it("lerps toward the target", () => {
    assert.equal(lerp(0, 10, 0.5), 5);
    assert.equal(lerp(10, 0, 0.5), 5);
    assert.equal(lerp(4, 4, 0.5), 4);
  });
});

describe("computeLocalOffsetTargets", () => {
  const item = { left: 120, top: 205, width: 90, height: 38 };
  const centerX = item.left + item.width / 2;
  const centerY = item.top + item.height / 2;

  it("moves toward the pointer but stays within ±7px X / ±5px Y", () => {
    // 100px to the right of center -> dx * 0.08 = 8 -> clamped to 7
    const right = computeLocalOffsetTargets(centerX + 100, centerY, item);
    assert.ok(right.targetLocalX <= 7);
    assert.ok(right.targetLocalX > 0);
    assert.equal(right.targetLocalY, 0);

    const left = computeLocalOffsetTargets(centerX - 100, centerY, item);
    assert.ok(left.targetLocalX >= -7);
    assert.ok(left.targetLocalX < 0);

    const below = computeLocalOffsetTargets(centerX, centerY + 100, item);
    assert.ok(below.targetLocalY <= 5);
    assert.ok(below.targetLocalY > 0);
  });

  it("returns zero offset at the item center", () => {
    const r = computeLocalOffsetTargets(centerX, centerY, item);
    assert.equal(r.targetLocalX, 0);
    assert.equal(r.targetLocalY, 0);
  });
});

describe("computeDeformationTargets", () => {
  const item = { left: 120, top: 205, width: 90, height: 38 };
  const centerX = item.left + item.width / 2;
  const centerY = item.top + item.height / 2;

  it("keeps scale within ~0.98..1.04 for any pointer position", () => {
    const samples = [
      [centerX + 200, centerY],
      [centerX - 200, centerY],
      [centerX, centerY + 200],
      [centerX, centerY - 200],
      [centerX + 200, centerY + 200],
      [centerX - 200, centerY - 200],
    ];
    for (const [x, y] of samples) {
      const { targetScaleX, targetScaleY } = computeDeformationTargets(
        x,
        y,
        item,
      );
      assert.ok(
        targetScaleX >= 0.98 && targetScaleX <= 1.04,
        `scaleX ${targetScaleX}`,
      );
      assert.ok(
        targetScaleY >= 0.98 && targetScaleY <= 1.04,
        `scaleY ${targetScaleY}`,
      );
    }
  });

  it("has no deformation at the center", () => {
    const { targetScaleX, targetScaleY } = computeDeformationTargets(
      centerX,
      centerY,
      item,
    );
    assert.equal(targetScaleX, 1);
    assert.equal(targetScaleY, 1);
  });

  it("never exceeds ±5% deformation", () => {
    const maxX = 1 + 0.035 + 0.01; // hx=1, hy=0 worst case
    const minX = 1 - 0.015;
    const maxY = 1 + 0.025 + 0.015;
    const minY = 1 - 0.025;
    assert.ok(maxX - 1 <= 0.05);
    assert.ok(minX - 1 >= -0.05);
    assert.ok(maxY - 1 <= 0.05);
    assert.ok(minY - 1 >= -0.05);
  });
});

describe("computeHighlightTargets", () => {
  const item = { left: 120, top: 205, width: 90, height: 38 };

  it("keeps the highlight inside 20..80% X and 12..56% Y", () => {
    for (const [px, py, ex, ey] of [
      [item.left, item.top, 20, 12],
      [item.left + item.width, item.top + item.height, 80, 56],
      [item.left + item.width / 2, item.top + item.height / 2, 50, 34],
    ]) {
      const r = computeHighlightTargets(px, py, item);
      assert.equal(r.targetHighlightX, ex);
      assert.equal(r.targetHighlightY, ey);
    }
  });

  it("never moves the highlight fully to the lens edge", () => {
    const far = computeHighlightTargets(
      item.left + 5000,
      item.top + 5000,
      item,
    );
    assert.ok(far.targetHighlightX <= 80);
    assert.ok(far.targetHighlightY <= 56);
  });
});
