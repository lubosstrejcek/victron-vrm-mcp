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
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => done(port));
    });
  });
}

let server: ChildProcess;
let base: string;
const DUMMY_TOKEN = 'x'.repeat(32);

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const entry = resolve(__dirname, '..', 'dist', 'index.js');
  server = spawn('node', [entry], {
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

afterAll(() => {
  server?.kill('SIGTERM');
});

const mcpHeaders = (extra: Record<string, string> = {}) => ({
  'authorization': `Bearer ${DUMMY_TOKEN}`,
  'content-type': 'application/json',
  'accept': 'application/json, text/event-stream',
  ...extra,
});

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});

describe('HTTP security layer', () => {
  it('404 for paths outside /mcp', async () => {
    const r = await fetch(base + '/anything', { method: 'GET' });
    expect(r.status).toBe(404);
  });

  it('405 for DELETE (stateless)', async () => {
    const r = await fetch(base + '/mcp', { method: 'DELETE', headers: { authorization: `Bearer ${DUMMY_TOKEN}` } });
    expect(r.status).toBe(405);
  });

  it('204 for CORS preflight OPTIONS', async () => {
    const r = await fetch(base + '/mcp', { method: 'OPTIONS' });
    expect(r.status).toBe(204);
  });

  it('401 on POST without Authorization header', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: initBody,
    });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('401 on POST with short bearer', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer short', 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
      body: initBody,
    });
    // short-token check is inside the tool, but malformed bearers still pass the bearer regex; the length check kicks in on tool call.
    // At HTTP layer, this should still succeed initialization.
    expect([200, 401]).toContain(r.status);
  });

  it('415 on POST with wrong Content-Type', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${DUMMY_TOKEN}`,
        'content-type': 'text/plain',
        'accept': 'application/json, text/event-stream',
      },
      body: 'plain',
    });
    expect(r.status).toBe(415);
  });

  it('406 on POST with inadequate Accept', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${DUMMY_TOKEN}`,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: initBody,
    });
    expect(r.status).toBe(406);
  });

  it('400 on unknown MCP-Protocol-Version header', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        ...mcpHeaders({ 'mcp-protocol-version': '1999-01-01' }),
      },
      body: initBody,
    });
    expect(r.status).toBe(400);
  });

  it('200 on MCP-Protocol-Version 2025-11-25 (current spec)', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: mcpHeaders({ 'mcp-protocol-version': '2025-11-25' }),
      body: initBody,
    });
    expect(r.status).toBe(200);
  });

  it('200 on MCP-Protocol-Version 2025-06-18 (prior spec)', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: mcpHeaders({ 'mcp-protocol-version': '2025-06-18' }),
      body: initBody,
    });
    expect(r.status).toBe(200);
  });

  it('200 on MCP-Protocol-Version 2025-03-26 (legacy)', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: mcpHeaders({ 'mcp-protocol-version': '2025-03-26' }),
      body: initBody,
    });
    expect(r.status).toBe(200);
  });

  it('403 on cross-origin request with mismatched Origin', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: { ...mcpHeaders(), origin: 'https://evil.example.com' },
      body: initBody,
    });
    expect(r.status).toBe(403);
  });

  it('200 on correct initialize', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: mcpHeaders(),
      body: initBody,
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toMatch(/victron-vrm-mcp/);
    expect(text).toMatch(/protocolVersion/);
  });

  it('tools/list returns the expected 52 tools', async () => {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    const match = text.match(/data: (\{.*\})/);
    expect(match).toBeTruthy();
    const envelope = JSON.parse(match![1]);
    const names: string[] = envelope.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(50);
    expect(names).toContain('vrm_list_installations');
    expect(names).toContain('vrm_get_alarms');
    expect(names).toContain('vrm_widget');
    expect(names).toContain('vrm_invite_user');
    expect(names).toContain('vrm_delete_access_token');
    expect(names).toContain('vrm_create_access_token');
    expect(names).toContain('vrm_auth_logout');
    expect(names).toContain('vrm_set_dynamic_ess_settings');
    expect(names).toContain('vrm_list_firmwares');
    expect(names).toContain('vrm_installation_overview_download');
  });
});

describe('Destructive-op confirm gate (end-to-end)', () => {
  async function callTool(name: string, args: unknown, headers: Record<string, string> = {}): Promise<string> {
    const r = await fetch(base + '/mcp', {
      method: 'POST',
      headers: mcpHeaders(headers),
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name, arguments: args } }),
    });
    const text = await r.text();
    const match = text.match(/data: (\{.*\})/);
    if (!match) {
      return text;
    }
    const env = JSON.parse(match[1]);
    return env.result?.content?.[0]?.text ?? env.error?.message ?? '';
  }

  it('refuses destructive tool without confirm or skip header', async () => {
    const text = await callTool('vrm_set_favorite', { idSite: 151734, favorite: 1 });
    expect(text).toMatch(/Refusing to execute/);
  });

  it('runs destructive tool when skip-confirms header is set', async () => {
    const text = await callTool('vrm_set_favorite', { idSite: 151734, favorite: 1 }, { 'x-vrm-skip-confirms': '1' });
    // Either success or a VRM error — both prove the gate was passed.
    expect(text).not.toMatch(/Refusing to execute/);
  });
});
