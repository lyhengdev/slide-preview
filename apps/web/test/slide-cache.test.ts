import assert from "node:assert/strict";
import { test } from "node:test";
import { observeTransfer, pickTier } from "../src/lib/slide-cache.js";

test("slide tier selection adapts to measured bandwidth", () => {
  // No measurements yet: safe standard default so the very first slides load
  // at a reasonable compromise until real speeds are observed.
  assert.equal(pickTier(), "standard");

  // 80 KB in 1s ≈ 80 KB/s → very slow link, degrade to the preview tier.
  observeTransfer(80_000, 1000);
  assert.equal(pickTier(), "preview");

  // 8 MB/s on the next sample drags the average up → full tier.
  observeTransfer(2_000_000, 250);
  assert.equal(pickTier(), "full");
});