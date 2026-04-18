import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Offline fixture sanity. Captured VRM responses live under tests/fixtures/
 * (recorded via /tmp/capture-fixtures.mjs against the demo tenant).
 *
 * These tests exist to:
 *   1. Lock the response shapes we've been assuming for tool-output formatting
 *   2. Catch any regression in what VRM returns (re-capture if these break)
 *   3. Provide grep-able examples of real payload shapes for new tool authors
 *
 * For end-to-end "tool output is correct" tests, see live.test.ts.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

function loadIfExists<T>(name: string): T | null {
  const p = resolve(fixturesDir, `${name}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as T;
}

describe('Fixture sanity (offline)', () => {
  it('users_me has demo identity (id=22, demo@victronenergy.com)', () => {
    const data = loadIfExists<{ success: boolean; user?: { id: number; email: string } }>('users_me');
    if (!data) return; // fixtures optional
    expect(data.success).toBe(true);
    expect(data.user?.id).toBe(22);
    expect(data.user?.email).toBe('demo@victronenergy.com');
  });

  it('installations response has at least 7 records', () => {
    const data = loadIfExists<{ success: boolean; records: Array<{ idSite: number; name: string }> }>('installations');
    if (!data) return;
    expect(data.success).toBe(true);
    expect(data.records.length).toBeGreaterThanOrEqual(7);
    expect(data.records.find((r) => r.idSite === 151734)?.name).toBe('35ft Yacht');
  });

  it('widget_graph captures both series with [ts, value] points', () => {
    const data = loadIfExists<{
      success: boolean;
      records: { data: Record<string, number[][]>; meta: Record<string, { code: string; description: string }> };
    }>('widget_graph_bs_bv');
    if (!data) return;
    expect(data.success).toBe(true);
    const series = Object.keys(data.records.data);
    expect(series.length).toBeGreaterThanOrEqual(1);
    for (const k of series) {
      expect(Array.isArray(data.records.data[k])).toBe(true);
      if (data.records.data[k].length > 0) {
        expect(data.records.data[k][0].length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('no fixture leaks a JWT, password, or API key', () => {
    const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const raw = readFileSync(resolve(fixturesDir, f), 'utf-8');
      expect(raw, `${f} contains JWT-shaped string`).not.toMatch(/eyJ[A-Za-z0-9._-]{30,}/);
      expect(raw.toLowerCase(), `${f} contains 'password'`).not.toMatch(/"password"\s*:\s*"[^"]+"/);
      expect(raw.toLowerCase(), `${f} contains 'apikey'`).not.toMatch(/"api[-_]?key"\s*:\s*"[^"]+"/);
    }
  });
});
