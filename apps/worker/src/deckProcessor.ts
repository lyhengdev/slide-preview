import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { loadEnv, workerEnvSchema, type WorkerEnv } from "@ke/config";
import { prisma } from "@ke/database";

const execFileAsync = promisify(execFile);

// Process one image at a time to keep peak memory low on small instances.
sharp.concurrency(1);

interface StorageClient {
  fetchAsBuffer(id: string, kind?: string): Promise<{ data: Buffer; mime: string }>;
  upload(opts: {
    kind: "originals" | "slides" | "temporary";
    filename: string;
    mime: string;
    data: Buffer;
  }): Promise<{ id: string }>;
}

function createStorageClient(baseUrl: string, token: string): StorageClient {
  return {
    async fetchAsBuffer(id, kind = "temporary") {
      const res = await fetch(
        `${baseUrl}/internal/files/${id}?kind=${encodeURIComponent(kind)}`,
        { headers: { "x-storage-token": token } }
      );
      if (!res.ok) throw new Error(`Storage fetch failed: ${res.status}`);
      return {
        data: Buffer.from(await res.arrayBuffer()),
        mime: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },
    async upload({ kind, filename, mime, data }) {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", new Blob([data], { type: mime }), filename);
      const res = await fetch(`${baseUrl}/internal/files`, {
        method: "POST",
        headers: { "x-storage-token": token },
        body: form,
      });
      if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
      return res.json() as Promise<{ id: string }>;
    },
  };
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", [cmd]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function convertPptxToPdf(inputPath: string, outDir: string): Promise<string | null> {
  const soffice = (await which("soffice")) ?? (await which("libreoffice"));
  if (!soffice) {
    throw new Error(
      "LibreOffice not found. Install it (brew install --cask libreoffice) to process PPTX decks."
    );
  }
  await execFileAsync(soffice, [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    inputPath,
  ], { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  const base = path.basename(inputPath).replace(/\.[^.]+$/, ".pdf");
  const pdfPath = path.join(outDir, base);
  try {
    await fsp.access(pdfPath);
    return pdfPath;
  } catch {
    return null;
  }
}

async function renderPdfToPngs(pdfPath: string, outDir: string): Promise<string[]> {
  const pdftoppm = (await which("pdftoppm")) ?? (await which("mutool"));
  const prefix = path.join(outDir, "slide");
  const files = await fsp.readdir(outDir);

  if (pdftoppm?.endsWith("pdftoppm")) {
    await execFileAsync(pdftoppm, ["-png", "-r", "110", pdfPath, prefix], {
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } else if (pdftoppm?.endsWith("mutool")) {
    await execFileAsync(pdftoppm, ["draw", "-o", `${prefix}-%03d.png`, "-r", "110", pdfPath], {
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } else {
    throw new Error(
      "No PDF renderer found. Install poppler (brew install poppler) to process PDF decks."
    );
  }

  const produced = (await fsp.readdir(outDir))
    .filter((f) => /^slide-\d+\.png$/.test(f))
    .sort((a, b) => {
      const na = Number(/slide-(\d+)\.png$/.exec(a)?.[1] ?? 0);
      const nb = Number(/slide-(\d+)\.png$/.exec(b)?.[1] ?? 0);
      return na - nb;
    });
  void files;
  return produced.map((f) => path.join(outDir, f));
}

interface ProcessingResult {
  slides: {
    preview: Buffer;
    standard: Buffer;
    full: Buffer;
    width: number;
    height: number;
  }[];
  pdfPath: string;
}

export async function processDeck(opts: {
  deckId: string;
  startupId: string;
  storageId: string;
  originalName: string;
  mime: string;
  env: WorkerEnv;
}): Promise<ProcessingResult> {
  const { env } = opts;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ke-deck-"));
  const storage = createStorageClient(env.STORAGE_URL, process.env.STORAGE_TOKEN ?? "dev-storage-token-change-me");

  try {
    const { data } = await storage.fetchAsBuffer(opts.storageId, "originals");
    const ext = opts.mime.includes("pdf")
      ? ".pdf"
      : opts.mime.includes("presentation") || opts.mime.includes("powerpoint")
        ? ".pptx"
        : ".bin";
    const inputPath = path.join(tmpDir, `input-${Date.now()}${ext}`);
    await fsp.writeFile(inputPath, data);

    let pdfPath = inputPath;
    if (ext !== ".pdf") {
      const converted = await convertPptxToPdf(inputPath, tmpDir);
      if (!converted) throw new Error("PPTX conversion produced no output");
      pdfPath = converted;
    }

    const pngs = await renderPdfToPngs(pdfPath, tmpDir);
    if (pngs.length === 0) throw new Error("No slides rendered from deck");

    const slides: ProcessingResult["slides"] = [];
    for (let i = 0; i < pngs.length; i++) {
      const meta = await sharp(pngs[i]!).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      // Three WebP tiers per slide: a tiny preview for instant first paint, a
      // standard tier for slow/limited connections, and the full tier for
      // retina screens and fast networks.
      const renderTier = (targetWidth: number, quality: number) =>
        sharp(pngs[i]!)
          .resize({ width: targetWidth, withoutEnlargement: true })
          .webp({ quality, effort: 5 })
          .toBuffer();
      const [preview, standard, full] = await Promise.all([
        renderTier(env.SLIDE_WIDTH_PREVIEW, env.SLIDE_QUALITY_PREVIEW),
        renderTier(env.SLIDE_WIDTH_STANDARD, env.SLIDE_QUALITY_STANDARD),
        renderTier(env.SLIDE_WIDTH, env.SLIDE_QUALITY),
      ]);
      slides.push({ preview, standard, full, width, height });
    }

    return { slides, pdfPath };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function persistSlides(
  opts: {
    deckId: string;
    slides: { preview: Buffer; standard: Buffer; full: Buffer; width: number; height: number }[];
    env: WorkerEnv;
  }
): Promise<void> {
  const storage = createStorageClient(opts.env.STORAGE_URL, process.env.STORAGE_TOKEN ?? "dev-storage-token-change-me");
  const slideRows = [];
  for (let i = 0; i < opts.slides.length; i++) {
    const s = opts.slides[i]!;
    const stamp = Date.now();
    const [fullStored, previewStored, standardStored] = await Promise.all([
      storage.upload({
        kind: "slides",
        filename: `slide-${i + 1}-${stamp}-full.webp`,
        mime: "image/webp",
        data: s.full,
      }),
      storage.upload({
        kind: "slides",
        filename: `slide-${i + 1}-${stamp}-preview.webp`,
        mime: "image/webp",
        data: s.preview,
      }),
      storage.upload({
        kind: "slides",
        filename: `slide-${i + 1}-${stamp}-standard.webp`,
        mime: "image/webp",
        data: s.standard,
      }),
    ]);
    slideRows.push({
      deckId: opts.deckId,
      number: i + 1,
      width: s.width,
      height: s.height,
      filePath: fullStored.id,
      previewPath: previewStored.id,
      standardPath: standardStored.id,
    });
  }

  await prisma.$transaction([
    prisma.slide.deleteMany({ where: { deckId: opts.deckId } }),
    prisma.slide.createMany({ data: slideRows }),
    prisma.deck.update({
      where: { id: opts.deckId },
      data: { status: "READY", slideCount: slideRows.length, error: null },
    }),
  ]);
}

export async function failDeck(deckId: string, error: unknown): Promise<void> {
  await prisma.deck.update({
    where: { id: deckId },
    data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
  });
}