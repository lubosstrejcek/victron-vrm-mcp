import { describe, it, expect, afterEach } from 'vitest';
import {
  assertSiteAllowed,
  formatVrmError,
  getAllowedSitesConfig,
  parseAllowedSites,
  reloadAllowedSites,
  requireConfirm,
  sitePath,
  userPath,
  resolveAuth,
  idSiteSchema,
  idUserSchema,
  accessLevelSchema,
  confirmSchema,
} from '../src/tools/helpers.js';
import { VrmApiError } from '../src/vrm/client.js';

describe('sitePath / userPath — URL-safe path construction', () => {
  it('builds site path with numeric id', () => {
    expect(sitePath(151734, 'alarms')).toBe('/installations/151734/alarms');
  });

  it('strips leading slashes on suffix', () => {
    expect(sitePath(1, '/foo/bar')).toBe('/installations/1/foo/bar');
  });

  it('rejects non-integer idSite', () => {
    expect(() => sitePath(1.5 as unknown as number, 'x')).toThrow(/Invalid idSite/);
  });

  it('rejects zero and negative idSite', () => {
    expect(() => sitePath(0, 'x')).toThrow();
    expect(() => sitePath(-1, 'x')).toThrow();
  });

  it('builds user path', () => {
    expect(userPath(22, 'installations')).toBe('/users/22/installations');
  });

  it('rejects invalid idUser', () => {
    expect(() => userPath(0, 'x')).toThrow();
    expect(() => userPath(-1, 'x')).toThrow();
  });
});

describe('zod schemas', () => {
  it('idSiteSchema accepts positive integers', () => {
    expect(idSiteSchema.parse(1)).toBe(1);
    expect(idSiteSchema.parse(999999)).toBe(999999);
  });

  it('idSiteSchema rejects zero, negative, float, string', () => {
    expect(() => idSiteSchema.parse(0)).toThrow();
    expect(() => idSiteSchema.parse(-1)).toThrow();
    expect(() => idSiteSchema.parse(1.5)).toThrow();
    expect(() => idSiteSchema.parse('1')).toThrow();
  });

  it('idUserSchema mirrors idSiteSchema constraints', () => {
    expect(idUserSchema.parse(22)).toBe(22);
    expect(() => idUserSchema.parse(0)).toThrow();
  });

  it('accessLevelSchema accepts 0, 1, 2 only', () => {
    expect(accessLevelSchema.parse(0)).toBe(0);
    expect(accessLevelSchema.parse(1)).toBe(1);
    expect(accessLevelSchema.parse(2)).toBe(2);
    expect(() => accessLevelSchema.parse(3)).toThrow();
    expect(() => accessLevelSchema.parse(-1)).toThrow();
  });

  it('confirmSchema accepts true and undefined', () => {
    expect(confirmSchema.parse(true)).toBe(true);
    expect(confirmSchema.parse(undefined)).toBeUndefined();
  });

  it('confirmSchema rejects false', () => {
    expect(() => confirmSchema.parse(false)).toThrow();
  });
});

describe('requireConfirm', () => {
  it('refuses when confirm is not true and no skip context', () => {
    const result = requireConfirm(undefined, 'test_op');
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toMatch(/Refusing to execute/);
  });

  it('allows when confirm === true', () => {
    expect(requireConfirm(true, 'test_op')).toBeNull();
  });

  it('allows when skipConfirms flag is set in extra.authInfo.extra', () => {
    const extra = { authInfo: { extra: { skipConfirms: true } } };
    expect(requireConfirm(undefined, 'test_op', extra)).toBeNull();
  });

  it('still refuses when skipConfirms is not exactly true', () => {
    const extra = { authInfo: { extra: { skipConfirms: 'yes' } } };
    expect(requireConfirm(undefined, 'test_op', extra)?.isError).toBe(true);
  });

  it('mentions the skip header in the refusal message', () => {
    const result = requireConfirm(undefined, 'test_op');
    expect(result?.content[0].text).toMatch(/x-vrm-skip-confirms/);
  });
});

describe('resolveAuth', () => {
  it('refuses when no token', () => {
    const r = resolveAuth({});
    expect(r.ok).toBe(false);
  });

  it('refuses when token is too short', () => {
    const r = resolveAuth({ authInfo: { token: 'short' } });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid-length token and constructs a client', () => {
    const r = resolveAuth({ authInfo: { token: 'x'.repeat(32) } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.client.get).toBe('function');
      expect(typeof r.client.post).toBe('function');
      expect(typeof r.client.put).toBe('function');
      expect(typeof r.client.patch).toBe('function');
      expect(typeof r.client.delete).toBe('function');
      expect(typeof r.client.postDownload).toBe('function');
    }
  });
});

describe('formatVrmError — error-body redaction', () => {
  it('extracts error_code and errors string, drops rest', () => {
    const err = new VrmApiError(403, { success: false, errors: 'You lack rights', error_code: 'forbidden' });
    const r = formatVrmError(err);
    // 403s now include a hint about vrm_capabilities; verify both parts are present.
    expect(r.content[0].text).toMatch(/^VRM API error 403: forbidden: You lack rights/);
    expect(r.content[0].text).toMatch(/vrm_capabilities/);
  });

  it('includes Retry-After on 429', () => {
    const err = new VrmApiError(429, { errors: 'slow down', error_code: 'rate_limited' }, 5);
    const r = formatVrmError(err);
    expect(r.content[0].text).toMatch(/retry after 5s/);
  });

  it('does not echo arbitrary extra fields from the body', () => {
    const err = new VrmApiError(403, {
      errors: 'nope',
      error_code: 'forbidden',
      debug_internal_id: 'SECRET-LEAK-ATTEMPT',
    });
    const r = formatVrmError(err);
    expect(r.content[0].text).not.toMatch(/SECRET-LEAK-ATTEMPT/);
  });

  it('truncates oversized bodies', () => {
    const long = 'a'.repeat(1000);
    const err = new VrmApiError(400, { errors: long, error_code: 'big' });
    const r = formatVrmError(err);
    expect(r.content[0].text.length).toBeLessThan(400);
  });

  it('handles non-Error inputs', () => {
    const r = formatVrmError(new Error('boom'));
    expect(r.content[0].text).toBe('boom');
  });

  it('redacts plain-string error bodies (non-JSON upstream responses) and truncates them', () => {
    const err = new VrmApiError(502, '<html>Bad gateway</html>' + 'x'.repeat(1000));
    const r = formatVrmError(err);
    expect(r.content[0].text).toMatch(/^VRM API error 502: <html>Bad gateway<\/html>/);
    expect(r.content[0].text.length).toBeLessThan(400);
  });

  it('falls back to "(no detail)" for bodies with no usable fields', () => {
    const err = new VrmApiError(500, { unexpected: 'shape' });
    const r = formatVrmError(err);
    expect(r.content[0].text).toMatch(/\(no detail\)/);
  });

  it('honors a caller-supplied hint over the default 403 hint', () => {
    const err = new VrmApiError(403, { errors: 'nope', error_code: 'forbidden' });
    const r = formatVrmError(err, { hint: ' custom-hint-text' });
    expect(r.content[0].text).toMatch(/custom-hint-text/);
    expect(r.content[0].text).not.toMatch(/vrm_capabilities/);
  });
});

describe('VRM_ALLOWED_SITES allowlist', () => {
  const originalEnv = process.env['VRM_ALLOWED_SITES'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['VRM_ALLOWED_SITES'];
    } else {
      process.env['VRM_ALLOWED_SITES'] = originalEnv;
    }
    reloadAllowedSites();
  });

  it('parseAllowedSites returns null for unset or empty input', () => {
    expect(parseAllowedSites(undefined)).toBeNull();
    expect(parseAllowedSites('')).toBeNull();
  });

  it('parseAllowedSites parses a comma-separated list, tolerating whitespace', () => {
    const set = parseAllowedSites(' 151734 , 200001 ');
    expect(set).not.toBeNull();
    expect([...set!].sort()).toEqual([151734, 200001]);
  });

  it('parseAllowedSites drops garbage, zero, and negative entries', () => {
    const set = parseAllowedSites('abc,-5,0,42,,3.9');
    // parseInt('3.9') === 3 — documented tolerance; the guard is the > 0 filter.
    expect(set).not.toBeNull();
    expect(set!.has(42)).toBe(true);
    expect(set!.has(-5)).toBe(false);
    expect(set!.has(0)).toBe(false);
  });

  it('parseAllowedSites returns null (not an empty allow-nothing set) for all-garbage input', () => {
    expect(parseAllowedSites('abc,,-1')).toBeNull();
  });

  it('assertSiteAllowed is a no-op when no allowlist is configured', () => {
    delete process.env['VRM_ALLOWED_SITES'];
    reloadAllowedSites();
    expect(() => assertSiteAllowed(999999)).not.toThrow();
    expect(getAllowedSitesConfig()).toEqual({ configured: false, size: 0 });
  });

  it('assertSiteAllowed permits listed sites and refuses unlisted ones', () => {
    process.env['VRM_ALLOWED_SITES'] = '151734,200001';
    reloadAllowedSites();
    expect(() => assertSiteAllowed(151734)).not.toThrow();
    expect(() => assertSiteAllowed(200001)).not.toThrow();
    expect(() => assertSiteAllowed(7)).toThrow(/not on the VRM_ALLOWED_SITES allowlist/);
    expect(getAllowedSitesConfig()).toEqual({ configured: true, size: 2 });
  });

  it('caches the parsed allowlist until reloadAllowedSites is called', () => {
    process.env['VRM_ALLOWED_SITES'] = '1';
    reloadAllowedSites();
    expect(() => assertSiteAllowed(2)).toThrow();
    // Env changes without a reload must NOT take effect (prod reads it once).
    process.env['VRM_ALLOWED_SITES'] = '2';
    expect(() => assertSiteAllowed(2)).toThrow();
    reloadAllowedSites();
    expect(() => assertSiteAllowed(2)).not.toThrow();
  });
});
