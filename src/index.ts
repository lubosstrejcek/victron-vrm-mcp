#!/usr/bin/env node

import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import type { VrmAuthScheme } from './vrm/client.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '127.0.0.1';
const MCP_PATH = process.env['MCP_PATH'] ?? '/mcp';
const DEFAULT_SCHEME: VrmAuthScheme = (process.env['VRM_AUTH_SCHEME'] as VrmAuthScheme | undefined) ?? 'Token';

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
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
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
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
}

async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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

  const reqWithAuth = req as http.IncomingMessage & {
    auth?: { token: string; clientId: string; scopes: string[]; extra?: Record<string, unknown> };
  };
  reqWithAuth.auth = {
    token,
    clientId: 'vrm-token',
    scopes: [],
    extra: { vrmScheme: scheme },
  };

  const body = await readBody(req);

  const mcp = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on('close', () => {
    transport.close().catch(() => undefined);
    mcp.close().catch(() => undefined);
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(reqWithAuth, res, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[handleMcpRequest]', message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal_error', message });
    }
  }
}

async function main(): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.url !== MCP_PATH) {
      sendJson(res, 404, { error: 'not_found', path: req.url });
      return;
    }
    handleMcpRequest(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[server]', message);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', message });
      }
    });
  });

  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(PORT, HOST, () => {
    console.log(`victron-vrm-mcp listening on http://${HOST}:${PORT}${MCP_PATH}`);
    console.log(`default VRM auth scheme: ${DEFAULT_SCHEME} (override per-request with x-vrm-auth-scheme: Token|Bearer)`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
