import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMMY = 'x'.repeat(32);

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

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn('node', [resolve(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + '/healthz');
      if (r.status === 200) return;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('mcp server did not start');
}, 15_000);

afterAll(() => server?.kill('SIGTERM'));

async function listTools(): Promise<Array<{ name: string; inputSchema?: { properties?: Record<string, { type?: string }> } }>> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${DUMMY}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const text = await r.text();
  const m = text.match(/data: (\{.*\})/);
  return JSON.parse(m![1]).result.tools;
}

async function callTool(name: string, args: unknown): Promise<{ text: string }> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${DUMMY}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await r.text();
  const m = text.match(/data: (\{.*\})/);
  if (!m) return { text };
  const env = JSON.parse(m[1]);
  return { text: env.result?.content?.[0]?.text ?? env.error?.message ?? '' };
}

describe('Pagination — schema declarations', () => {
  it('vrm_find_by_data_attributes declares page + count', async () => {
    const tools = await listTools();
    const t = tools.find((x) => x.name === 'vrm_find_by_data_attributes');
    expect(t).toBeDefined();
    expect(t!.inputSchema!.properties!.page).toBeDefined();
    expect(t!.inputSchema!.properties!.count).toBeDefined();
  });

  it('vrm_list_data_attributes declares page + count', async () => {
    const tools = await listTools();
    const t = tools.find((x) => x.name === 'vrm_list_data_attributes');
    expect(t).toBeDefined();
    expect(t!.inputSchema!.properties!.page).toBeDefined();
    expect(t!.inputSchema!.properties!.count).toBeDefined();
  });

  it('vrm_list_installations declares limit (client-side truncation)', async () => {
    const tools = await listTools();
    const t = tools.find((x) => x.name === 'vrm_list_installations');
    expect(t).toBeDefined();
    expect(t!.inputSchema!.properties!.limit).toBeDefined();
  });
});

describe('Pagination — input validation', () => {
  it('page must be a positive integer', async () => {
    const r1 = await callTool('vrm_find_by_data_attributes', { query: 'bs', page: 0 });
    expect(r1.text).toMatch(/Input validation|Too small|>=1/);

    const r2 = await callTool('vrm_find_by_data_attributes', { query: 'bs', page: -5 });
    expect(r2.text).toMatch(/Input validation|Too small/);

    const r3 = await callTool('vrm_find_by_data_attributes', { query: 'bs', page: 1.5 });
    expect(r3.text).toMatch(/Input validation|integer/i);
  });

  it('count must be 1..1000', async () => {
    const tooBig = await callTool('vrm_find_by_data_attributes', { query: 'bs', count: 2000 });
    expect(tooBig.text).toMatch(/Input validation|Too big|maximum/);

    const tooSmall = await callTool('vrm_find_by_data_attributes', { query: 'bs', count: 0 });
    expect(tooSmall.text).toMatch(/Input validation|Too small|>=1/);
  });

  it('limit on vrm_list_installations must be 1..500', async () => {
    const tooBig = await callTool('vrm_list_installations', { limit: 10_000 });
    expect(tooBig.text).toMatch(/Input validation|Too big|maximum/);

    const tooSmall = await callTool('vrm_list_installations', { limit: 0 });
    expect(tooSmall.text).toMatch(/Input validation|Too small|>=1/);
  });

  it('valid page + count + limit pass validation (reach VRM error path)', async () => {
    // dummy token → VRM 401, but at least the local validation succeeded
    const r1 = await callTool('vrm_find_by_data_attributes', { query: 'bs', page: 1, count: 50 });
    expect(r1.text).not.toMatch(/Input validation/);

    const r2 = await callTool('vrm_list_data_attributes', { page: 2, count: 100 });
    expect(r2.text).not.toMatch(/Input validation/);

    const r3 = await callTool('vrm_list_installations', { limit: 25 });
    expect(r3.text).not.toMatch(/Input validation/);
  });
});
