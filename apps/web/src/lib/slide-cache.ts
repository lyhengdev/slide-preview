export type SlideTier = "preview" | "standard" | "full";

const CACHE_STORE = "ke-slides-v1";
const MAX_SAMPLES = 12;
const bandwidthSamples: number[] = [];

/** Records the transfer speed of a slide download; keeps the last ~12 samples. */
export function observeTransfer(bytes: number, ms: number): void {
  if (!Number.isFinite(ms) || ms < 50) return;
  bandwidthSamples.push((bytes * 1000) / ms);
  if (bandwidthSamples.length > MAX_SAMPLES) bandwidthSamples.shift();
}

/**
 * Chooses the per-slide image tier that matches the judge's connection:
 * preview for very slow links, full for fast ones, standard otherwise.
 * Standard is the safe default until the first few slides have been measured.
 */
export function pickTier(): SlideTier {
  if (bandwidthSamples.length === 0) return "standard";
  const average = bandwidthSamples.reduce((sum, value) => sum + value, 0) / bandwidthSamples.length;
  if (average < 400_000) return "preview";
  if (average < 1_500_000) return "standard";
  return "full";
}

function cacheStorage(): CacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Downloads one slide at a time and pins its bytes into Cache Storage. */
export async function preloadSlide(url: string, signal?: AbortSignal): Promise<void> {
  try {
    const started = performance.now();
    const response = await fetch(url, {
      credentials: "include",
      // Bypass the HTTP cache: the job here is to actually move the bytes now.
      cache: "reload",
      signal,
    });
    if (!response.ok) return;
    const bytes = (await response.clone().arrayBuffer()).byteLength;
    observeTransfer(bytes, performance.now() - started);
    const store = cacheStorage();
    if (store) {
      const cache = await store.open(CACHE_STORE);
      await cache.put(url, response);
    }
  } catch {
    // Aborted, offline, or storage failure: preloading is best effort.
  }
}

export interface PreloadOptions {
  signal?: AbortSignal;
  concurrency?: number;
  gapMs?: number;
}

/**
 * Conveyor that downloads a list of slide URLs with a small number of in-flight
 * requests so preloading never starves the network (or the live slide image).
 */
export async function preloadSlides(urls: string[], options: PreloadOptions = {}): Promise<void> {
  const { signal, concurrency = 2, gapMs = 250 } = options;
  if (urls.length === 0) return;
  const workerCount = Math.min(concurrency, urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        if (signal?.aborted) return;
        const index = next++;
        const url = urls[index];
        if (url === undefined) return;
        await preloadSlide(url, signal);
        if (gapMs > 0 && !signal?.aborted) await delay(gapMs);
      }
    })
  );
}

export function clearSlideCache(): Promise<void> {
  const store = cacheStorage();
  return store ? store.delete(CACHE_STORE).then(() => undefined) : Promise.resolve();
}