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

async function toolsList(): Promise<Array<{ name: string; description: string; inputSchema?: unknown; outputSchema?: unknown; annotations?: Record<string, unknown> }>> {
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
  const m = text.match(/data: (\{.*\})/);
  return (JSON.parse(m![1]).result as { tools: Array<Record<string, unknown>> }).tools as Array<{ name: string; description: string }>;
}

describe('outputSchema — every tool declares its output shape', () => {
  it('every tool has outputSchema', async () => {
    const tools = await toolsList();
    const missing = tools.filter((t) => !t.outputSchema).map((t) => t.name);
    expect(missing, `tools missing outputSchema: ${missing.join(', ')}`).toEqual([]);
  });

  it('outputSchema is a JSON Schema object (type or properties)', async () => {
    const tools = await toolsList();
    for (const t of tools) {
      const schema = t.outputSchema as { type?: string; properties?: Record<string, unknown> };
      expect(
        schema.type === 'object' || schema.properties !== undefined,
        `tool ${t.name} outputSchema is malformed`,
      ).toBe(true);
    }
  });

  it('outputSchema declares at least one property for every tool', async () => {
    const tools = await toolsList();
    for (const t of tools) {
      const schema = t.outputSchema as { properties?: Record<string, unknown> };
      expect(
        schema.properties && Object.keys(schema.properties).length > 0,
        `tool ${t.name} outputSchema has no properties`,
      ).toBe(true);
    }
  });
});

describe('Tool description hygiene', () => {
  it('every description is between 20 and 2000 chars', async () => {
    const tools = await toolsList();
    for (const t of tools) {
      const len = t.description?.length ?? 0;
      expect(len, `${t.name} description len=${len}`).toBeGreaterThan(20);
      expect(len, `${t.name} description len=${len}`).toBeLessThan(2000);
    }
  });

  it('every tool description mentions its VRM endpoint (starts with /)', async () => {
    const tools = await toolsList();
    // auth tools reference specific paths; some tools (vrm_list_installations, vrm_widget) mention implied paths
    const exceptions = new Set<string>(['vrm_widget']); // generic dispatcher
    for (const t of tools) {
      if (exceptions.has(t.name)) continue;
      expect(
        /\/[A-Za-z{}_-]+/.test(t.description),
        `${t.name} description does not reference a VRM path`,
      ).toBe(true);
    }
  });

  it('no tool description contains prompt-injection markers', async () => {
    const tools = await toolsList();
    const badMarkers = [
      '<system>',
      '</system>',
      'ignore previous instructions',
      'ignore the above',
      '<!--',
      'SYSTEM:',
      'You are now',
    ];
    for (const t of tools) {
      for (const marker of badMarkers) {
        expect(
          t.description.toLowerCase().includes(marker.toLowerCase()),
          `${t.name} description contains injection marker: ${marker}`,
        ).toBe(false);
      }
    }
  });

  it('every destructive tool description contains the word DESTRUCTIVE, DEPRECATED, or ADMIN-ONLY', async () => {
    const tools = await toolsList();
    const destructive = tools.filter((t) => t.annotations?.destructiveHint === true);
    for (const t of destructive) {
      const d = t.description.toUpperCase();
      expect(
        d.includes('DESTRUCTIVE') || d.includes('DEPRECATED') || d.includes('ADMIN-ONLY'),
        `${t.name} is destructive but description lacks a strong hazard word`,
      ).toBe(true);
    }
  });
});
