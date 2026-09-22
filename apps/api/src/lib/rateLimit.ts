export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  fail(key: string): void;
  reset(key: string): void;
}

interface Bucket {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const MAX_TRACKED_KEYS = 5_000;

/**
 * Small in-memory limiter for credential endpoints (judge PIN / admin password).
 * Deliberately dependency free: it protects a single API instance, which is the
 * deployment shape this project uses.
 */
export function createRateLimiter(opts: {
  maxAttempts: number;
  lockoutSeconds: number;
  windowSeconds?: number;
}): RateLimiter {
  const windowMs = (opts.windowSeconds ?? 300) * 1000;
  const lockoutMs = opts.lockoutSeconds * 1000;
  const buckets = new Map<string, Bucket>();

  function prune(now: number): void {
    if (buckets.size <= MAX_TRACKED_KEYS) return;
    for (const [key, bucket] of buckets) {
      if (bucket.lockedUntil < now && now - bucket.firstFailureAt > windowMs) buckets.delete(key);
    }
  }

  return {
    check(key) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket) return { allowed: true, retryAfterSeconds: 0 };
      if (bucket.lockedUntil > now) {
        return { allowed: false, retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000) };
      }
      if (now - bucket.firstFailureAt > windowMs) {
        buckets.delete(key);
        return { allowed: true, retryAfterSeconds: 0 };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },

    fail(key) {
      const now = Date.now();
      prune(now);
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.firstFailureAt > windowMs) {
        buckets.set(key, { failures: 1, firstFailureAt: now, lockedUntil: 0 });
        return;
      }
      bucket.failures += 1;
      if (bucket.failures >= opts.maxAttempts) {
        bucket.lockedUntil = now + lockoutMs;
        bucket.failures = 0;
        bucket.firstFailureAt = now;
      }
    },

    reset(key) {
      buckets.delete(key);
    },
  };
}