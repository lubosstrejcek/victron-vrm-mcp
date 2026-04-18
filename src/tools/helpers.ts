import { z } from 'zod';
import { createVrmClient, VrmApiError, type VrmAuthScheme, type VrmClient } from '../vrm/client.js';

export const idSiteSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .describe('VRM installation ID (positive integer). Use vrm_list_installations to discover.');

export const confirmSchema = z
  .literal(true)
  .optional()
  .describe('Must be true to execute this destructive operation. Alternative: send the request with header `x-vrm-skip-confirms: 1` to bypass this gate (trusted automated callers only).');

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const IDEMPOTENT_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function parseAllowedSites(): Set<number> | null {
  const raw = process.env['VRM_ALLOWED_SITES'];
  if (!raw) {
    return null;
  }
  const parsed = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? new Set(parsed) : null;
}

const ALLOWED_SITES = parseAllowedSites();

export function assertSiteAllowed(idSite: number): void {
  if (ALLOWED_SITES && !ALLOWED_SITES.has(idSite)) {
    throw new Error(
      `Site ${idSite} is not on the VRM_ALLOWED_SITES allowlist. Refusing to proceed.`,
    );
  }
}

export function sitePath(idSite: number, suffix: string): string {
  const id = Number(idSite);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid idSite: ${idSite}`);
  }
  const clean = suffix.replace(/^\/+/, '');
  return `/installations/${encodeURIComponent(String(id))}/${clean}`;
}

export function userPath(idUser: number, suffix: string): string {
  const id = Number(idUser);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid idUser: ${idUser}`);
  }
  const clean = suffix.replace(/^\/+/, '');
  return `/users/${encodeURIComponent(String(id))}/${clean}`;
}

export const idUserSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .describe('VRM user ID (positive integer). Use vrm_list_installations to discover your own; admin-level users can see others.');

export const accessLevelSchema = z
  .union([z.literal(0), z.literal(1), z.literal(2)])
  .describe('0 = monitoring (demo rights), 1 = full control (admin), 2 = technician.');

export type AuthResolution =
  | { ok: true; client: VrmClient }
  | { ok: false; error: ReturnType<typeof errorResult> };

export function resolveAuth(extra: unknown): AuthResolution {
  const e = extra as {
    authInfo?: { token?: string; extra?: Record<string, unknown> };
  };
  const token = e?.authInfo?.token;
  if (!token) {
    return { ok: false, error: errorResult('Unauthorized: no VRM token on MCP request.') };
  }
  if (token.length < 16) {
    return { ok: false, error: errorResult('Unauthorized: VRM token is implausibly short.') };
  }
  const scheme =
    (e?.authInfo?.extra?.['vrmScheme'] as VrmAuthScheme | undefined) ?? 'Token';
  try {
    return { ok: true, client: createVrmClient(token, scheme) };
  } catch (err) {
    return { ok: false, error: errorResult(err instanceof Error ? err.message : String(err)) };
  }
}

export function requireConfirm(
  confirm: unknown,
  operation: string,
  extra?: unknown,
): ReturnType<typeof errorResult> | null {
  const e = extra as { authInfo?: { extra?: { skipConfirms?: boolean } } } | undefined;
  if (e?.authInfo?.extra?.skipConfirms === true) {
    return null;
  }
  if (confirm !== true) {
    return errorResult(
      `Refusing to execute destructive operation "${operation}" without { confirm: true }. ` +
        'Alternative: set header `x-vrm-skip-confirms: 1` on the MCP request to bypass this gate for trusted automated callers.',
    );
  }
  return null;
}

export function errorResult(message: string): {
  isError: true;
  content: [{ type: 'text'; text: string }];
} {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function redactErrorBody(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const code = typeof b['error_code'] === 'string' ? (b['error_code'] as string) : undefined;
    const errors = typeof b['errors'] === 'string' ? (b['errors'] as string) : undefined;
    if (code || errors) {
      return `${code ?? 'error'}: ${errors ?? '(no detail)'}`.slice(0, 256);
    }
  }
  if (typeof body === 'string') {
    return body.slice(0, 256);
  }
  return '(no detail)';
}

export function formatVrmError(error: unknown): ReturnType<typeof errorResult> {
  if (error instanceof VrmApiError) {
    const retry =
      error.retryAfterSeconds !== undefined ? ` (retry after ${error.retryAfterSeconds}s)` : '';
    return errorResult(`VRM API error ${error.status}${retry}: ${redactErrorBody(error.body)}`);
  }
  return errorResult(error instanceof Error ? error.message : String(error));
}

export function getAllowedSitesConfig(): { configured: boolean; size: number } {
  return {
    configured: ALLOWED_SITES !== null,
    size: ALLOWED_SITES?.size ?? 0,
  };
}
