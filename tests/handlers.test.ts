import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { type Env } from '../src/worker.js';
import { reloadAllowedSites } from '../src/tools/helpers.js';
import { TOOLS } from './tool_catalog.js';

/**
 * In-process tool-handler tests. Unlike the subprocess E2E suites, these run
 * the Worker entry directly and stub globalThis.fetch, so every tool handler's
 * happy path executes against canned VRM responses (captured fixtures where
 * available). This is the only suite that verifies what handlers actually
 * send to VRM (method, path, query, body) and how they shape the response
 * into content / structuredContent.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMMY = 'x'.repeat(32);
const env: Env = {};

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures', `${name}.json`), 'utf-8')) as Record<string, unknown>;
}

// ── VRM fetch stub ─────────────────────────────────────────────────────────

interface VrmCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let vrmCalls: VrmCall[] = [];
/** Per-test override. Return a body object, a full Response, or undefined to use the generic default. */
let vrmRoute: (call: VrmCall) => unknown;

const ME = { success: true, user: { id: 22, name: 'Demo', email: 'demo@victronenergy.com', country: 'nl', accessLevel: 1 } };

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vrmCalls = [];
  vrmRoute = () => undefined;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: VrmCall = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers as Record<string, string>) ?? {},
      body,
    };
    vrmCalls.push(call);
    // Generic default deliberately omits `records`: its shape varies per
    // endpoint (array vs object) and handlers treat it as optional — except
    // the installations list, which VRM always returns with records.
    const routed =
      vrmRoute(call) ??
      (url.pathname.endsWith('/users/me')
        ? ME
        : /\/users\/\d+\/installations$/.test(url.pathname)
          ? { success: true, records: [] }
          : { success: true });
    if (routed instanceof Response) {
      return routed;
    }
    return new Response(JSON.stringify(routed), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── MCP plumbing ───────────────────────────────────────────────────────────

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ result: ToolResult; error?: { message: string }; text: string }> {
  const res = await worker.fetch(
    new Request('http://example.com/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${DUMMY}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
    env,
  );
  const raw = await res.text();
  let envelope: { result?: ToolResult; error?: { message: string } };
  try {
    envelope = JSON.parse(raw);
  } catch {
    const m = raw.match(/data: (\{.*\})/);
    expect(m, `unexpected response body: ${raw.slice(0, 200)}`).toBeTruthy();
    envelope = JSON.parse(m![1]);
  }
  const result = envelope.result ?? {};
  const text = result.content?.map((c) => c.text ?? '').join('\n') ?? envelope.error?.message ?? '';
  return { result, error: envelope.error, text };
}

// ── Full-catalog happy-path sweep ──────────────────────────────────────────

describe('Every tool handler executes its happy path against a stubbed VRM', () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))('%s', async (name, spec) => {
    const headers = spec.destructive ? { 'x-vrm-skip-confirms': '1' } : {};
    const { result, error, text } = await callTool(name, spec.minimalArgs, headers);

    expect(error, `JSON-RPC error for ${name}: ${JSON.stringify(error)}`).toBeUndefined();
    expect(result.isError, `${name} returned isError: ${text.slice(0, 300)}`).toBeFalsy();
    expect(result.structuredContent, `${name} returned no structuredContent`).toBeDefined();

    expect(vrmCalls.length, `${name} never reached the VRM API`).toBeGreaterThan(0);
    for (const call of vrmCalls) {
      expect(call.url.host).toBe('vrmapi.victronenergy.com');
      expect(call.url.protocol).toBe('https:');
    }
  });
});

// ── Destructive gate, verified at the VRM boundary ─────────────────────────

describe('Destructive gate blocks or admits the actual VRM call', () => {
  const destructive = TOOLS.filter((t) => t.destructive);

  it.each(destructive.map((t) => [t.name, t] as const))(
    '%s makes no VRM request when refused without confirm',
    async (name, spec) => {
      const { result, text } = await callTool(name, spec.minimalArgs);
      expect(result.isError, `${name} did not refuse`).toBe(true);
      expect(text).toMatch(/Refusing to execute/);
      expect(vrmCalls, `${name} reached VRM despite the gate`).toEqual([]);
    },
  );

  it('vrm_clear_alarm with { confirm: true } posts to the clear-alarm endpoint', async () => {
    const { result } = await callTool('vrm_clear_alarm', { idSite: 1, alarmId: 42, confirm: true });
    expect(result.isError).toBeFalsy();
    expect(vrmCalls).toHaveLength(1);
    expect(vrmCalls[0].method).toBe('POST');
    expect(vrmCalls[0].url.pathname).toBe('/v2/installations/1/clear-alarm');
    expect(vrmCalls[0].body).toEqual({ alarmId: 42 });
  });

  it('vrm_delete_alarm sends a DELETE with the alarm identity in the body', async () => {
    const { result } = await callTool('vrm_delete_alarm', { idSite: 3, idDataAttribute: 9, instance: 0, confirm: true });
    expect(result.isError).toBeFalsy();
    expect(vrmCalls).toHaveLength(1);
    expect(vrmCalls[0].method).toBe('DELETE');
    expect(vrmCalls[0].url.pathname).toBe('/v2/installations/3/alarms');
    expect(vrmCalls[0].body).toEqual({ idDataAttribute: 9, instance: 0 });
  });
});

// ── Request construction ───────────────────────────────────────────────────

describe('Handlers build the VRM request correctly', () => {
  it('site reads carry the Token auth scheme header', async () => {
    await callTool('vrm_get_system_overview', { idSite: 5 });
    expect(vrmCalls).toHaveLength(1);
    expect(vrmCalls[0].headers['x-authorization']).toBe(`Token ${DUMMY}`);
    expect(vrmCalls[0].url.pathname).toBe('/v2/installations/5/system-overview');
  });

  it('x-vrm-auth-scheme: Bearer switches the upstream auth scheme', async () => {
    await callTool('vrm_get_system_overview', { idSite: 5 }, { 'x-vrm-auth-scheme': 'Bearer' });
    expect(vrmCalls[0].headers['x-authorization']).toBe(`Bearer ${DUMMY}`);
  });

  it('vrm_get_stats serializes attributeCodes as repeated attributeCodes[] params', async () => {
    await callTool('vrm_get_stats', {
      idSite: 7,
      datatype: 'custom',
      interval: 'hours',
      start: 1000,
      end: 2000,
      attributeCodes: ['bs', 'bv'],
    });
    expect(vrmCalls).toHaveLength(1);
    const q = vrmCalls[0].url.searchParams;
    expect(q.get('datatype')).toBe('custom');
    expect(q.get('interval')).toBe('hours');
    expect(q.get('start')).toBe('1000');
    expect(q.get('end')).toBe('2000');
    expect(q.getAll('attributeCodes[]')).toEqual(['bs', 'bv']);
  });

  it('vrm_widget_graph maps useMinMax to 1/0 and passes attribute ids', async () => {
    await callTool('vrm_widget_graph', { idSite: 7, attributeIds: [143, 144], useMinMax: true });
    const q = vrmCalls[0].url.searchParams;
    expect(vrmCalls[0].url.pathname).toBe('/v2/installations/7/widgets/Graph');
    expect(q.get('useMinMax')).toBe('1');
    expect(q.getAll('attributeIds[]')).toEqual(['143', '144']);
  });

  it('vrm_widget URL-encodes the widget name into the path', async () => {
    await callTool('vrm_widget', { idSite: 7, widget: 'BatterySummary' });
    expect(vrmCalls[0].url.pathname).toBe('/v2/installations/7/widgets/BatterySummary');
  });

  it('vrm_get_site_id resolves the caller via /users/me when idUser is omitted', async () => {
    vrmRoute = (call) => (call.method === 'POST' ? { success: true, records: { site_id: '151734' } } : undefined);
    const { text } = await callTool('vrm_get_site_id', { installation_identifier: 'aabbccddeeff' });
    expect(vrmCalls.map((c) => c.url.pathname)).toEqual(['/v2/users/me', '/v2/users/22/get-site-id']);
    expect(vrmCalls[1].body).toEqual({ installation_identifier: 'aabbccddeeff' });
    expect(text).toMatch(/151734/);
  });
});

// ── Response shaping against captured fixtures ─────────────────────────────

describe('Handlers shape real VRM payloads (fixtures)', () => {
  it('vrm_list_installations renders every site and returns the full record set', async () => {
    const installations = fixture('installations');
    const me = fixture('users_me');
    vrmRoute = (call) => {
      if (call.url.pathname.endsWith('/users/me')) return me;
      if (/\/users\/\d+\/installations$/.test(call.url.pathname)) return installations;
      return undefined;
    };
    const { result, text } = await callTool('vrm_list_installations', {});
    expect(result.isError).toBeFalsy();

    const records = installations['records'] as Array<{ name: string; idSite: number }>;
    expect(text).toMatch(new RegExp(`Found ${records.length} site\\(s\\)`));
    for (const site of records) {
      expect(text).toContain(site.name);
    }
    expect((result.structuredContent!['records'] as unknown[]).length).toBe(records.length);
    expect((result.structuredContent!['user'] as { id: number }).id).toBe((me['user'] as { id: number }).id);
    expect(vrmCalls[1].url.searchParams.get('extended')).toBe('1');
  });

  it('vrm_list_installations honors the limit arg in markdown but not structuredContent', async () => {
    const installations = fixture('installations');
    vrmRoute = (call) => (/installations$/.test(call.url.pathname) ? installations : undefined);
    const { result, text } = await callTool('vrm_list_installations', { limit: 2 });
    const total = (installations['records'] as unknown[]).length;
    expect(text).toMatch(new RegExp(`Found ${total} site\\(s\\) — showing first 2`));
    expect((result.structuredContent!['records'] as unknown[]).length).toBe(total);
  });

  it('vrm_get_diagnostics counts records from the response', async () => {
    vrmRoute = () => ({ success: true, records: [{ a: 1 }, { a: 2 }, { a: 3 }] });
    const { text } = await callTool('vrm_get_diagnostics', { idSite: 1 });
    expect(text).toMatch(/Diagnostic entries: 3/);
  });

  it('vrm_widget_graph summarizes each series with its point count', async () => {
    const graph = fixture('widget_graph_bs_bv');
    vrmRoute = () => graph;
    const { result, text } = await callTool('vrm_widget_graph', { idSite: 1, attributeIds: [143, 144] });
    expect(result.isError).toBeFalsy();
    const data = (graph['records'] as { data: Record<string, unknown[]> }).data;
    expect(text).toMatch(new RegExp(`Series fetched: ${Object.keys(data).length}`));
    for (const [key, points] of Object.entries(data)) {
      expect(text).toMatch(new RegExp(`${points.length} point\\(s\\)`));
      void key;
    }
  });

  it('vrm_widget passes a BatterySummary payload through structuredContent', async () => {
    const summary = fixture('widget_battery_summary');
    vrmRoute = () => summary;
    const { result } = await callTool('vrm_widget', { idSite: 1, widget: 'BatterySummary' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(summary);
  });

  it('vrm_get_alarms reports counts for alarms, devices, users, and attributes', async () => {
    vrmRoute = () => ({ success: true, alarms: [{}], devices: [{}, {}], users: [], attributes: [{}, {}, {}] });
    const { text } = await callTool('vrm_get_alarms', { idSite: 1 });
    expect(text).toMatch(/Configured alarms\*\*: 1/);
    expect(text).toMatch(/Devices\*\*: 2/);
    expect(text).toMatch(/Notification users\*\*: 0/);
    expect(text).toMatch(/Available data attributes\*\*: 3/);
  });

  it('vrm_get_site_users labels access levels and lists each user', async () => {
    vrmRoute = () => ({
      success: true,
      users: [
        { idUser: 1, name: 'Own Er', email: 'own@e.r', accessLevel: 1 },
        { idUser: 2, name: 'Mon Itor', email: 'mon@it.or', accessLevel: 0 },
        { idUser: 3, name: 'Tech Nician', email: 'tech@nici.an', accessLevel: 2 },
        { idUser: 4, name: 'Mys Tery', email: 'mys@ter.y', accessLevel: 9 },
      ],
      invites: [{}],
    });
    const { result, text } = await callTool('vrm_get_site_users', { idSite: 1 });
    expect(result.isError).toBeFalsy();
    expect(text).toMatch(/Direct users\*\*: 4/);
    expect(text).toMatch(/Pending invites\*\*: 1/);
    expect(text).toMatch(/Own Er.*full control/);
    expect(text).toMatch(/Mon Itor.*monitoring/);
    expect(text).toMatch(/Tech Nician.*technician/);
    expect(text).toMatch(/Mys Tery.*unknown\(9\)/);
  });

  it('vrm_find_by_data_attributes forwards paging params and truncates long match lists', async () => {
    const records = Array.from({ length: 60 }, (_, i) => ({ idSite: i + 1, description: i === 0 ? undefined : `Site ${i + 1}` }));
    vrmRoute = () => ({ success: true, records, attributes: [{ idDataAttribute: 1, code: 'bs' }] });
    const { result, text } = await callTool('vrm_find_by_data_attributes', { query: 'bs>=50', page: 2, count: 60 });
    expect(result.isError).toBeFalsy();
    const q = vrmCalls[0].url.searchParams;
    expect(vrmCalls[0].url.pathname).toBe('/v2/installation-data-attributes');
    expect(q.get('query')).toBe('bs>=50');
    expect(q.get('page')).toBe('2');
    expect(q.get('count')).toBe('60');
    expect(text).toMatch(/Matching installations\*\*: 60/);
    expect(text).toMatch(/\(no name\)/);
    expect(text).toMatch(/… and 10 more/);
  });

  it('vrm_capabilities reports isAdmin=false when the admin probe 403s', async () => {
    vrmRoute = (call) =>
      call.url.pathname.endsWith('/admin/devices')
        ? new Response(JSON.stringify({ success: false, errors: 'forbidden', error_code: 'forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        : undefined;
    const { result, text } = await callTool('vrm_capabilities', {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent!['isAdmin']).toBe(false);
    expect(result.structuredContent!['tokenValid']).toBe(true);
    expect(text).toMatch(/does NOT have admin access/);
  });

  it('vrm_capabilities skips the admin probe when probeAdmin=false', async () => {
    const { result } = await callTool('vrm_capabilities', { probeAdmin: false });
    expect(result.isError).toBeFalsy();
    expect(vrmCalls.map((c) => c.url.pathname)).toEqual(['/v2/users/me']);
    expect(result.structuredContent!['isAdmin']).toBe(false);
  });

  it('vrm_installation_overview_download returns base64 with content type and byte count', async () => {
    const zip = Buffer.from('PK\x03\x04-fake-zip-payload', 'binary');
    vrmRoute = () => new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } });
    const { result } = await callTool('vrm_installation_overview_download', {});
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent!;
    expect(sc['contentType']).toBe('application/zip');
    expect(sc['bytes']).toBe(zip.byteLength);
    expect(Buffer.from(sc['base64'] as string, 'base64')).toEqual(zip);
  });
});

// ── Error propagation through handlers ─────────────────────────────────────

describe('Handlers surface VRM errors as redacted tool errors', () => {
  it('a 403 becomes an isError result with the capabilities hint, not a protocol error', async () => {
    vrmRoute = () =>
      new Response(JSON.stringify({ success: false, errors: 'no rights', error_code: 'forbidden', internal: 'SECRET' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    const { result, text } = await callTool('vrm_get_system_overview', { idSite: 1 });
    expect(result.isError).toBe(true);
    expect(text).toMatch(/VRM API error 403: forbidden: no rights/);
    expect(text).toMatch(/vrm_capabilities/);
    expect(text).not.toMatch(/SECRET/);
  });

  it('a 429 with Retry-After surfaces the backoff in the tool error', async () => {
    vrmRoute = () =>
      new Response(JSON.stringify({ success: false, errors: 'slow down', error_code: 'rate_limit' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' },
      });
    const { result, text } = await callTool('vrm_get_diagnostics', { idSite: 1 });
    expect(result.isError).toBe(true);
    expect(text).toMatch(/VRM API error 429 \(retry after 30s\)/);
  });

  it('a non-JSON upstream error body is truncated, not parsed', async () => {
    vrmRoute = () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    const { result, text } = await callTool('vrm_get_tags', { idSite: 1 });
    expect(result.isError).toBe(true);
    expect(text).toMatch(/VRM API error 502/);
  });
});

// ── VRM_ALLOWED_SITES enforcement through the full stack ───────────────────

describe('VRM_ALLOWED_SITES blocks handlers before any VRM traffic', () => {
  const originalEnv = process.env['VRM_ALLOWED_SITES'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['VRM_ALLOWED_SITES'];
    } else {
      process.env['VRM_ALLOWED_SITES'] = originalEnv;
    }
    reloadAllowedSites();
  });

  it('a read on an unlisted site errors without touching VRM', async () => {
    process.env['VRM_ALLOWED_SITES'] = '151734';
    reloadAllowedSites();
    const { result, text } = await callTool('vrm_get_alarms', { idSite: 999 });
    expect(result.isError).toBe(true);
    expect(text).toMatch(/not on the VRM_ALLOWED_SITES allowlist/);
    expect(vrmCalls).toEqual([]);
  });

  it('a confirmed write on an unlisted site is also refused', async () => {
    process.env['VRM_ALLOWED_SITES'] = '151734';
    reloadAllowedSites();
    const { result } = await callTool('vrm_clear_alarm', { idSite: 999, alarmId: 1, confirm: true });
    expect(result.isError).toBe(true);
    expect(vrmCalls).toEqual([]);
  });

  it('a listed site proceeds normally', async () => {
    process.env['VRM_ALLOWED_SITES'] = '151734';
    reloadAllowedSites();
    const { result } = await callTool('vrm_get_alarms', { idSite: 151734 });
    expect(result.isError).toBeFalsy();
    expect(vrmCalls).toHaveLength(1);
  });
});
