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
  computeDropletTarget,
  computeHighlightTargets,
  computeLensGeometry,
  computeLocalOffsetTargets,
  computeVelocityStretch,
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

  it("applies a custom X padding (Y stays default)", () => {
    const item = { left: 120, top: 205, width: 90, height: 38 };
    const g = computeLensGeometry(dockRect, item, 10);
    assert.equal(g.x, 120 - 100 - 10);
    assert.equal(g.y, 205 - 200 - 5);
    assert.equal(g.width, 90 + 20);
    assert.equal(g.height, 38 + 10);
  });

  it("supports independent X and Y padding", () => {
    const item = { left: 120, top: 205, width: 90, height: 38 };
    const g = computeLensGeometry(dockRect, item, 3, 1);
    assert.equal(g.x, 120 - 100 - 3);
    assert.equal(g.y, 205 - 200 - 1);
    assert.equal(g.width, 90 + 6);
    assert.equal(g.height, 38 + 2);
  });

  it("handles zero padding", () => {
    const item = { left: 120, top: 205, width: 90, height: 38 };
    const g = computeLensGeometry(dockRect, item, 0);
    assert.equal(g.x, 20);
    assert.equal(g.y, 0);
    assert.equal(g.width, 90);
    assert.equal(g.height, 48);
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

describe("computeDropletTarget", () => {
  const boxes = [
    { x: 20, y: 10, w: 80, h: 30 },
    { x: 120, y: 10, w: 80, h: 30 },
    { x: 220, y: 10, w: 80, h: 30 },
  ];

  it("returns a free droplet with fallback size far from items", () => {
    const r = computeDropletTarget(
      { x: 500, y: 200 },
      boxes,
      {},
      { w: 34, h: 24 },
    );
    assert.equal(r.attraction, 0);
    assert.equal(r.nearest, null);
    assert.equal(r.w, 34);
    assert.equal(r.h, 24);
    assert.equal(r.x, 500 - 17);
    assert.equal(r.y, 200 - 12);
  });

  it("magnetises toward the nearest item centre (partial, not a snap)", () => {
    // Pointer at the left item centre: attraction should pull it slightly.
    const r = computeDropletTarget({ x: 60, y: 25 }, boxes, {
      magneticRadius: 64,
      magneticStrength: 0.3,
    });
    assert.ok(r.attraction > 0, "attraction active");
    assert.ok(r.attraction <= 1, "attraction bounded");
    assert.equal(r.nearest.box, boxes[0]);
    // Pulled between pointer and centre, never past it.
    assert.ok(r.x + r.w / 2 >= 60, "droplet centre not left of pointer");
    assert.ok(r.x + r.w / 2 <= 60 + 0.3 * 0, "pull direction");
  });

  it("grows toward the item size with attraction", () => {
    const r = computeDropletTarget({ x: 60, y: 25 }, boxes, {
      magneticRadius: 64,
      magneticStrength: 0.3,
      paddingX: 4,
      paddingY: 2,
    });
    assert.ok(r.w >= 34, "droplet widened by magnet");
    assert.ok(r.w <= 80 + 8, "not larger than padded item");
  });

  it("ignores items beyond the magnetic radius", () => {
    const r = computeDropletTarget({ x: 60, y: 400 }, boxes, {
      magneticRadius: 64,
    });
    assert.equal(r.attraction, 0);
    assert.equal(r.nearest, null);
  });
});

describe("computeVelocityStretch", () => {
  it("returns identity at rest", () => {
    const r = computeVelocityStretch(0, 0);
    assert.equal(r.targetScaleX, 1);
    assert.equal(r.targetScaleY, 1);
  });

  it("stretches in the direction of fast motion, capped ~9%", () => {
    const horizontal = computeVelocityStretch(12, 0);
    assert.ok(horizontal.targetScaleX > 1.02, "elongates along X");
    assert.equal(horizontal.targetScaleY, 1, "no Y stretch for pure X motion");
    assert.ok(horizontal.targetScaleX - 1 <= 0.09, "cap respected");

    const vertical = computeVelocityStretch(0, 12);
    assert.equal(vertical.targetScaleX, 1);
    assert.ok(vertical.targetScaleY > 1.02);
  });

  it("caps extreme velocity", () => {
    const r = computeVelocityStretch(999, 999, 0.09);
    assert.ok(r.targetScaleX - 1 <= 0.09);
    assert.ok(r.targetScaleY - 1 <= 0.09);
  });
});
