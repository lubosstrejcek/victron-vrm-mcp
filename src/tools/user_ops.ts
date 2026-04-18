import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  confirmSchema,
  formatVrmError,
  idUserSchema,
  requireConfirm,
  resolveAuth,
  userPath,
} from './helpers.js';
import type { VrmUserResponse } from '../vrm/types.js';
import { outputSchemas } from './output_schemas.js';

interface GenericResponse {
  success: boolean;
  [k: string]: unknown;
}

async function resolveCurrentUser(authedClient: { get: <T>(p: string) => Promise<T> }): Promise<number> {
  const me = await authedClient.get<VrmUserResponse>('/users/me');
  return me.user.id;
}

export function registerUserOpsTools(server: McpServer): void {
  server.registerTool(
    'vrm_search_sites',
    {
      title: 'Search installations',
      description:
        'Search for sites the caller has access to by site ID, user email, user name, device serial number, site identifier, or email domain. Endpoint: GET /users/{idUser}/search.',
      inputSchema: {
        query: z.string().min(1).max(256).describe('Search term.'),
        idUser: idUserSchema.optional().describe('User ID to search within. Defaults to the caller (/users/me).'),
      },
      outputSchema: outputSchemas.successWithRecords,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, idUser }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const uid = idUser ?? (await resolveCurrentUser(auth.client));
        const data = await auth.client.get<GenericResponse>(userPath(uid, 'search'), { query });
        const count = (data as { count?: number }).count ?? 0;
        return {
          content: [{ type: 'text', text: `# Search "${query}" — idUser ${uid}\n\n${count} result(s).` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_get_site_id',
    {
      title: 'Resolve site identifier to idSite',
      description:
        'Look up the numeric idSite for a given 12-char hex installation_identifier (the portalId printed on the GX device). Endpoint: POST /users/{idUser}/get-site-id.',
      inputSchema: {
        installation_identifier: z.string().min(4).max(64).describe('Site identifier (e.g. `c0619ab27f32`).'),
        idUser: idUserSchema.optional().describe('User ID. Defaults to the caller.'),
      },
      outputSchema: outputSchemas.siteIdLookup,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ installation_identifier, idUser }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const uid = idUser ?? (await resolveCurrentUser(auth.client));
        const data = await auth.client.post<GenericResponse>(userPath(uid, 'get-site-id'), {
          installation_identifier,
        });
        const siteId = (data as { records?: { site_id?: string } }).records?.site_id;
        return {
          content: [{ type: 'text', text: `# Site lookup\n\nidentifier \`${installation_identifier}\` → site_id: \`${siteId ?? '(not found)'}\`` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_list_invites',
    {
      title: 'List pending invites',
      description:
        'List invitations the user has issued or received. Endpoint: GET /users/{idUser}/invites.',
      inputSchema: {
        idUser: idUserSchema.optional().describe('User ID. Defaults to the caller.'),
      },
      outputSchema: outputSchemas.successWithRecords,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idUser }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const uid = idUser ?? (await resolveCurrentUser(auth.client));
        const data = await auth.client.get<GenericResponse>(userPath(uid, 'invites'));
        const invites = (data as { invites?: unknown[] }).invites ?? [];
        return {
          content: [{ type: 'text', text: `# Invites for user ${uid}\n\n${invites.length} pending.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_add_site',
    {
      title: 'Add an installation to the user account',
      description:
        'Link a VRM installation (by identifier) to the user account. An email is sent when done. DESTRUCTIVE: modifies account membership. Endpoint: POST /users/{idUser}/addsite.',
      inputSchema: {
        installation_identifier: z.string().min(4).max(64).describe('Site identifier (e.g. `c0619ab27f32`).'),
        idUser: idUserSchema.optional().describe('User ID. Defaults to the caller.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ installation_identifier, idUser, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_add_site', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const uid = idUser ?? (await resolveCurrentUser(auth.client));
        const data = await auth.client.post<GenericResponse>(userPath(uid, 'addsite'), {
          installation_identifier,
        });
        return {
          content: [{ type: 'text', text: `Add-site request for identifier \`${installation_identifier}\` on user ${uid}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
