import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  WRITE_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  confirmSchema,
  formatVrmError,
  idUserSchema,
  requireConfirm,
  resolveAuth,
  userPath,
} from './helpers.js';
import { outputSchemas } from './output_schemas.js';

interface VrmAccessTokenCreateResponse {
  success: boolean;
  token?: string;
  idAccessToken?: number;
  data?: Record<string, unknown>;
}

interface VrmAccessTokenDeleteResponse {
  success: boolean;
  data?: { removed?: number };
}

const idAccessTokenSchema = z
  .union([
    z.number().int().positive().describe('Specific access token ID to revoke.'),
    z.literal('*').describe('Wildcard — revokes ALL access tokens for the user.'),
  ])
  .describe('Access token ID (number) or the literal "*" to revoke all tokens.');

export function registerAccessTokensTools(server: McpServer): void {
  server.registerTool(
    'vrm_create_access_token',
    {
      title: 'Create a VRM personal access token',
      description:
        'Create a new long-lived VRM access token for a user. DESTRUCTIVE: the returned token grants API access and should be stored securely. Endpoint: POST /users/{idUser}/accesstokens/create.',
      inputSchema: {
        idUser: idUserSchema,
        name: z.string().min(1).max(128).describe('Human-readable label for the token (e.g. "home-assistant").'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.accessTokenCreate,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ idUser, name, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_create_access_token', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const data = await auth.client.post<VrmAccessTokenCreateResponse>(
          userPath(idUser, 'accesstokens/create'),
          { name },
        );
        const token = data.token ?? (data.data as { token?: string } | undefined)?.token;
        const idAccessToken =
          data.idAccessToken ?? (data.data as { idAccessToken?: number } | undefined)?.idAccessToken;
        const lines: string[] = [
          `# Access token created for user ${idUser}`,
          '',
          `- **Name**: ${name}`,
          `- **idAccessToken**: \`${idAccessToken ?? '(not returned)'}\``,
          `- **token**: \`${token ?? '(not returned)'}\``,
          '',
          '**⚠️ This is the only time the token value is shown. Store it securely.** Use it in the `Authorization: Bearer …` header on subsequent MCP requests (with `x-vrm-auth-scheme: Token`).',
        ];
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_delete_access_token',
    {
      title: 'Revoke a VRM access token',
      description:
        'Revoke one VRM access token by id, or ALL tokens by passing idAccessToken: "*". DESTRUCTIVE: revoked tokens cannot be restored. If the caller uses the same token being revoked, all subsequent calls will fail. Endpoint: DELETE /users/{idUser}/accesstokens/{idAccessToken}.',
      inputSchema: {
        idUser: idUserSchema,
        idAccessToken: idAccessTokenSchema,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.accessTokenDelete,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idUser, idAccessToken, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_delete_access_token', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const tokenPart = idAccessToken === '*' ? '*' : encodeURIComponent(String(idAccessToken));
        const data = await auth.client.delete<VrmAccessTokenDeleteResponse>(
          userPath(idUser, `accesstokens/${tokenPart}`),
        );
        const removed = data.data?.removed ?? 0;
        return {
          content: [{ type: 'text', text: `Revoked ${removed} token(s) for user ${idUser}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
