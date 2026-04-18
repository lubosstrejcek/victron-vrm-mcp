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

async function callTool(name: string, args: unknown, extraHeaders: Record<string, string> = {}): Promise<{ text: string; status: number }> {
  const r = await fetch(base + '/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${DUMMY}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await r.text();
  const m = raw.match(/data: (\{.*\})/);
  if (!m) return { text: raw, status: r.status };
  const env = JSON.parse(m[1]);
  const text =
    env.result?.content?.[0]?.text ??
    env.error?.message ??
    '';
  return { text, status: r.status };
}

describe('Regression #1: skip-confirms header bypasses the confirm gate', () => {
  it('without header + without confirm → refuses', async () => {
    const { text } = await callTool('vrm_set_favorite', { idSite: 1, favorite: 1 });
    expect(text).toMatch(/Refusing to execute/);
  });

  it('with header + without confirm → reaches VRM (schema validation passed)', async () => {
    const { text } = await callTool('vrm_set_favorite', { idSite: 1, favorite: 1 }, { 'x-vrm-skip-confirms': '1' });
    expect(text).not.toMatch(/Refusing to execute/);
  });

  it('with confirm:true + no header → reaches VRM', async () => {
    const { text } = await callTool('vrm_set_favorite', { idSite: 1, favorite: 1, confirm: true });
    expect(text).not.toMatch(/Refusing to execute/);
  });

  it('with confirm:false is invalid (zod rejects)', async () => {
    const { text } = await callTool('vrm_set_favorite', { idSite: 1, favorite: 1, confirm: false });
    expect(text).toMatch(/invalid_value|Input validation/);
  });
});

describe('Regression #2: vrm_list_firmwares requires both feedChannel and victronConnectVersion', () => {
  it('missing feedChannel → zod refusal', async () => {
    const { text } = await callTool('vrm_list_firmwares', { victronConnectVersion: '1.0.0' });
    expect(text).toMatch(/Input validation|required/i);
  });

  it('missing victronConnectVersion → zod refusal', async () => {
    const { text } = await callTool('vrm_list_firmwares', { feedChannel: 'release' });
    expect(text).toMatch(/Input validation|required/i);
  });

  it('malformed victronConnectVersion → zod refusal', async () => {
    const { text } = await callTool('vrm_list_firmwares', { feedChannel: 'release', victronConnectVersion: 'banana' });
    expect(text).toMatch(/Input validation|invalid_string|pattern/i);
  });

  it('valid params → passes schema (VRM may still refuse)', async () => {
    const { text } = await callTool('vrm_list_firmwares', { feedChannel: 'release', victronConnectVersion: '6.0.0' });
    expect(text).not.toMatch(/Input validation/i);
  });
});

describe('Regression #3: binary download tool returns base64-encoded payload', () => {
  it('tool is registered with download outputSchema', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${DUMMY}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const text = await r.text();
    const env = JSON.parse(text.match(/data: (\{.*\})/)![1]);
    const tools = env.result.tools as Array<{ name: string; outputSchema?: { properties?: Record<string, unknown> } }>;
    const dl = tools.find((t) => t.name === 'vrm_installation_overview_download');
    expect(dl).toBeDefined();
    const props = dl!.outputSchema!.properties!;
    expect(props.contentType).toBeDefined();
    expect(props.bytes).toBeDefined();
    expect(props.base64).toBeDefined();
  });
});

describe('Regression #4: site-id in path is URL-encoded, not string-interpolated', () => {
  it('negative idSite rejected by zod before URL construction', async () => {
    const { text } = await callTool('vrm_get_system_overview', { idSite: -1 });
    expect(text).toMatch(/Input validation|Too small/);
  });

  it('path-traversal-looking idSite (string) rejected', async () => {
    const { text } = await callTool('vrm_get_system_overview', { idSite: '../admin' });
    expect(text).toMatch(/Input validation|expected number/);
  });

  it('float idSite rejected', async () => {
    const { text } = await callTool('vrm_get_system_overview', { idSite: 1.5 });
    expect(text).toMatch(/Input validation|integer/);
  });
});

describe('Regression #5: widget name regex prevents path injection', () => {
  it('rejects slash in widget name', async () => {
    const { text } = await callTool('vrm_widget', { idSite: 1, widget: '../admin/devices' });
    expect(text).toMatch(/Input validation/);
  });

  it('rejects special chars', async () => {
    const { text } = await callTool('vrm_widget', { idSite: 1, widget: 'Battery%20Summary' });
    expect(text).toMatch(/Input validation/);
  });

  it('rejects starting with digit', async () => {
    const { text } = await callTool('vrm_widget', { idSite: 1, widget: '1Battery' });
    expect(text).toMatch(/Input validation/);
  });

  it('accepts valid PascalCase name', async () => {
    const { text } = await callTool('vrm_widget', { idSite: 1, widget: 'BatterySummary' });
    expect(text).not.toMatch(/Input validation/);
  });
});

describe('Regression #6: limit param on vrm_list_installations caps markdown output', () => {
  it('invalid limit (negative) → zod refusal', async () => {
    const { text } = await callTool('vrm_list_installations', { limit: -1 });
    expect(text).toMatch(/Input validation|Too small/);
  });

  it('valid limit → accepted (reaches VRM)', async () => {
    const { text } = await callTool('vrm_list_installations', { limit: 5 });
    expect(text).not.toMatch(/Input validation/);
  });

  it('limit above max (> 500) → zod refusal', async () => {
    const { text } = await callTool('vrm_list_installations', { limit: 10_000 });
    expect(text).toMatch(/Input validation|Too big|maximum/);
  });
});
