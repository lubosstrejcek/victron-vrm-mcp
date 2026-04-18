#!/usr/bin/env node

import * as http from 'node:http';
import { lookup as dnsLookup } from 'node:dns/promises';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import type { VrmAuthScheme } from './vrm/client.js';
import { log } from './logger.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '127.0.0.1';
const MCP_PATH = process.env['MCP_PATH'] ?? '/mcp';
const DEFAULT_SCHEME: VrmAuthScheme =
  (process.env['VRM_AUTH_SCHEME'] as VrmAuthScheme | undefined) ?? 'Token';

const ALLOWED_ORIGINS: Set<string> | null = (() => {
  const raw = process.env['ALLOWED_ORIGINS'];
  if (!raw) {
    return null;
  }
  const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
})();

const SUPPORTED_MCP_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);

const BEARER_RE = /^Bearer\s+(.+)$/i;

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = BEARER_RE.exec(header);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

function resolveScheme(header: string | string[] | undefined): VrmAuthScheme {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === 'Bearer' || raw === 'bearer') {
    return 'Bearer';
  }
  if (raw === 'Token' || raw === 'token') {
    return 'Token';
  }
  return DEFAULT_SCHEME;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    if (chunks.length === 0) {
      return undefined;
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch (error) {
    throw new Error(`Failed to read request body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (method === 'DELETE') {
    sendJson(res, 405, { error: 'method_not_allowed', message: 'Stateless server; DELETE is not supported.' });
    return;
  }
  if (method !== 'POST' && method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const origin = headerValue(req.headers.origin);
  if (ALLOWED_ORIGINS) {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Origin not allowed.' });
      return;
    }
  } else if (origin) {
    const host = headerValue(req.headers.host);
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host && originHost !== `127.0.0.1:${PORT}` && originHost !== `localhost:${PORT}`) {
        sendJson(res, 403, { error: 'forbidden', message: 'Cross-origin request rejected. Set ALLOWED_ORIGINS to allowlist hosts.' });
        return;
      }
    } catch {
      sendJson(res, 400, { error: 'bad_request', message: 'Malformed Origin header.' });
      return;
    }
  }

  if (method === 'POST') {
    const contentType = headerValue(req.headers['content-type']) ?? '';
    if (!/^application\/json(\s*;.*)?$/i.test(contentType)) {
      sendJson(res, 415, { error: 'unsupported_media_type', message: 'Content-Type must be application/json.' });
      return;
    }
    const accept = headerValue(req.headers.accept) ?? '';
    if (!/application\/json/i.test(accept) || !/text\/event-stream/i.test(accept)) {
      sendJson(res, 406, { error: 'not_acceptable', message: 'Accept must include both application/json and text/event-stream.' });
      return;
    }
  }

  const protocolVersion = headerValue(req.headers['mcp-protocol-version']);
  if (protocolVersion && !SUPPORTED_MCP_VERSIONS.has(protocolVersion)) {
    sendJson(res, 400, { error: 'bad_request', message: `Unsupported MCP-Protocol-Version: ${protocolVersion}` });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.setHeader('www-authenticate', 'Bearer realm="victron-vrm-mcp"');
    sendJson(res, 401, {
      error: 'unauthorized',
      message: 'Missing or malformed Authorization: Bearer <vrm-token> header.',
    });
    return;
  }

  const scheme = resolveScheme(req.headers['x-vrm-auth-scheme']);
  if (scheme === 'Bearer') {
    log.warn('bearer_scheme_used', {
      note: 'VRM Bearer tokens are deprecated from 2026-06-01; migrate to access tokens (Token scheme).',
    });
  }

  const skipConfirmsHeader = headerValue(req.headers['x-vrm-skip-confirms']);
  const skipConfirms = skipConfirmsHeader === '1' || skipConfirmsHeader?.toLowerCase() === 'true';
  if (skipConfirms) {
    log.warn('skip_confirms_enabled', {
      note: 'Caller sent x-vrm-skip-confirms — destructive tool calls will NOT require `confirm: true`.',
    });
  }

  const reqWithAuth = req as http.IncomingMessage & {
    auth?: { token: string; clientId: string; scopes: string[]; extra?: Record<string, unknown> };
  };
  reqWithAuth.auth = {
    token,
    clientId: 'vrm-token',
    scopes: [],
    extra: { vrmScheme: scheme, skipConfirms },
  };

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { error: 'bad_request', message });
    return;
  }

  const mcp = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const cleanup = (): void => {
    transport.close().catch(() => undefined);
    mcp.close().catch(() => undefined);
  };
  res.on('close', cleanup);

  try {
    await mcp.connect(transport);
    await transport.handleRequest(reqWithAuth, res, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('mcp_request_failed', { message });
    sendJson(res, 500, { error: 'internal_error' });
  }
}

async function main(): Promise<void> {
  process.on('uncaughtException', (error) => {
    log.error('uncaught_exception', { message: error instanceof Error ? error.message : String(error) });
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled_rejection', { message: reason instanceof Error ? reason.message : String(reason) });
  });

  const serverStartedAt = Date.now();

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      sendJson(res, 200, {
        status: 'ok',
        uptime_s: Math.round((Date.now() - serverStartedAt) / 1000),
      });
      return;
    }
    if (req.url === '/readyz') {
      dnsLookup('vrmapi.victronenergy.com')
        .then(() => sendJson(res, 200, { status: 'ready', upstream: 'vrmapi.victronenergy.com' }))
        .catch((err: Error) => sendJson(res, 503, { status: 'not_ready', reason: err.message }));
      return;
    }
    if (req.url !== MCP_PATH) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    handleMcpRequest(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error('request_handler_failed', { message });
      sendJson(res, 500, { error: 'internal_error' });
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info('shutdown_started', { signal });
    server.close((closeErr) => {
      if (closeErr) {
        log.error('server_close_failed', { message: closeErr.message });
        process.exit(1);
      }
      log.info('shutdown_complete');
      process.exit(0);
    });
    setTimeout(() => {
      log.warn('shutdown_timeout_forcing_exit');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(PORT, HOST, () => {
    log.info('listening', { host: HOST, port: PORT, path: MCP_PATH, defaultAuthScheme: DEFAULT_SCHEME });
  });
}

main().catch((error) => {
  log.error('fatal', { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
