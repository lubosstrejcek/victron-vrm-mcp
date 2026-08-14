import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVrmClient, VrmApiError } from '../src/vrm/client.js';
import { createRateLimiter } from '../src/rate_limit.js';

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

describe('VrmClient — write methods', () => {
  const originalFetch = globalThis.fetch;
  let seenMethod: string | undefined;
  let seenBody: string | undefined;
  let seenHeaders: Record<string, string> = {};

  beforeEach(() => {
    seenMethod = undefined;
    seenBody = undefined;
    seenHeaders = {};
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      seenMethod = init?.method;
      seenBody = init?.body as string | undefined;
      seenHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([['post'], ['put'], ['patch'], ['delete']] as const)(
    '%s sends the right verb with a JSON-serialized body and content-type',
    async (method) => {
      const c = createVrmClient('x'.repeat(32));
      const result = await c[method]<{ success: boolean }>('/x/1', { a: 1, b: 'two' });
      expect(result.success).toBe(true);
      expect(seenMethod).toBe(method.toUpperCase());
      expect(seenBody).toBe(JSON.stringify({ a: 1, b: 'two' }));
      expect(seenHeaders['content-type']).toBe('application/json');
    },
  );

  it('omits body and content-type when no body is given', async () => {
    const c = createVrmClient('x'.repeat(32));
    await c.post('/x/1');
    expect(seenBody).toBeUndefined();
    expect(seenHeaders['content-type']).toBeUndefined();
  });
});

describe('VrmClient — local rate limiter', () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  beforeEach(() => {
    fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws a local 429 with retryAfterSeconds once the bucket is drained, before any fetch', async () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.001 });
    const c = createVrmClient('x'.repeat(32), 'Token', limiter);

    await c.get('/users/me');
    expect(fetchCount).toBe(1);

    try {
      await c.get('/users/me');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(VrmApiError);
      expect((e as VrmApiError).status).toBe(429);
      expect((e as VrmApiError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify((e as VrmApiError).body)).toMatch(/rate_limited_local/);
    }
    expect(fetchCount).toBe(1);
  });

  it('also rate-limits postDownload', async () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.001 });
    const c = createVrmClient('x'.repeat(32), 'Token', limiter);
    await c.get('/users/me');
    await expect(c.postDownload('/installation-overview-download', {})).rejects.toMatchObject({ status: 429 });
    expect(fetchCount).toBe(1);
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

  it('ignores a malformed Retry-After header', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ errors: 'rate', error_code: 'rate' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': 'soon-ish' },
      });
    }) as unknown as typeof fetch;
    const c = createVrmClient('x'.repeat(32));
    await expect(c.get('/x/1')).rejects.toMatchObject({ status: 429, retryAfterSeconds: undefined });
  });

  it('keeps a non-JSON error body as a string instead of crashing', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      });
    }) as unknown as typeof fetch;
    const c = createVrmClient('x'.repeat(32));
    try {
      await c.get('/x/1');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(VrmApiError);
      expect((e as VrmApiError).status).toBe(502);
      expect((e as VrmApiError).body).toBe('<html>Bad gateway</html>');
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

  it('falls back to application/octet-stream when upstream omits content-type', async () => {
    globalThis.fetch = vi.fn(async () => {
      const res = new Response(Buffer.from('bytes'), { status: 200 });
      res.headers.delete('content-type');
      return res;
    }) as unknown as typeof fetch;
    const c = createVrmClient('x'.repeat(32));
    const dl = await c.postDownload('/installation-overview-download');
    expect(dl.contentType).toBe('application/octet-stream');
    expect(dl.bytes).toBe(5);
  });

  it('rejects download paths that do not start with /', async () => {
    const c = createVrmClient('x'.repeat(32));
    await expect(c.postDownload('installation-overview-download')).rejects.toThrow(/must start with/);
  });

  it('serializes the download request body as JSON', async () => {
    let seenBody: string | undefined;
    let seenHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      seenBody = init?.body as string | undefined;
      seenHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(Buffer.from('x'), { status: 200 });
    }) as unknown as typeof fetch;
    const c = createVrmClient('x'.repeat(32));
    await c.postDownload('/installation-overview-download', { format: 'xls' });
    expect(seenBody).toBe(JSON.stringify({ format: 'xls' }));
    expect(seenHeaders['content-type']).toBe('application/json');
  });

  it('maps download errors to VrmApiError with Retry-After and non-JSON body support', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('quota exceeded', {
        status: 429,
        headers: { 'content-type': 'text/plain', 'retry-after': '11' },
      });
    }) as unknown as typeof fetch;
    const c = createVrmClient('x'.repeat(32));
    try {
      await c.postDownload('/installation-overview-download', {});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(VrmApiError);
      expect((e as VrmApiError).status).toBe(429);
      expect((e as VrmApiError).retryAfterSeconds).toBe(11);
      expect((e as VrmApiError).body).toBe('quota exceeded');
    }
  });
});
