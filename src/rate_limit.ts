import { createHash } from 'node:crypto';

/**
 * In-memory token-bucket rate limiter, keyed by an opaque caller identifier
 * (typically sha256(VRM-token).slice(0, 16)). Defaults match VRM's documented
 * limits: a rolling window of 200 requests, drained at 3 requests/second on
 * average (one slot freed every 0.33 s).
 *
 * Buckets are evicted after `cleanupAfterMs` of inactivity to keep memory
 * bounded under churn (token rotation, ephemeral callers).
 *
 * Workers / non-Node environments can drop in a different keyForToken() that
 * uses Web Crypto and a different storage backend (KV, Durable Object).
 */

export interface RateLimiterOptions {
  /** Bucket capacity. Default 200. */
  capacity?: number;
  /** Refill rate in tokens per second. Default 3. */
  refillPerSecond?: number;
  /** How long an idle bucket survives before eviction. Default 5 minutes. */
  cleanupAfterMs?: number;
  /** clock injection for tests. Defaults to Date.now. */
  now?: () => number;
}

export interface RateLimiterResult {
  allowed: boolean;
  /** When `allowed=false`, seconds until the next slot frees (rounded up, min 1). */
  retryAfterSeconds?: number;
  /** Diagnostic — current bucket level after the attempt. */
  remaining: number;
}

export interface RateLimiter {
  consume(key: string): RateLimiterResult;
  /** For test harnesses — counts active buckets. */
  size(): number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  lastUsedMs: number;
}

export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const capacity = opts.capacity ?? 200;
  const refillPerSecond = opts.refillPerSecond ?? 3;
  const cleanupAfterMs = opts.cleanupAfterMs ?? 5 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());

  const buckets = new Map<string, Bucket>();

  function refill(b: Bucket, t: number): void {
    const elapsedSec = (t - b.lastRefillMs) / 1000;
    if (elapsedSec <= 0) {
      return;
    }
    b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSecond);
    b.lastRefillMs = t;
  }

  function maybeCleanup(t: number): void {
    if (buckets.size < 1024) {
      return;
    }
    for (const [k, b] of buckets) {
      if (t - b.lastUsedMs > cleanupAfterMs) {
        buckets.delete(k);
      }
    }
  }

  return {
    consume(key: string): RateLimiterResult {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: capacity, lastRefillMs: t, lastUsedMs: t };
        buckets.set(key, b);
      }
      refill(b, t);
      b.lastUsedMs = t;

      if (b.tokens >= 1) {
        b.tokens -= 1;
        maybeCleanup(t);
        return { allowed: true, remaining: Math.floor(b.tokens) };
      }

      const tokensNeeded = 1 - b.tokens;
      const retryAfterSeconds = Math.max(1, Math.ceil(tokensNeeded / refillPerSecond));
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    },
    size(): number {
      return buckets.size;
    },
  };
}

/** Stable opaque key for a token. Truncated to 16 hex chars to keep logs sane. */
export function keyForToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}
