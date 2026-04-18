import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LIVE tests against Victron's free public demo tenant. These hit
 * https://vrmapi.victronenergy.com/v2 with a freshly-issued demo Bearer
 * token (via /auth/loginAsDemo).
 *
 * Tests for tools the demo can't reach (admin, etc.) live in
 * tests/regressions.test.ts and tests/tools.coverage.test.ts which use
 * dummy tokens to exercise the pre-VRM gates.
 *
 * If you're offline or VRM is down: skip with `npx vitest --exclude
 * tests/live.test.ts`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_SITE = 151734; // 35ft Yacht — stable demo site

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => done(port));
    });
  });
}

let mcpServer: ChildProcess;
let mcpBase: string;
let demoToken: string;

beforeAll(async () => {
  // Fresh demo token (free, anonymous, ~24h validity).
  const r = await fetch('https://vrmapi.victronenergy.com/v2/auth/loginAsDemo');
  if (!r.ok) {
    throw new Error(`demo login failed: ${r.status} ${await r.text()}`);
  }
  const body = (await r.json()) as { token: string };
  demoToken = body.token;
  expect(demoToken).toBeTruthy();
  expect(demoToken.length).toBeGreaterThan(100);

  const port = await freePort();
  mcpBase = `http://127.0.0.1:${port}`;
  mcpServer = spawn('node', [resolve(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${mcpBase}/healthz`);
      if (r.status === 200) return;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('mcp server did not start');
}, 20_000);

afterAll(() => {
  mcpServer?.kill('SIGTERM');
});

async function callTool(name: string, args: unknown = {}): Promise<{ text: string; structured: unknown; isError?: boolean }> {
  const r = await fetch(`${mcpBase}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${demoToken}`,
      'x-vrm-auth-scheme': 'Bearer',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await r.text();
  const m = raw.match(/data: (\{.*\})/);
  if (!m) {
    return { text: raw, structured: undefined };
  }
  const env = JSON.parse(m[1]);
  return {
    text: env.result?.content?.[0]?.text ?? '',
    structured: env.result?.structuredContent,
    isError: env.result?.isError === true,
  };
}

describe('Live VRM demo — discovery + monitoring', () => {
  it('vrm_list_installations returns the 7 demo sites with 35ft Yacht present', async () => {
    const { text, structured } = await callTool('vrm_list_installations');
    expect(text).toMatch(/35ft Yacht/);
    expect(text).toMatch(/idSite.*151734/);
    expect(text).toMatch(/Found 7 site/);
    const sc = structured as { success: boolean; user: { id: number; email: string }; records: unknown[] };
    expect(sc.success).toBe(true);
    expect(sc.user.id).toBe(22);
    expect(sc.user.email).toBe('demo@victronenergy.com');
    expect(sc.records.length).toBe(7);
  });

  it('vrm_get_system_overview on 35ft Yacht returns success', async () => {
    const { text, structured } = await callTool('vrm_get_system_overview', { idSite: DEMO_SITE });
    expect(text).toMatch(/System overview/);
    expect((structured as { success: boolean }).success).toBe(true);
  });

  it('vrm_widget BatterySummary via generic dispatcher returns success', async () => {
    const { text, structured } = await callTool('vrm_widget', { idSite: DEMO_SITE, widget: 'BatterySummary' });
    expect(text).toMatch(/Widget BatterySummary/);
    expect((structured as { success: boolean }).success).toBe(true);
  });

  it('vrm_widget_graph fetches at least one series for SOC + voltage', async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 3600;
    const { text } = await callTool('vrm_widget_graph', {
      idSite: DEMO_SITE,
      attributeCodes: ['bs', 'bv'],
      start,
      end: now,
    });
    expect(text).toMatch(/Series fetched: \d+/);
  });

  it('vrm_widget_generator_state returns success', async () => {
    const { text, structured } = await callTool('vrm_widget_generator_state', { idSite: DEMO_SITE });
    expect(text).toMatch(/GeneratorState/);
    expect((structured as { success: boolean }).success).toBe(true);
  });

  it('vrm_get_dynamic_ess_settings returns the settings envelope', async () => {
    const { text, structured } = await callTool('vrm_get_dynamic_ess_settings', { idSite: DEMO_SITE });
    expect(text).toMatch(/Dynamic ESS settings/);
    expect(typeof (structured as { success?: boolean }).success).toBe('boolean');
  });
});

describe('Live VRM demo — generic widget dispatcher exercises many endpoints', () => {
  // The full set of widget endpoints documented in the VRM spec. Some return
  // 404 on the demo's bare 35ft Yacht site (no fuel cell, no DC meter, etc).
  // We accept any well-formed response (success or VRM error) — the test is
  // really "round-trip works without crashing the server".
  const widgets = [
    'BatterySummary',
    'SolarChargerSummary',
    'TankSummary',
    'VeBusState',
    'VeBusWarningsAndAlarms',
    'MPPTState',
    'InputState',
    'InverterState',
    'InverterChargerState',
    'InverterChargerWarningsAndAlarms',
    'ChargerState',
    'ChargerRelayState',
    'SolarChargerRelayState',
    'PVInverterStatus',
    'GPS',
    'EvChargerSummary',
    'MeteorologicalSensorOverview',
    'GlobalLinkSummary',
    'Status',
    'TempSummaryAndGraph',
    'TempAirQuality',
    'EssBatteryLifeState',
    'BatteryRelayState',
    'BatteryExternalRelayState',
    'BatteryMonitorWarningsAndAlarms',
    'GatewayRelayState',
    'GatewayRelayTwoState',
    'GeneratorState',
    'FuelCellState',
    'BMSDiagnostics',
    'HistoricData',
    'IOExtenderInOut',
    'LithiumBMS',
    'DCMeter',
    'MotorSummary',
  ];

  for (const widget of widgets) {
    it(`vrm_widget ${widget} round-trips`, async () => {
      const { text } = await callTool('vrm_widget', { idSite: DEMO_SITE, widget });
      // success | empty | 404 / 403 from VRM all acceptable — server must not crash
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/eyJ[A-Za-z0-9._-]{30,}/); // never leak demo token
    });
  }
});

describe('Live VRM demo — additional reads that work', () => {
  it('vrm_get_overallstats returns an envelope (slow on demo)', async () => {
    const { text } = await callTool('vrm_get_overallstats', { idSite: DEMO_SITE });
    expect(text).toMatch(/Overall stats|VRM API/);
  }, 30_000);

  it('vrm_get_stats returns time-series data', async () => {
    const { text, structured } = await callTool('vrm_get_stats', { idSite: DEMO_SITE });
    expect(text).toMatch(/Stats/);
    expect(typeof (structured as { success?: boolean }).success).toBe('boolean');
  });

  it('vrm_get_gps_download with start/end round-trips without crashing', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { text } = await callTool('vrm_get_gps_download', { idSite: DEMO_SITE, start: now - 86400, end: now });
    // GPS download can return success, a VRM JSON error, or even non-JSON
    // (XML/HTML) on some sites — what we're really testing is "the server
    // didn't crash and returned text". Token-leak check is the key safety
    // assertion.
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9._-]{30,}/);
  });

  it('vrm_capabilities reports demo identity + isAdmin=false', async () => {
    const { text, structured } = await callTool('vrm_capabilities', {});
    expect(text).toMatch(/VRM capabilities/);
    expect(text).toMatch(/demo@victronenergy\.com/);
    const sc = structured as { tokenValid: boolean; isAdmin: boolean; user: { id: number } };
    expect(sc.tokenValid).toBe(true);
    expect(sc.isAdmin).toBe(false);
    expect(sc.user.id).toBe(22);
  });

  it('vrm_capabilities with probeAdmin:false skips the admin round-trip', async () => {
    const { text, structured } = await callTool('vrm_capabilities', { probeAdmin: false });
    expect(text).toMatch(/Admin probe skipped/);
    expect((structured as { tokenValid: boolean }).tokenValid).toBe(true);
  });

  it('vrm_widget_graph with multiple attribute codes round-trips', async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 7200; // 2h
    const { text } = await callTool('vrm_widget_graph', {
      idSite: DEMO_SITE,
      attributeCodes: ['bs', 'bv', 'bc'],
      start,
      end: now,
    });
    expect(text).toMatch(/Series fetched: \d+/);
  });
});

describe('Live VRM demo — gracefully surfaces VRM errors', () => {
  // Demo lacks rights for these — we verify the server returns a clean,
  // redacted error message rather than crashing or leaking the token.
  const denied = [
    ['vrm_get_alarms', { idSite: DEMO_SITE }],
    ['vrm_get_site_users', { idSite: DEMO_SITE }],
    ['vrm_get_tags', { idSite: DEMO_SITE }],
    ['vrm_find_by_data_attributes', { query: 'bs' }],
  ] as const;

  for (const [name, args] of denied) {
    it(`${name} returns a clean 403 (demo lacks rights)`, async () => {
      const { text, isError } = await callTool(name as string, args);
      expect(isError).toBe(true);
      expect(text).toMatch(/VRM API error 403/);
      expect(text).toMatch(/forbidden|insufficient/i);
      expect(text).not.toMatch(/eyJ[A-Za-z0-9._-]{30,}/);
    });
  }

  it('vrm_admin_list_devices returns a clean 403 (demo not admin)', async () => {
    const { text, isError } = await callTool('vrm_admin_list_devices', {});
    expect(isError).toBe(true);
    expect(text).toMatch(/VRM API error 403/);
    expect(text).toMatch(/vrm_capabilities/); // hint suggesting capabilities probe
  });

  it('vrm_list_firmwares with valid params + demo token returns a real response', async () => {
    const { text } = await callTool('vrm_list_firmwares', {
      feedChannel: 'release',
      victronConnectVersion: '6.0.0',
    });
    // Either success or VRM error — both prove the round-trip works
    expect(text).toMatch(/firmwares|VRM API/);
  });
});

describe('Live VRM demo — every remaining read tool round-trips', () => {
  // Each one hits VRM at least once. We tolerate 4xx (demo permission limits)
  // — the test proves the request was constructed correctly and the response
  // flowed through our handlers without crashing.
  const reads: Array<[string, Record<string, unknown>]> = [
    ['vrm_get_diagnostics', { idSite: DEMO_SITE }],
    ['vrm_get_forecasts_last_reset', { idSite: DEMO_SITE }],
    ['vrm_get_custom_widgets', { idSite: DEMO_SITE }],
    ['vrm_search_sites', { query: 'yacht' }],
    ['vrm_get_site_id', { installation_identifier: 'd41243cd7c66' }], // 35ft Yacht
    ['vrm_list_invites', {}],
    ['vrm_list_data_attributes', { count: 10, page: 1 }],
    ['vrm_admin_data_attributes_count', {}],
    ['vrm_admin_search_download', {}],
    ['vrm_installation_overview_download', { body: {} }],
  ];

  for (const [name, args] of reads) {
    it(`${name} round-trips against demo`, async () => {
      const { text } = await callTool(name, args);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/eyJ[A-Za-z0-9._-]{30,}/);
    });
  }
});

describe('Live VRM demo — auth tools', () => {
  it('vrm_auth_login_as_demo returns a fresh Bearer token', async () => {
    const { text, structured } = await callTool('vrm_auth_login_as_demo', {});
    expect(text).toMatch(/Demo Bearer token/);
    expect((structured as { token?: string }).token?.length ?? 0).toBeGreaterThan(100);
  });

  // vrm_auth_logout would invalidate the test's own token; skip.
});

describe('Live VRM demo — destructive tools pass the gate then VRM rejects', () => {
  // For each destructive tool, supply confirm:true and minimal valid args.
  // Demo lacks the privileges to actually mutate, so VRM returns 401/403/404
  // — but the local confirm gate IS exercised, proving the gate-pass path works.
  // We DO NOT skip the gate here (no x-vrm-skip-confirms header).
  const destructive: Array<[string, Record<string, unknown>]> = [
    ['vrm_set_favorite', { idSite: DEMO_SITE, favorite: 1, confirm: true }],
    ['vrm_clear_alarm', { idSite: DEMO_SITE, alarmId: 1, confirm: true }],
    ['vrm_delete_alarm', { idSite: DEMO_SITE, idDataAttribute: 1, instance: 0, confirm: true }],
    ['vrm_add_alarm', { idSite: DEMO_SITE, alarm: { idDataAttribute: 1 }, confirm: true }],
    ['vrm_edit_alarm', { idSite: DEMO_SITE, alarm: { idDataAttribute: 1 }, confirm: true }],
    ['vrm_tags_add', { idSite: DEMO_SITE, tag: 'live-test', source: 'user', confirm: true }],
    ['vrm_tags_remove', { idSite: DEMO_SITE, tag: 'live-test', source: 'user', confirm: true }],
    ['vrm_set_dynamic_ess_settings', { idSite: DEMO_SITE, settings: { scheduleEnabled: false }, confirm: true }],
    ['vrm_set_site_settings', { idSite: DEMO_SITE, notes: 'live-test', confirm: true }],
    ['vrm_reset_forecasts', { idSite: DEMO_SITE, resetType: 0, confirm: true }],
    ['vrm_invite_user', { idSite: DEMO_SITE, name: 'Test', email: 't@example.com', accessLevel: 0, confirm: true }],
    ['vrm_unlink_user', { idSite: DEMO_SITE, idUser: 99999, confirm: true }],
    ['vrm_unlink_installation', { idSite: DEMO_SITE, confirm: true }],
    ['vrm_set_user_rights', { idSite: DEMO_SITE, idUser: [99999], accessLevel: [0], confirm: true }],
    ['vrm_set_invite_rights', { idSite: DEMO_SITE, email: ['t@example.com'], accessLevel: [0], confirm: true }],
    ['vrm_link_user_groups', { idSite: DEMO_SITE, userGroups: [{ idUserGroup: 1, accessLevel: 0 }], confirm: true }],
    ['vrm_set_user_group_access_level', { idSite: DEMO_SITE, idUserGroup: 1, accessLevel: 0, confirm: true }],
    ['vrm_create_access_token', { idUser: 22, name: 'live-test', confirm: true }],
    ['vrm_delete_access_token', { idUser: 22, idAccessToken: 99999999, confirm: true }],
    ['vrm_add_site', { installation_identifier: '000000000000', confirm: true }],
    ['vrm_create_custom_widget', { idSite: DEMO_SITE, widget: { name: 'live-test' }, confirm: true }],
    ['vrm_patch_custom_widget', { idSite: DEMO_SITE, widget: { id: 99999 }, confirm: true }],
    ['vrm_delete_custom_widget', { idSite: DEMO_SITE, widget: { id: 99999 }, confirm: true }],
    ['vrm_add_system', {
      description: 'live-test',
      favorite: 0,
      devices: [{ serial: 'TEST', productId: '0xFFFF', instance: 0 }],
      confirm: true,
    }],
  ];

  for (const [name, args] of destructive) {
    it(`${name} passes confirm gate, reaches VRM, comes back clean`, async () => {
      const { text } = await callTool(name, args);
      expect(text.length).toBeGreaterThan(0);
      // Local refusal must NOT fire (we passed confirm:true)
      expect(text).not.toMatch(/Refusing to execute destructive operation/);
      // Token must not leak no matter what VRM said
      expect(text).not.toMatch(/eyJ[A-Za-z0-9._-]{30,}/);
    });
  }
});

describe('Live VRM demo — security gates fire correctly when called for real', () => {
  it('rejects an obviously bogus widget name (regex) before reaching VRM', async () => {
    const { text } = await callTool('vrm_widget', { idSite: DEMO_SITE, widget: '../admin/devices' });
    expect(text).toMatch(/Input validation/);
  });

  it('refuses destructive vrm_set_favorite without confirm even with valid token', async () => {
    const { text } = await callTool('vrm_set_favorite', { idSite: DEMO_SITE, favorite: 1 });
    expect(text).toMatch(/Refusing to execute/);
  });

  it('skip-confirms header bypasses the gate but still reaches VRM cleanly', async () => {
    const r = await fetch(`${mcpBase}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${demoToken}`,
        'x-vrm-auth-scheme': 'Bearer',
        'x-vrm-skip-confirms': '1',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'vrm_set_favorite', arguments: { idSite: DEMO_SITE, favorite: 0 } },
      }),
    });
    const raw = await r.text();
    expect(raw).not.toMatch(/Refusing to execute destructive operation/);
    expect(raw).not.toMatch(new RegExp(demoToken.slice(0, 50)));
  });
});
