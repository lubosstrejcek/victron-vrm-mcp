import { describe, it, expect } from 'vitest';
import worker, { type Env } from '../src/worker.js';

/**
 * Worker tests: exercise the Cloudflare-Workers entry point directly using
 * Web Standard Request / Response. No miniflare or wrangler needed — the
 * handler is pure Web Standards on the request/response side. The MCP
 * transport is `WebStandardStreamableHTTPServerTransport` which works on
 * any runtime that supports fetch + Request + Response.
 */

const DUMMY = 'x'.repeat(32);

function fetchOptions(headers: Record<string, string>, body?: string, method = 'POST'): RequestInit {
  return {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}

function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${DUMMY}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  };
}

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'worker-test', version: '0' },
  },
});

const env: Env = {};

describe('Worker fetch handler — health endpoints', () => {
  it('GET /healthz → 200', async () => {
    const res = await worker.fetch(new Request('http://example.com/healthz'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body as { status: string }).status).toBe('ok');
    expect((body as { runtime: string }).runtime).toBe('cloudflare-workers');
  });

  it('GET /readyz → 200', async () => {
    const res = await worker.fetch(new Request('http://example.com/readyz'), env);
    expect(res.status).toBe(200);
  });
});

describe('Worker fetch handler — security guards', () => {
  it('unknown path → 404', async () => {
    const res = await worker.fetch(new Request('http://example.com/anything'), env);
    expect(res.status).toBe(404);
  });

  it('DELETE /mcp → 405 (stateless)', async () => {
    const res = await worker.fetch(new Request('http://example.com/mcp', { method: 'DELETE' }), env);
    expect(res.status).toBe(405);
  });

  it('OPTIONS /mcp → 204', async () => {
    const res = await worker.fetch(new Request('http://example.com/mcp', { method: 'OPTIONS' }), env);
    expect(res.status).toBe(204);
  });

  it('POST without Authorization → 401', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, initBody)),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('POST with wrong Content-Type → 415', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions({ ...mcpHeaders({ 'content-type': 'text/plain' }) }, 'plain')),
      env,
    );
    expect(res.status).toBe(415);
  });

  it('POST with weak Accept → 406', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions({ ...mcpHeaders({ accept: 'application/json' }) }, initBody)),
      env,
    );
    expect(res.status).toBe(406);
  });

  it('POST with unknown MCP-Protocol-Version → 400', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions(mcpHeaders({ 'mcp-protocol-version': '1999-01-01' }), initBody)),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('cross-origin POST without ALLOWED_ORIGINS → 403', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions(mcpHeaders({ origin: 'https://evil.example.com' }), initBody)),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('cross-origin POST with matching ALLOWED_ORIGINS → passes', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions(mcpHeaders({ origin: 'https://claude.ai' }), initBody)),
      { ALLOWED_ORIGINS: 'https://claude.ai' },
    );
    // Should pass guards and actually initialize MCP
    expect([200, 202]).toContain(res.status);
  });
});

describe('Worker fetch handler — MCP initialize round-trip', () => {
  it('valid initialize → 200 with serverInfo in SSE body', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions(mcpHeaders(), initBody)),
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/victron-vrm-mcp/);
    expect(text).toMatch(/protocolVersion/);
  });

  it('tools/list returns the full registered tool set', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const res = await worker.fetch(
      new Request('http://example.com/mcp', fetchOptions(mcpHeaders(), body)),
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // Worker uses JSON response mode (no SSE): body is the JSON-RPC envelope directly.
    let envelope: { result?: { tools?: Array<{ name: string }> } };
    try {
      envelope = JSON.parse(text);
    } catch {
      // Some SDK versions still wrap in SSE; fall back.
      const m = text.match(/data: (\{.*\})/);
      expect(m, `unexpected response body: ${text.slice(0, 200)}`).toBeTruthy();
      envelope = JSON.parse(m![1]);
    }
    const names = (envelope.result!.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(50);
    expect(names).toContain('vrm_list_installations');
    expect(names).toContain('vrm_widget');
    expect(names).toContain('vrm_set_dynamic_ess_settings');
  });
});
