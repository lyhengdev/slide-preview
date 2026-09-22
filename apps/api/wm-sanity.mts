import sharp from "sharp";
import { applyWatermark } from "./src/lib/watermark.js";

const src = await sharp({
  create: { width: 1600, height: 900, channels: 3, background: { r: 40, g: 60, b: 90 } },
})
  .jpeg()
  .toBuffer();

const opts = {
  judgeCode: "J001",
  eventTitle: "KE STARTUP AWARD",
  roundLabel: "FINAL",
  confidentialLabel: "CONFIDENTIAL",
  seed: "abc123:full:5:CONFIDENTIAL",
};

const a = await applyWatermark(src, opts);
const b = await applyWatermark(src, opts);
const c = await applyWatermark(src, { ...opts, seed: "different-seed" });

console.log(`watermarked bytes: ${a.length} vs ${b.length} vs ${c.length}`);
console.log(`same-seed deterministic: ${a.equals(b) ? "YES" : "NO"}`);
console.log(`different-seed differs: ${!a.equals(c) ? "YES" : "NO"}`);

const ok = a.equals(b) && !a.equals(c);
process.exit(ok ? 0 : 1);