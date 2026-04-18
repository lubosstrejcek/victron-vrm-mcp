import { describe, it, expect } from 'vitest';
import {
  checkAccept,
  checkAuthorization,
  checkContentType,
  checkOrigin,
  checkProtocolVersion,
  extractBearerToken,
  isTrue,
  resolveAuthScheme,
  SUPPORTED_MCP_VERSIONS,
} from '../src/http_guards.js';

describe('extractBearerToken', () => {
  it('returns the token when prefixed correctly', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('bearer xyz')).toBe('xyz');
    expect(extractBearerToken('Bearer    spaces  ')).toBe('spaces');
  });
  it('returns null otherwise', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Token abc')).toBeNull();
    expect(extractBearerToken('abc')).toBeNull();
  });
});

describe('resolveAuthScheme', () => {
  it('honors explicit Token / Bearer (case-insensitive)', () => {
    expect(resolveAuthScheme('Token', 'Token')).toBe('Token');
    expect(resolveAuthScheme('bearer', 'Token')).toBe('Bearer');
  });
  it('falls back to default for anything else', () => {
    expect(resolveAuthScheme(undefined, 'Token')).toBe('Token');
    expect(resolveAuthScheme('Whatever', 'Bearer')).toBe('Bearer');
  });
});

describe('isTrue', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['0', false],
    ['false', false],
    [undefined, false],
    ['yes', false],
  ])('isTrue(%j) = %j', (input, expected) => {
    expect(isTrue(input as string | undefined)).toBe(expected);
  });
});

describe('checkOrigin', () => {
  it('allows when no Origin header', () => {
    expect(checkOrigin(undefined, { allowedOrigins: null })).toEqual({ ok: true });
  });
  it('allows allowlisted origins', () => {
    const allowed = new Set(['https://claude.ai']);
    expect(checkOrigin('https://claude.ai', { allowedOrigins: allowed }).ok).toBe(true);
    expect(checkOrigin('https://evil.example.com', { allowedOrigins: allowed }).ok).toBe(false);
  });
  it('falls back to same-origin / loopback when allowlist is null', () => {
    expect(checkOrigin('http://127.0.0.1:3000', { allowedOrigins: null, selfHost: '127.0.0.1:3000', selfPort: 3000 }).ok).toBe(true);
    expect(checkOrigin('http://localhost:3000', { allowedOrigins: null, selfHost: 'somehost', selfPort: 3000 }).ok).toBe(true);
    expect(checkOrigin('https://evil.example.com', { allowedOrigins: null, selfHost: '127.0.0.1:3000', selfPort: 3000 }).ok).toBe(false);
  });
  it('400s on malformed Origin', () => {
    const r = checkOrigin('not a url', { allowedOrigins: null });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });
});

describe('checkContentType', () => {
  it('accepts application/json with or without charset', () => {
    expect(checkContentType('application/json').ok).toBe(true);
    expect(checkContentType('application/json; charset=utf-8').ok).toBe(true);
  });
  it('rejects others', () => {
    expect(checkContentType(undefined).ok).toBe(false);
    expect(checkContentType('text/plain').ok).toBe(false);
    expect(checkContentType('application/xml').ok).toBe(false);
  });
});

describe('checkAccept', () => {
  it('requires both application/json and text/event-stream', () => {
    expect(checkAccept('application/json, text/event-stream').ok).toBe(true);
    expect(checkAccept('application/json,text/event-stream;q=0.9').ok).toBe(true);
  });
  it('rejects partial', () => {
    expect(checkAccept('application/json').ok).toBe(false);
    expect(checkAccept('text/event-stream').ok).toBe(false);
    expect(checkAccept('').ok).toBe(false);
    expect(checkAccept(undefined).ok).toBe(false);
  });
});

describe('checkProtocolVersion', () => {
  it('accepts known versions', () => {
    for (const v of SUPPORTED_MCP_VERSIONS) {
      expect(checkProtocolVersion(v).ok).toBe(true);
    }
  });
  it('rejects unknown', () => {
    const r = checkProtocolVersion('1999-01-01');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });
  it('allows missing header', () => {
    expect(checkProtocolVersion(undefined).ok).toBe(true);
  });
});

describe('checkAuthorization', () => {
  it('returns the token when present', () => {
    const r = checkAuthorization('Bearer abc');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token).toBe('abc');
  });
  it('returns 401 + WWW-Authenticate when missing', () => {
    const r = checkAuthorization(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.result.status).toBe(401);
      expect(r.result.headers?.['www-authenticate']).toMatch(/Bearer/);
    }
  });
});
