import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './tool_catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = typeof srv.address() === 'object' && srv.address() ? (srv.address() as { port: number }).port : 0;
      srv.close(() => done(port));
    });
  });
}

const DUMMY_TOKEN = 'x'.repeat(32);
let server: ChildProcess;
let base: string;

const mcpHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  authorization: `Bearer ${DUMMY_TOKEN}`,
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...extra,
});

async function rpc(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; payload: Record<string, unknown> | null; raw: string }> {
  const r = await fetch(base + '/mcp', {
    method: 'POST',
    headers: mcpHeaders(headers),
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  const match = raw.match(/data: (\{.*\})/);
  return { status: r.status, payload: match ? JSON.parse(match[1]) : null, raw };
}

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


describe('Tool catalog', () => {
  it('TOOLS array length equals advertised count (sanity check)', () => {
    expect(TOOLS.length).toBe(53);
    const names = new Set(TOOLS.map((t) => t.name));
    expect(names.size).toBe(TOOLS.length);
  });

  it('tools/list reports exactly the same names as TOOLS', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.status).toBe(200);
    const tools = (r.payload!.result as { tools: { name: string }[] }).tools;
    const serverNames = new Set(tools.map((t) => t.name));
    const expectedNames = new Set(TOOLS.map((t) => t.name));
    // symmetric diff
    const missingFromServer = [...expectedNames].filter((n) => !serverNames.has(n));
    const extraOnServer = [...serverNames].filter((n) => !expectedNames.has(n));
    expect(missingFromServer).toEqual([]);
    expect(extraOnServer).toEqual([]);
  });
});

describe('Every tool is registered with correct shape', () => {
  it.each(TOOLS.map((t) => [t.name, t.destructive]))(
    '%s (destructive=%s) has inputSchema, annotations, and destructive/readOnly hints',
    async (name, destructive) => {
      const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const tools = (r.payload!.result as { tools: { name: string; inputSchema?: unknown; annotations?: Record<string, unknown> }[] }).tools;
      const tool = tools.find((t) => t.name === name);
      expect(tool, `tool ${name} missing`).toBeDefined();
      expect(tool!.inputSchema).toBeDefined();
      expect(tool!.annotations).toBeDefined();
      if (destructive) {
        expect(tool!.annotations!.destructiveHint).toBe(true);
        expect(tool!.annotations!.readOnlyHint).toBe(false);
      } else {
        expect(tool!.annotations!.readOnlyHint).toBe(true);
        expect(tool!.annotations!.destructiveHint).toBe(false);
      }
    },
  );
});

describe('Destructive tools refuse without confirm or skip header', () => {
  const destructive = TOOLS.filter((t) => t.destructive);

  it.each(destructive.map((t) => [t.name, t.minimalArgs]))(
    '%s refuses without { confirm: true }',
    async (name, args) => {
      const r = await rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      const text =
        (r.payload!.result as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text ??
        (r.payload!.error as { message?: string })?.message ??
        '';
      expect(text, `${name} did not refuse`).toMatch(/Refusing to execute|confirm/i);
    },
  );
});

describe('Destructive tools pass the gate when skip header is set (reaching the VRM call)', () => {
  const destructive = TOOLS.filter((t) => t.destructive);

  it.each(destructive.map((t) => [t.name, t.minimalArgs]))(
    '%s passes the gate with x-vrm-skip-confirms: 1',
    async (name, args) => {
      const r = await rpc(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        { 'x-vrm-skip-confirms': '1' },
      );
      const text =
        (r.payload!.result as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text ??
        (r.payload!.error as { message?: string })?.message ??
        '';
      // Must NOT be a local refusal. Must be either a VRM error, a VRM success, or a schema/zod message we didn't trigger.
      expect(text, `${name} was still refused with skip header`).not.toMatch(/Refusing to execute destructive operation/);
    },
  );
});
