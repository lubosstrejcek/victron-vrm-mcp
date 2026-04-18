import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  READ_ONLY_ANNOTATIONS,
  assertSiteAllowed,
  formatVrmError,
  idSiteSchema,
  resolveAuth,
  sitePath,
} from './helpers.js';
import { outputSchemas } from './output_schemas.js';

interface VrmSiteUsersResponse {
  success: boolean;
  users?: Array<{ idUser: number; name: string; email: string; accessLevel: number }>;
  invites?: unknown[];
  requests?: unknown[];
  userGroups?: unknown[];
  siteGroups?: unknown[];
}

export function registerUsersTools(server: McpServer): void {
  server.registerTool(
    'vrm_get_site_users',
    {
      title: 'Get users with access to a site',
      description:
        'List all users, pending invites, access requests, user groups, and site groups linked to a VRM installation. Endpoint: GET /installations/{idSite}/users.',
      inputSchema: { idSite: idSiteSchema },
      outputSchema: outputSchemas.siteUsers,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idSite }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.get<VrmSiteUsersResponse>(sitePath(idSite, 'users'));

        const users = data.users ?? [];
        const lines: string[] = [
          `# Users on site ${idSite}`,
          '',
          `- **Direct users**: ${users.length}`,
          `- **Pending invites**: ${data.invites?.length ?? 0}`,
          `- **Pending access requests**: ${data.requests?.length ?? 0}`,
          `- **User groups**: ${data.userGroups?.length ?? 0}`,
          `- **Site groups**: ${data.siteGroups?.length ?? 0}`,
          '',
        ];

        if (users.length > 0) {
          lines.push('## Users');
          for (const u of users) {
            const level =
              u.accessLevel === 0 ? 'monitoring' : u.accessLevel === 1 ? 'full control' : u.accessLevel === 2 ? 'technician' : `unknown(${u.accessLevel})`;
            lines.push(`- **${u.name}** (${u.email}) — ${level} [idUser: \`${u.idUser}\`]`);
          }
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
