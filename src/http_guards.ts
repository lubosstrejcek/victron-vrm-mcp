/**
 * HTTP-layer guards shared by the Node entry (`src/index.ts`) and the
 * Cloudflare Workers entry (`src/worker.ts`). The guard logic is identical
 * regardless of runtime; only the request/response types differ. This module
 * works on plain header values to stay runtime-agnostic.
 */

export type VrmAuthScheme = 'Token' | 'Bearer';

export const SUPPORTED_MCP_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);

const BEARER_REGEX = /^Bearer\s+(.+)$/i;

export interface GuardResult {
  ok: boolean;
  status?: number;
  body?: { error: string; message?: string };
  /** Extra headers to set on the response (e.g. WWW-Authenticate). */
  headers?: Record<string, string>;
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = authorization.match(BEARER_REGEX);
  return m ? m[1].trim() : null;
}

export function resolveAuthScheme(headerVal: string | undefined, defaultScheme: VrmAuthScheme): VrmAuthScheme {
  if (headerVal === 'Bearer' || headerVal === 'bearer') return 'Bearer';
  if (headerVal === 'Token' || headerVal === 'token') return 'Token';
  return defaultScheme;
}

export function isTrue(headerVal: string | undefined): boolean {
  if (!headerVal) return false;
  const v = headerVal.toLowerCase();
  return v === '1' || v === 'true';
}

export interface OriginGuardOpts {
  allowedOrigins: Set<string> | null;
  /** Same-origin host (e.g. "localhost:3000"). When allowedOrigins is null, only same-origin + loopback pass. */
  selfHost?: string;
  selfPort?: number;
}

export function checkOrigin(originHeader: string | undefined, opts: OriginGuardOpts): GuardResult {
  if (!originHeader) {
    // No Origin → not from a browser context. Allow.
    return { ok: true };
  }
  if (opts.allowedOrigins) {
    if (opts.allowedOrigins.has(originHeader)) return { ok: true };
    return { ok: false, status: 403, body: { error: 'forbidden', message: 'Origin not allowed.' } };
  }
  // Default: same-origin + loopback only.
  let originHost: string;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return { ok: false, status: 400, body: { error: 'bad_request', message: 'Malformed Origin header.' } };
  }
  if (
    opts.selfHost &&
    (originHost === opts.selfHost ||
      originHost === `127.0.0.1:${opts.selfPort}` ||
      originHost === `localhost:${opts.selfPort}`)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    body: { error: 'forbidden', message: 'Cross-origin request rejected. Set ALLOWED_ORIGINS to allowlist hosts.' },
  };
}

export function checkContentType(contentType: string | undefined): GuardResult {
  if (!contentType || !/^application\/json(\s*;.*)?$/i.test(contentType)) {
    return { ok: false, status: 415, body: { error: 'unsupported_media_type', message: 'Content-Type must be application/json.' } };
  }
  return { ok: true };
}

export function checkAccept(accept: string | undefined): GuardResult {
  const a = accept ?? '';
  if (!/application\/json/i.test(a) || !/text\/event-stream/i.test(a)) {
    return { ok: false, status: 406, body: { error: 'not_acceptable', message: 'Accept must include both application/json and text/event-stream.' } };
  }
  return { ok: true };
}

export function checkProtocolVersion(version: string | undefined): GuardResult {
  if (version && !SUPPORTED_MCP_VERSIONS.has(version)) {
    return { ok: false, status: 400, body: { error: 'bad_request', message: `Unsupported MCP-Protocol-Version: ${version}` } };
  }
  return { ok: true };
}

export function checkAuthorization(authorization: string | undefined): { ok: true; token: string } | { ok: false; result: GuardResult } {
  const token = extractBearerToken(authorization);
  if (!token) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 401,
        body: { error: 'unauthorized', message: 'Missing or malformed Authorization: Bearer <vrm-token> header.' },
        headers: { 'www-authenticate': 'Bearer realm="victron-vrm-mcp"' },
      },
    };
  }
  return { ok: true, token };
}
