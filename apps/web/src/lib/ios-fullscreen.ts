let currentPlayer: HTMLVideoElement | null = null;

function cleanupPlayer(): void {
  const src = currentPlayer?.src;
  currentPlayer?.remove();
  if (src && src.startsWith("blob:")) URL.revokeObjectURL(src);
  currentPlayer = null;
}

if (typeof document !== "undefined") {
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  document.addEventListener("webkitendfullscreen", cleanupPlayer);
  document.addEventListener("webkitfullscreenchange", () => {
    if (!d.webkitFullscreenElement) cleanupPlayer();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) cleanupPlayer();
  });
}

/** True only on browsers where <video> can be driven into native fullscreen
 *  (iPhone Safari exposes webkitEnterFullscreen on video elements; arbitrary
 *  elements can never go fullscreen there). */
export function iosVideoFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video") as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
  };
  return typeof v.webkitEnterFullscreen === "function";
}

function supportedVideoMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : null;
}

function drawWatermark(img: HTMLImageElement, text: string, ctx: CanvasRenderingContext2D): void {
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.max(18, Math.round(img.naturalHeight / 42))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  const step = Math.max(140, Math.round(img.naturalHeight / 4));
  for (let y = step; y < img.naturalHeight - step / 2; y += step) {
    ctx.save();
    ctx.translate(img.naturalWidth / 2, y);
    ctx.rotate(-0.6);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Encodes a short silent video of the (watermarked) canvas so the iOS native
 *  fullscreen player has real playing media instead of just a poster. */
async function encodeSlideVideo(canvas: HTMLCanvasElement, durationMs: number): Promise<string | null> {
  if (!supportedVideoMime() || typeof canvas.captureStream !== "function") return null;
  try {
    const stream = canvas.captureStream(15);
    const rec = new MediaRecorder(stream, { mimeType: supportedVideoMime()! });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
    });
    rec.start(250);
    await new Promise((r) => setTimeout(r, durationMs));
    rec.stop();
    const blob = await stopped;
    stream.getTracks().forEach((t) => t.stop());
    if (!blob.size) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Opens the current slide inside the native iOS fullscreen video player by
 * encoding it (with a per-judge watermark) into a short silent video and
 * presenting it via webkitEnterFullscreen — the only fullscreen API that exists
 * on iPhone. iOS treats fullscreen video playback as protected: the browser
 * chrome disappears and screen-capture is degraded/blocked at the OS layer.
 */
export async function presentSlideInIOSPlayer(opts: {
  src: string;
  watermarkText: string;
}): Promise<boolean> {
  if (!iosVideoFullscreenSupported()) return false;
  cleanupPlayer();

  const img = new Image();
  img.src = opts.src;
  await new Promise<void>((resolve, reject) => {
    if (img.complete && img.naturalWidth) {
      resolve();
      return;
    }
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("slide load failed"));
  });
  if (!img.naturalWidth) return false;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  drawWatermark(img, opts.watermarkText, ctx);

  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.muted = true;
  video.loop = true;
  video.preload = "auto";
  document.body.appendChild(video);
  currentPlayer = video;

  const mediaSrc = await encodeSlideVideo(canvas, 3200);
  if (mediaSrc) {
    video.src = mediaSrc;
  } else {
    // MediaRecorder unavailable: fall back to the poster workaround.
    video.poster = canvas.toDataURL("image/jpeg", 0.92);
  }

  try {
    void video.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 1500);
    video.addEventListener(
      "loadeddata",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });

  try {
    const enter = (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      .webkitEnterFullscreen;
    if (enter) {
      enter();
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    await video.requestFullscreen?.();
    return true;
  } catch {
    /* fall through */
  }
  cleanupPlayer();
  return false;
}