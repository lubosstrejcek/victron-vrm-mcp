import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { READ_ONLY_ANNOTATIONS, formatVrmError, resolveAuth } from './helpers.js';
import { outputSchemas } from './output_schemas.js';

interface VrmDataAttributeSearchResponse {
  success: boolean;
  records?: Array<{
    idSite: number;
    description?: string;
    lastTimestamp?: number;
    [k: string]: unknown;
  }>;
  attributes?: Array<{
    idDataAttribute: number;
    code: string;
    [k: string]: unknown;
  }>;
  pagination?: unknown;
}

export function registerDataAttributesTools(server: McpServer): void {
  server.registerTool(
    'vrm_find_by_data_attributes',
    {
      title: 'Find installations by data attributes',
      description:
        'Search the current user\'s installations by up to five data-attribute conditions. Query syntax uses attribute codes and comparisons, e.g. `bs>=50,au=(1,2),IV1!`. Endpoint: GET /installation-data-attributes.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe('Data-attribute filter string. Up to 5 conditions for non-admins. Examples: `bs>=50`, `au=(1 OR 3)`, `IV1!`.'),
        page: z.number().int().min(1).optional().describe('Result page (1-indexed).'),
        count: z.number().int().min(1).max(1000).optional().describe('Records per page (max 1000, default 100).'),
      },
      outputSchema: outputSchemas.dataAttributeSearch,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, page, count }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const qp: Record<string, string | number | undefined> = { query };
        if (page !== undefined) {
          qp.page = page;
        }
        if (count !== undefined) {
          qp.count = count;
        }
        const data = await auth.client.get<VrmDataAttributeSearchResponse>(
          '/installation-data-attributes',
          qp,
        );

        const records = data.records ?? [];
        const attrs = data.attributes ?? [];

        const lines: string[] = [
          `# Data-attribute search: \`${query}\``,
          '',
          `- **Matching installations**: ${records.length}`,
          `- **Attribute metadata rows**: ${attrs.length}`,
          '',
        ];

        if (records.length > 0) {
          lines.push('## Matches');
          for (const r of records.slice(0, 50)) {
            lines.push(`- \`${r.idSite}\` — ${r.description ?? '(no name)'}`);
          }
          if (records.length > 50) {
            lines.push(`- … and ${records.length - 50} more (use \`page\` / \`count\` to paginate)`);
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
