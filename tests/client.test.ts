import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVrmClient, VrmApiError } from '../src/vrm/client.js';

describe('createVrmClient', () => {
  it('refuses empty or short tokens at construction', () => {
    expect(() => createVrmClient('')).toThrow(/missing or implausibly short/);
    expect(() => createVrmClient('short')).toThrow();
  });

  it('returns a client with all HTTP methods', () => {
    const c = createVrmClient('x'.repeat(32));
    expect(typeof c.get).toBe('function');
    expect(typeof c.post).toBe('function');
    expect(typeof c.put).toBe('function');
    expect(typeof c.patch).toBe('function');
    expect(typeof c.delete).toBe('function');
    expect(typeof c.postDownload).toBe('function');
  });
});

describe('VrmClient — host pin + path validation', () => {
  const originalFetch = globalThis.fetch;
  let seenUrl: string | null = null;
  let seenHeaders: Record<string, string> = {};

  beforeEach(() => {
    seenUrl = null;
    seenHeaders = {};
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      seenHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ success: true, ok: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects paths that do not start with /', async () => {
    const c = createVrmClient('x'.repeat(32));
    await expect(c.get('users/me')).rejects.toThrow(/must start with/);
  });

  it('forwards the Token scheme by default', async () => {
    const c = createVrmClient('x'.repeat(32));
    await c.get('/users/me');
    expect(seenHeaders['x-authorization']).toMatch(/^Token xx+/);
  });

  it('forwards the Bearer scheme when configured', async () => {
    const c = createVrmClient('x'.repeat(32), 'Bearer');
    await c.get('/users/me');
    expect(seenHeaders['x-authorization']).toMatch(/^Bearer xx+/);
  });

  it('URL-encodes query arrays as repeated params', async () => {
    const c = createVrmClient('x'.repeat(32));
    await c.get('/installations/1/widgets/Graph', { 'attributeCodes[]': ['bs', 'bv'] });
    expect(seenUrl).toMatch(/attributeCodes%5B%5D=bs/);
    expect(seenUrl).toMatch(/attributeCodes%5B%5D=bv/);
  });

  it('skips undefined query values', async () => {
    const c = createVrmClient('x'.repeat(32));
    await c.get('/x/1', { a: 'present', b: undefined });
    expect(seenUrl).toMatch(/a=present/);
    expect(seenUrl).not.toMatch(/\bb=/);
  });

  it('uses VRM base URL', async () => {
    const c = createVrmClient('x'.repeat(32));
    await c.get('/users/me');
    expect(seenUrl).toMatch(/^https:\/\/vrmapi\.victronenergy\.com\/v2\/users\/me/);
  });
});

describe('VrmClient — error mapping', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws VrmApiError with status + body on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ success: false, errors: 'nope', error_code: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const c = createVrmClient('x'.repeat(32));
    await expect(c.get('/users/me')).rejects.toBeInstanceOf(VrmApiError);
  });

  it('captures Retry-After on 429', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ errors: 'rate', error_code: 'rate' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '7' },
      });
    }) as unknown as typeof fetch;
    const c = createVrmClient('x'.repeat(32));
    try {
      await c.get('/x/1');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(VrmApiError);
      expect((e as VrmApiError).retryAfterSeconds).toBe(7);
    }
  });
});

describe('VrmClient — binary download', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns base64 + contentType for binary POST', async () => {
    const zipBytes = Buffer.from('PK\x03\x04payloadbytes', 'binary');
    globalThis.fetch = vi.fn(async () => {
      return new Response(zipBytes, {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });
    }) as unknown as typeof fetch;

    const c = createVrmClient('x'.repeat(32));
    const dl = await c.postDownload('/installation-overview-download', {});
    expect(dl.contentType).toBe('application/zip');
    expect(dl.bytes).toBe(zipBytes.byteLength);
    expect(Buffer.from(dl.base64, 'base64').toString('binary')).toBe(zipBytes.toString('binary'));
  });
});
