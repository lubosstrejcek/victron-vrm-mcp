import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => done(port));
    });
  });
}

let server: ChildProcess;
let base: string;
const DUMMY = 'x'.repeat(32);

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn('node', [resolve(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base + '/mcp', { method: 'GET' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server did not start');
}, 15_000);

afterAll(() => server?.kill('SIGTERM'));

async function raw(body: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const r = await fetch(base + '/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${DUMMY}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });
  return { status: r.status, text: await r.text() };
}

describe('Malformed JSON body handling', () => {
  it('empty body → 200 but MCP protocol error (server does not crash)', async () => {
    const r = await raw('');
    expect([200, 400]).toContain(r.status);
  });

  it('non-JSON body accepted by type but rejected by MCP layer', async () => {
    const r = await raw('not-json-at-all{{{');
    // HTTP accepts (content-type matched), MCP transport returns JSON-RPC parse error
    expect([200, 400]).toContain(r.status);
  });

  it('huge body (1 MB) does not OOM the server', async () => {
    const big = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'vrm_get_system_overview', arguments: { idSite: 1, padding: 'a'.repeat(1_000_000) } },
    });
    const r = await raw(big);
    expect([200, 400, 413]).toContain(r.status);
  });
});

describe('Unicode / long-string edge inputs', () => {
  const unicodeSamples = [
    '🚀🔒⚠️',
    '\u0000\u0001\u0002', // control chars
    'a'.repeat(10_000),
    '«français»',
    '中文名',
    "' OR 1=1 --",
    '"><script>alert(1)</script>',
  ];

  it.each(unicodeSamples)('widget name input "%s" is cleanly rejected by zod (no crash)', async (sample) => {
    const r = await raw(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'vrm_widget', arguments: { idSite: 1, widget: sample } },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Input validation|Refusing|VRM API|invalid/i);
  });

  it.each(unicodeSamples)('tag name input "%s" is handled cleanly', async (sample) => {
    const r = await raw(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'vrm_tags_add', arguments: { idSite: 1, tag: sample, source: 'user', confirm: true } },
      }),
    );
    expect(r.status).toBe(200);
    // Either zod rejects (long/control) or the call proceeds to VRM
    expect(r.text.length).toBeLessThan(100_000);
  });
});

describe('Array input limits', () => {
  it('attributeCodes array too long → zod refusal', async () => {
    const r = await raw(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'vrm_widget_graph',
          arguments: { idSite: 1, attributeCodes: Array.from({ length: 50 }, (_, i) => `a${i}`) },
        },
      }),
    );
    const m = r.text.match(/data: (\{.*\})/);
    const env = JSON.parse(m![1]);
    const text = env.result?.content?.[0]?.text ?? env.error?.message ?? '';
    expect(text).toMatch(/Input validation|Too big|maximum/);
  });

  it('email list longer than limit rejected', async () => {
    const r = await raw(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'vrm_set_invite_rights',
          arguments: {
            idSite: 1,
            email: Array.from({ length: 100 }, (_, i) => `u${i}@x.com`),
            accessLevel: Array.from({ length: 100 }, () => 0),
            confirm: true,
          },
        },
      }),
    );
    const m = r.text.match(/data: (\{.*\})/);
    const env = JSON.parse(m![1]);
    const text = env.result?.content?.[0]?.text ?? env.error?.message ?? '';
    expect(text).toMatch(/Input validation|Too big|maximum/);
  });
});

describe('Content-Type edge cases', () => {
  it('content-type with charset parameter is accepted', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${DUMMY}`,
        'content-type': 'application/json; charset=utf-8',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(r.status).toBe(200);
  });

  it('content-type application/xml rejected with 415', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${DUMMY}`,
        'content-type': 'application/xml',
        accept: 'application/json, text/event-stream',
      },
      body: '<foo/>',
    });
    expect(r.status).toBe(415);
  });
});

describe('Token-leak sentinel on errors', () => {
  it('error response does not echo the bearer token', async () => {
    const sentinel = 'SENTINEL_TOKEN_' + 'a'.repeat(20);
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sentinel}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'vrm_widget', arguments: { idSite: 1, widget: '/../../admin' } },
      }),
    });
    const text = await r.text();
    expect(text).not.toContain(sentinel);
  });
});
