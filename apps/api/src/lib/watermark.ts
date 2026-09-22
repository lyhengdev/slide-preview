import { randomInt } from "node:crypto";
import sharp from "sharp";

export interface WatermarkOptions {
  judgeCode: string;
  eventTitle: string;
  roundLabel: string;
  confidentialLabel: string;
  dynamicLine?: string;
  opacity?: number;
  // When provided, the per-row jitter is derived deterministically from it so
  // the rendered bytes (and therefore the ETag) are stable across requests.
  seed?: string;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

// FNV-1a seeded offset in [-40, 40]; deterministic replacement for randomInt
// whenever the caller supplies a seed.
function seededOffset(seed: string, index: number): number {
  const s = `${seed}:${index}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 81 - 40;
}

export function buildWatermarkSvg(
  width: number,
  height: number,
  opts: WatermarkOptions
): Buffer {
  const label = `${escapeXml(opts.judgeCode)}  •  ${escapeXml(opts.eventTitle)}  •  ${escapeXml(opts.roundLabel)}  •  ${escapeXml(opts.confidentialLabel)}`;
  const dynamic = opts.dynamicLine
    ? `  •  ${escapeXml(opts.dynamicLine)}`
    : "";
  const fontSize = Math.max(18, Math.round(width * 0.018));
  const stepY = Math.max(160, Math.round(height / 4));
  const opacity = opts.opacity ?? 0.14;

  const rows: string[] = [];
  const textHeight = height - stepY;
  for (let y = 0; y < textHeight; y += stepY) {
    const offset = opts.seed ? seededOffset(opts.seed, y) : randomInt(-40, 41);
    rows.push(
      `<g transform="rotate(-18 ${width / 2} ${height / 2})">` +
        `<text x="${offset + 20}" y="${y + fontSize}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${fontSize}" fill="rgba(17,24,39,${opacity})">${label}${dynamic}</text>` +
        `<text x="${width - 220 + offset}" y="${y + fontSize * 2.6}" font-family="system-ui, Segoe UI, Roboto, sans-serif" font-size="${fontSize}" fill="rgba(17,24,39,${opacity})">${label}${dynamic}</text>` +
        `</g>`
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rows.join("")}</svg>`;
  return Buffer.from(svg);
}

export async function applyWatermark(input: Buffer, opts: WatermarkOptions): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 1600;
  const height = meta.height ?? 900;
  const overlay = buildWatermarkSvg(width, height, opts);
  return sharp(input)
    .composite([{ input: overlay, blend: "over" }])
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
}