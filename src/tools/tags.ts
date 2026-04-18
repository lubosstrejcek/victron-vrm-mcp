import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  READ_ONLY_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  assertSiteAllowed,
  confirmSchema,
  formatVrmError,
  idSiteSchema,
  requireConfirm,
  resolveAuth,
  sitePath,
} from './helpers.js';
import { outputSchemas } from './output_schemas.js';

const tagFilterSchema = z
  .enum(['user', 'team', 'group', 'predefined'])
  .optional()
  .describe('Restrict tags to a single source.');

interface VrmTagsResponse {
  success: boolean;
  tags?: Record<string, string[]>;
}

interface VrmTagMutateResponse {
  success: boolean;
  idSite?: number;
  data?: unknown;
}

const tagSourceSchema = z
  .enum(['user', 'team', 'group', 'predefined'])
  .describe('Tag source.');

export function registerTagsTools(server: McpServer): void {
  server.registerTool(
    'vrm_get_tags',
    {
      title: 'Get installation tags',
      description:
        'List tags attached to a VRM installation, grouped by source (user, team, group, predefined). Optionally filter to a single source. Endpoint: GET /installations/{idSite}/tags.',
      inputSchema: {
        idSite: idSiteSchema,
        filter: tagFilterSchema,
      },
      outputSchema: outputSchemas.tags,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idSite, filter }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const query: Record<string, string | undefined> = {};
        if (filter) {
          query.filter = filter;
        }
        const data = await auth.client.get<VrmTagsResponse>(sitePath(idSite, 'tags'), query);

        const tags = data.tags ?? {};
        const sources = Object.keys(tags).sort();
        const total = sources.reduce((n, s) => n + (tags[s]?.length ?? 0), 0);

        const lines: string[] = [
          `# Tags on site ${idSite}`,
          '',
          `Total tags: ${total} across ${sources.length} source(s).`,
          '',
        ];

        for (const source of sources) {
          lines.push(`## ${source} (${tags[source].length})`);
          for (const tag of tags[source]) {
            lines.push(`- ${tag}`);
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

  server.registerTool(
    'vrm_tags_add',
    {
      title: 'Add a tag to an installation',
      description:
        'Attach a tag to a VRM installation. DESTRUCTIVE: modifies site metadata. Endpoint: PUT /installations/{idSite}/tags.',
      inputSchema: {
        idSite: idSiteSchema,
        tag: z.string().min(1).max(64).describe('Tag name to add.'),
        source: tagSourceSchema,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.successWithIdSite,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, tag, source, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_tags_add', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.put<VrmTagMutateResponse>(sitePath(idSite, 'tags'), {
          tag,
          source,
        });
        return {
          content: [{ type: 'text', text: `Added tag "${tag}" (source=${source}) to site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_tags_remove',
    {
      title: 'Remove a tag from an installation',
      description:
        'Detach a tag from a VRM installation. DESTRUCTIVE. Endpoint: DELETE /installations/{idSite}/tags.',
      inputSchema: {
        idSite: idSiteSchema,
        tag: z.string().min(1).max(64).describe('Tag name to remove.'),
        source: tagSourceSchema,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.successWithIdSite,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, tag, source, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_tags_remove', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.delete<VrmTagMutateResponse>(sitePath(idSite, 'tags'), {
          tag,
          source,
        });
        return {
          content: [{ type: 'text', text: `Removed tag "${tag}" (source=${source}) from site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
