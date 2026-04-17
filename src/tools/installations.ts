import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createVrmClient, VrmApiError, type VrmAuthScheme } from '../vrm/client.js';
import type { VrmUserResponse, VrmInstallationsResponse } from '../vrm/types.js';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerInstallationsTools(server: McpServer): void {
  server.registerTool(
    'vrm_list_installations',
    {
      title: 'List VRM installations',
      description:
        'List all VRM installations (sites) accessible to the authenticated user. Each record includes idSite, name, identifier, owner/admin flags, and optional metadata. Calls /users/me then /users/{idUser}/installations.',
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (_args, extra) => {
      const token = extra.authInfo?.token;
      if (!token) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Unauthorized: missing VRM token. Pass `Authorization: Bearer <vrm-token>` on the MCP request.' },
          ],
        };
      }

      const scheme = (extra.authInfo?.extra?.['vrmScheme'] as VrmAuthScheme | undefined) ?? 'Token';
      const client = createVrmClient(token, scheme);

      try {
        const me = await client.get<VrmUserResponse>('/users/me');
        const installations = await client.get<VrmInstallationsResponse>(
          `/users/${me.user.id}/installations`,
          { extended: 1 },
        );

        const lines: string[] = [
          `# VRM installations for ${me.user.name} (${me.user.email})`,
          '',
          `Found ${installations.records.length} site(s).`,
          '',
        ];

        for (const site of installations.records) {
          lines.push(`## ${site.name}`);
          lines.push(`- **idSite**: \`${site.idSite}\``);
          lines.push(`- **identifier**: \`${site.identifier}\``);
          lines.push(`- **owner**: ${site.owner}`);
          lines.push(`- **admin**: ${site.is_admin}`);
          if (site.timezone) {
            lines.push(`- **timezone**: ${site.timezone}`);
          }
          if (site.pvMax !== undefined) {
            lines.push(`- **pvMax**: ${site.pvMax}`);
          }
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: {
            user: me.user,
            records: installations.records,
          },
        };
      } catch (error) {
        if (error instanceof VrmApiError) {
          const retry = error.retryAfterSeconds !== undefined ? ` (retry after ${error.retryAfterSeconds}s)` : '';
          return {
            isError: true,
            content: [{ type: 'text', text: `VRM API error ${error.status}${retry}: ${JSON.stringify(error.body)}` }],
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text', text: `Unexpected error: ${message}` }],
        };
      }
    },
  );
}
