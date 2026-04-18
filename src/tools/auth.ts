import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  confirmSchema,
  errorResult,
  formatVrmError,
  requireConfirm,
  resolveAuth,
} from './helpers.js';
import { VrmApiError } from '../vrm/client.js';
import { outputSchemas } from './output_schemas.js';

const VRM_BASE_URL = 'https://vrmapi.victronenergy.com/v2';

interface LoginResponse {
  token?: string;
  idUser?: number;
  success?: boolean;
  [k: string]: unknown;
}

async function anonymousVrmFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = VRM_BASE_URL + path;
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const response = await fetch(url, { method: init?.method ?? 'GET', headers, body });
  if (!response.ok) {
    let errBody: unknown;
    try {
      errBody = await response.json();
    } catch {
      errBody = await response.text();
    }
    const retryAfter = response.status === 429 ? parseInt(response.headers.get('retry-after') ?? '', 10) : undefined;
    throw new VrmApiError(response.status, errBody, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  return response.json() as Promise<T>;
}

function summarizeToken(token: string | undefined): string {
  if (!token) {
    return '(not returned)';
  }
  return `${token.slice(0, 16)}… (length ${token.length})`;
}

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    'vrm_auth_login_as_demo',
    {
      title: 'Get a demo Bearer token',
      description:
        '⚠️ DEPRECATED by VRM on 2026-06-01 (Bearer scheme deprecation). Fetches a short-lived Bearer token for the Victron demo tenant. Useful for testing but NOT for production. Endpoint: GET /auth/loginAsDemo.',
      inputSchema: {},
      outputSchema: outputSchemas.authLogin,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const data = await anonymousVrmFetch<LoginResponse>('/auth/loginAsDemo');
        return {
          content: [{
            type: 'text',
            text: [
              '# Demo Bearer token',
              '',
              `Token (truncated): \`${summarizeToken(data.token)}\``,
              '',
              'Use this in `Authorization: Bearer <token>` with `x-vrm-auth-scheme: Bearer` on subsequent MCP requests. Bearer support ends 2026-06-01 — migrate to access tokens before then.',
            ].join('\n'),
          }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_auth_login',
    {
      title: 'Log in with email and password (DEPRECATED)',
      description:
        '⚠️⚠️ DEPRECATED by VRM on 2026-06-01 AND a security hazard — your password flows through this MCP server. STRONGLY prefer creating a personal access token via /users/{idUser}/accesstokens/create. Endpoint: POST /auth/login.',
      inputSchema: {
        username: z.string().email().max(256).describe('VRM account email.'),
        password: z.string().min(1).max(512).describe('VRM account password. ⚠️ Will pass through this MCP server. Do not use this in a shared deployment.'),
        smsToken: z.string().min(1).max(16).optional().describe('2FA SMS token, if 2FA is enabled.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.authLogin,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ username, password, smsToken, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_auth_login', extra);
      if (gate) {
        return gate;
      }
      try {
        const body: Record<string, string> = { username, password };
        if (smsToken) {
          body['sms_token'] = smsToken;
        }
        const data = await anonymousVrmFetch<LoginResponse>('/auth/login', { method: 'POST', body });
        return {
          content: [{
            type: 'text',
            text: [
              '# Login result',
              '',
              `- success: ${data.success}`,
              `- idUser: ${data.idUser ?? '(not returned)'}`,
              `- token (truncated): \`${summarizeToken(data.token)}\``,
              '',
              '⚠️ This method is deprecated. Use a personal access token instead.',
            ].join('\n'),
          }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_auth_logout',
    {
      title: 'Invalidate the current Bearer session',
      description:
        'Log out the Bearer token used for this request — invalidates the session so subsequent calls with the same Bearer fail. DESTRUCTIVE for the current session (DEPRECATED Bearer flow only; has no effect on long-lived personal access tokens). Endpoint: POST /auth/logout.',
      inputSchema: {
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_auth_logout', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const data = await auth.client.post<LoginResponse>('/auth/logout');
        return {
          content: [{ type: 'text', text: `# Logout\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('unauthorized')) {
          return errorResult('Logout refused (token already invalid or not a Bearer).');
        }
        return formatVrmError(error);
      }
    },
  );
}
