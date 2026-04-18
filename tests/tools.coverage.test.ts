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

// ---------------------------------------------------------------------------
// Canonical tool catalog — must match every MCP tool the server registers.
// Update this list whenever a tool is added or removed.
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

interface ToolSpec {
  name: string;
  destructive: boolean;
  /** Minimal args that pass zod validation but omit `confirm` (so destructive tools hit the runtime refusal). */
  minimalArgs: Args;
}

const TOOLS: ToolSpec[] = [
  // Auth (3)
  { name: 'vrm_auth_login_as_demo', destructive: false, minimalArgs: {} },
  { name: 'vrm_auth_login', destructive: true, minimalArgs: { username: 'a@b.co', password: 'p' } },
  { name: 'vrm_auth_logout', destructive: true, minimalArgs: {} },

  // Users (4)
  { name: 'vrm_list_installations', destructive: false, minimalArgs: {} },
  { name: 'vrm_search_sites', destructive: false, minimalArgs: { query: 'x' } },
  { name: 'vrm_get_site_id', destructive: false, minimalArgs: { installation_identifier: 'abcd' } },
  { name: 'vrm_list_invites', destructive: false, minimalArgs: {} },
  { name: 'vrm_add_site', destructive: true, minimalArgs: { installation_identifier: 'abcd' } },

  // Access tokens (2)
  { name: 'vrm_create_access_token', destructive: true, minimalArgs: { idUser: 1, name: 't' } },
  { name: 'vrm_delete_access_token', destructive: true, minimalArgs: { idUser: 1, idAccessToken: 1 } },

  // Installation reads (8)
  { name: 'vrm_get_system_overview', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_diagnostics', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_stats', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_overallstats', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_alarms', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_site_users', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_tags', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_dynamic_ess_settings', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_gps_download', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_forecasts_last_reset', destructive: false, minimalArgs: { idSite: 1 } },

  // Installation writes (16)
  { name: 'vrm_clear_alarm', destructive: true, minimalArgs: { idSite: 1, alarmId: 1 } },
  { name: 'vrm_add_alarm', destructive: true, minimalArgs: { idSite: 1, alarm: { idDataAttribute: 1 } } },
  { name: 'vrm_edit_alarm', destructive: true, minimalArgs: { idSite: 1, alarm: { idDataAttribute: 1 } } },
  { name: 'vrm_delete_alarm', destructive: true, minimalArgs: { idSite: 1, idDataAttribute: 1, instance: 0 } },
  { name: 'vrm_set_favorite', destructive: true, minimalArgs: { idSite: 1, favorite: 1 } },
  { name: 'vrm_tags_add', destructive: true, minimalArgs: { idSite: 1, tag: 'x', source: 'user' } },
  { name: 'vrm_tags_remove', destructive: true, minimalArgs: { idSite: 1, tag: 'x', source: 'user' } },
  { name: 'vrm_invite_user', destructive: true, minimalArgs: { idSite: 1, name: 'a', email: 'a@b.co', accessLevel: 0 } },
  { name: 'vrm_unlink_user', destructive: true, minimalArgs: { idSite: 1, idUser: 1 } },
  { name: 'vrm_unlink_installation', destructive: true, minimalArgs: { idSite: 1 } },
  { name: 'vrm_set_user_rights', destructive: true, minimalArgs: { idSite: 1, idUser: [1], accessLevel: [0] } },
  { name: 'vrm_set_invite_rights', destructive: true, minimalArgs: { idSite: 1, email: ['a@b.co'], accessLevel: [0] } },
  { name: 'vrm_link_user_groups', destructive: true, minimalArgs: { idSite: 1, userGroups: [{ idUserGroup: 1, accessLevel: 0 }] } },
  { name: 'vrm_set_user_group_access_level', destructive: true, minimalArgs: { idSite: 1, idUserGroup: 1, accessLevel: 0 } },
  { name: 'vrm_reset_forecasts', destructive: true, minimalArgs: { idSite: 1, resetType: 0 } },
  { name: 'vrm_set_site_settings', destructive: true, minimalArgs: { idSite: 1, notes: 'x' } },
  { name: 'vrm_set_dynamic_ess_settings', destructive: true, minimalArgs: { idSite: 1, settings: {} } },

  // Widgets (3)
  { name: 'vrm_widget_graph', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_widget', destructive: false, minimalArgs: { idSite: 1, widget: 'BatterySummary' } },
  { name: 'vrm_widget_generator_state', destructive: false, minimalArgs: { idSite: 1 } },

  // Custom widgets (4)
  { name: 'vrm_get_custom_widgets', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_create_custom_widget', destructive: true, minimalArgs: { idSite: 1, widget: { name: 'x' } } },
  { name: 'vrm_patch_custom_widget', destructive: true, minimalArgs: { idSite: 1, widget: { id: 1 } } },
  { name: 'vrm_delete_custom_widget', destructive: true, minimalArgs: { idSite: 1 } },

  // Admin / collection (7)
  { name: 'vrm_find_by_data_attributes', destructive: false, minimalArgs: { query: 'bs' } },
  { name: 'vrm_list_data_attributes', destructive: false, minimalArgs: {} },
  { name: 'vrm_admin_list_devices', destructive: false, minimalArgs: {} },
  { name: 'vrm_admin_data_attributes_count', destructive: false, minimalArgs: {} },
  { name: 'vrm_admin_search_download', destructive: false, minimalArgs: {} },
  { name: 'vrm_list_firmwares', destructive: false, minimalArgs: { feedChannel: 'release', victronConnectVersion: '6.0.0' } },
  { name: 'vrm_installation_overview_download', destructive: false, minimalArgs: {} },
  { name: 'vrm_add_system', destructive: true, minimalArgs: { body: { name: 'x' } } },
];

describe('Tool catalog', () => {
  it('TOOLS array length equals advertised count (sanity check)', () => {
    expect(TOOLS.length).toBe(52);
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
