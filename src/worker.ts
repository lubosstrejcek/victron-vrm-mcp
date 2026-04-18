/**
 * Cloudflare Workers entry point.
 *
 * Uses WebStandardStreamableHTTPServerTransport from the MCP SDK so the same
 * tool surface that runs on Node also runs on Workers, Deno, Bun, etc.
 *
 * Deployment requires `nodejs_compat` in wrangler.toml — the VRM client uses
 * `node:crypto` for token-bucket key hashing and the existing logger writes to
 * stderr. Both work on Workers when nodejs_compat is enabled (current Workers
 * runtime polyfills these).
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer } from './server.js';
import {
  checkAccept,
  checkAuthorization,
  checkContentType,
  checkOrigin,
  checkProtocolVersion,
  isTrue,
  resolveAuthScheme,
  type GuardResult,
  type VrmAuthScheme,
} from './http_guards.js';

export interface Env {
  /** Comma-separated allowed origins. If unset, only same-origin / loopback. */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated allowed idSite values (consumed inside the tool layer via process.env). */
  VRM_ALLOWED_SITES?: string;
  /** Default scheme for forwarding to VRM ("Token" or "Bearer"). */
  VRM_AUTH_SCHEME?: string;
  /** MCP endpoint path; defaults to /mcp. */
  MCP_PATH?: string;
}

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function guardToResponse(g: GuardResult): Response | null {
  if (g.ok) return null;
  return jsonResponse(g.status ?? 500, g.body ?? { error: 'guard_failed' }, g.headers ?? {});
}

function parseAllowedOrigins(env: Env): Set<string> | null {
  const raw = env.ALLOWED_ORIGINS;
  if (!raw) return null;
  const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const mcpPath = env.MCP_PATH ?? '/mcp';

    // Health endpoints — exempt from MCP guards so platform probes pass.
    if (url.pathname === '/healthz') {
      return jsonResponse(200, { status: 'ok', runtime: 'cloudflare-workers' });
    }
    if (url.pathname === '/readyz') {
      // No DNS lookup here — Workers prohibit it. Liveness suffices.
      return jsonResponse(200, { status: 'ready', runtime: 'cloudflare-workers' });
    }

    if (url.pathname !== mcpPath) {
      return jsonResponse(404, { error: 'not_found' });
    }

    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }
    if (method === 'DELETE') {
      return jsonResponse(405, { error: 'method_not_allowed', message: 'Stateless server; DELETE is not supported.' });
    }
    if (method !== 'POST' && method !== 'GET') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    // ── Guards ─────────────────────────────────────────────────────────────
    const originRes = guardToResponse(
      checkOrigin(request.headers.get('origin') ?? undefined, {
        allowedOrigins: parseAllowedOrigins(env),
        selfHost: url.host,
      }),
    );
    if (originRes) return originRes;

    if (method === 'POST') {
      const ctRes = guardToResponse(checkContentType(request.headers.get('content-type') ?? undefined));
      if (ctRes) return ctRes;
      const acceptRes = guardToResponse(checkAccept(request.headers.get('accept') ?? undefined));
      if (acceptRes) return acceptRes;
    }

    const pvRes = guardToResponse(checkProtocolVersion(request.headers.get('mcp-protocol-version') ?? undefined));
    if (pvRes) return pvRes;

    const authCheck = checkAuthorization(request.headers.get('authorization') ?? undefined);
    if (!authCheck.ok) {
      const r = guardToResponse(authCheck.result);
      if (r) return r;
    }
    if (!authCheck.ok) {
      // unreachable but TS narrowing
      return jsonResponse(500, { error: 'internal_error' });
    }
    const token = authCheck.token;

    const defaultScheme: VrmAuthScheme = (env.VRM_AUTH_SCHEME as VrmAuthScheme | undefined) ?? 'Token';
    const scheme = resolveAuthScheme(request.headers.get('x-vrm-auth-scheme') ?? undefined, defaultScheme);
    const skipConfirms = isTrue(request.headers.get('x-vrm-skip-confirms') ?? undefined);

    // ── Per-request MCP server + transport ────────────────────────────────
    // Stateless mode + JSON response mode: each request returns a complete
    // JSON body (no SSE streaming) so we don't need to coordinate stream
    // lifecycle with the Workers runtime. The per-request McpServer +
    // transport are GC'd when the request completes.
    const mcp = createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcp.connect(transport);

    try {
      return await transport.handleRequest(request, {
        authInfo: {
          token,
          clientId: 'vrm-token',
          scopes: [],
          extra: { vrmScheme: scheme, skipConfirms },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse(500, { error: 'internal_error', message });
    }
  },
};
