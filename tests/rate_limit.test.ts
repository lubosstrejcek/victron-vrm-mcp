import { describe, it, expect } from 'vitest';
import { createRateLimiter, keyForToken } from '../src/rate_limit.js';

describe('createRateLimiter — token-bucket per key', () => {
  it('starts full at capacity', () => {
    const t = 1_700_000_000_000;
    const rl = createRateLimiter({ capacity: 5, refillPerSecond: 1, now: () => t });
    for (let i = 0; i < 5; i++) {
      const r = rl.consume('k');
      expect(r.allowed, `attempt ${i + 1}`).toBe(true);
    }
    const denied = rl.consume('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('refills over time at the configured rate', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 3, refillPerSecond: 3, now: () => t });
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);
    t = 1000; // +1s, +3 tokens
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);
  });

  it('per-key isolation', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 0.1, now: () => t });
    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(false);
    // different key still has its own bucket
    expect(rl.consume('b').allowed).toBe(true);
    expect(rl.consume('b').allowed).toBe(false);
  });

  it('reports retryAfter at least 1 second when bucket is empty', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 3, now: () => t });
    rl.consume('k');
    const r = rl.consume('k');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('caps refill at capacity (no overflow)', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 5, refillPerSecond: 100, now: () => t });
    rl.consume('k'); // tokens = 4
    t = 10_000; // would refill 1000 tokens, capped at 5
    for (let i = 0; i < 5; i++) {
      expect(rl.consume('k').allowed).toBe(true);
    }
    expect(rl.consume('k').allowed).toBe(false);
  });

  it('matches VRM defaults: 200-window with 3 req/s drain', () => {
    let t = 0;
    const rl = createRateLimiter({ now: () => t }); // defaults: 200, 3
    for (let i = 0; i < 200; i++) {
      expect(rl.consume('k').allowed, `request ${i + 1}`).toBe(true);
    }
    expect(rl.consume('k').allowed).toBe(false);
    // After 1 full second we should regain ~3 tokens.
    t = 1000;
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);
  });

  it('size() reports active bucket count', () => {
    const rl = createRateLimiter();
    expect(rl.size()).toBe(0);
    rl.consume('a');
    rl.consume('b');
    rl.consume('a');
    expect(rl.size()).toBe(2);
  });
});

describe('keyForToken', () => {
  it('produces a stable 16-hex-char key', () => {
    const k1 = keyForToken('some-token');
    const k2 = keyForToken('some-token');
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('different tokens produce different keys', () => {
    expect(keyForToken('a')).not.toBe(keyForToken('b'));
  });

  it('does not echo the token', () => {
    const token = 'super-secret-vrm-token-do-not-leak';
    const key = keyForToken(token);
    expect(key).not.toContain('super');
    expect(key).not.toContain('secret');
    expect(key.length).toBe(16);
  });
});
