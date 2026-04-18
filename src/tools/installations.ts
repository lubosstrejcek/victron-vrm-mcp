import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VrmUserResponse, VrmInstallationsResponse } from '../vrm/types.js';
import { READ_ONLY_ANNOTATIONS, formatVrmError, resolveAuth } from './helpers.js';
import { outputSchemas } from './output_schemas.js';

export function registerInstallationsTools(server: McpServer): void {
  server.registerTool(
    'vrm_list_installations',
    {
      title: 'List VRM installations',
      description:
        'List all VRM installations (sites) accessible to the authenticated user. Calls /users/me then /users/{idUser}/installations. Returns idSite, name, identifier, owner/admin flags, and metadata for each site.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Max number of sites to render in markdown (default 100). Full list always returned in structuredContent.'),
      },
      outputSchema: outputSchemas.installations,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ limit }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }

      try {
        const me = await auth.client.get<VrmUserResponse>('/users/me');
        const userId = Number(me.user.id);
        if (!Number.isInteger(userId) || userId <= 0) {
          return formatVrmError(new Error(`Invalid userId from /users/me: ${me.user.id}`));
        }

        const installations = await auth.client.get<VrmInstallationsResponse>(
          `/users/${encodeURIComponent(String(userId))}/installations`,
          { extended: 1 },
        );

        const cap = limit ?? 100;
        const shown = installations.records.slice(0, cap);
        const truncated = installations.records.length > shown.length;
        const lines: string[] = [
          `# VRM installations for ${me.user.name} (${me.user.email})`,
          '',
          `Found ${installations.records.length} site(s)${truncated ? ` — showing first ${shown.length}` : ''}.`,
          '',
        ];

        for (const site of shown) {
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
        return formatVrmError(error);
      }
    },
  );
}
