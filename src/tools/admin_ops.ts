import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  confirmSchema,
  formatVrmError,
  requireConfirm,
  resolveAuth,
} from './helpers.js';
import type { QueryValue } from '../vrm/client.js';
import { outputSchemas } from './output_schemas.js';

interface GenericResponse {
  success: boolean;
  [k: string]: unknown;
}

const passthroughQuerySchema = z
  .record(
    z.string().min(1).max(64),
    z.union([z.string().max(512), z.number(), z.boolean(), z.array(z.string().max(128)).max(20), z.array(z.number()).max(20)]),
  )
  .optional()
  .describe('Free-form query parameters passed through to VRM. Keep keys/values under documented limits.');

export function registerAdminOpsTools(server: McpServer): void {
  server.registerTool(
    'vrm_list_data_attributes',
    {
      title: 'List VRM data-attribute definitions',
      description:
        'Catalog of all VRM data attributes (codes, descriptions, units). Reference/documentation lookup. Endpoint: GET /data-attributes.',
      inputSchema: {
        query: passthroughQuerySchema,
      },
      outputSchema: outputSchemas.successWithRecords,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const data = await auth.client.get<GenericResponse>('/data-attributes', query as Record<string, QueryValue | undefined> | undefined);
        const records = (data as { records?: unknown[] }).records ?? [];
        return {
          content: [{ type: 'text', text: `# Data attributes\n\n${Array.isArray(records) ? records.length : 0} records.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_admin_list_devices',
    {
      title: 'Admin — list all devices (admin-only)',
      description:
        '⚠️ ADMIN-ONLY. Returns 403 for non-admin users. Lists devices across all installations. Endpoint: GET /admin/devices.',
      inputSchema: {
        query: passthroughQuerySchema,
      },
      outputSchema: outputSchemas.success,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const data = await auth.client.get<GenericResponse>('/admin/devices', query as Record<string, QueryValue | undefined> | undefined);
        return {
          content: [{ type: 'text', text: `# /admin/devices\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_admin_data_attributes_count',
    {
      title: 'Admin — count installations by data-attribute (admin-only)',
      description:
        '⚠️ ADMIN-ONLY. Count installations across the full corpus matching given data-attribute conditions. Endpoint: GET /admin/installation-data-attributes-count.',
      inputSchema: {
        query: passthroughQuerySchema,
      },
      outputSchema: outputSchemas.success,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const data = await auth.client.get<GenericResponse>(
          '/admin/installation-data-attributes-count',
          query as Record<string, QueryValue | undefined> | undefined,
        );
        return {
          content: [{ type: 'text', text: `# /admin/installation-data-attributes-count\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_admin_search_download',
    {
      title: 'Admin — bulk search download (admin-only)',
      description:
        '⚠️ ADMIN-ONLY. Bulk export of search results. Endpoint: GET /admin/search-download.',
      inputSchema: {
        query: passthroughQuerySchema,
      },
      outputSchema: outputSchemas.success,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const data = await auth.client.get<GenericResponse>('/admin/search-download', query as Record<string, QueryValue | undefined> | undefined);
        return {
          content: [{ type: 'text', text: `# /admin/search-download\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_list_firmwares',
    {
      title: 'List firmware versions',
      description:
        'Catalog of Victron firmware versions for a given feed channel + VictronConnect client version. Both params are required by VRM. `feedChannel` values seen in the wild: `release`, `candidate`, `testing`, `officialrelease`. Pass the current VictronConnect version from the client making the request — do not hardcode it. Endpoint: GET /firmwares.',
      inputSchema: {
        feedChannel: z
          .string()
          .min(1)
          .max(64)
          .describe('Required. Feed channel name (e.g. "release", "candidate", "testing", "officialrelease").'),
        victronConnectVersion: z
          .string()
          .min(1)
          .max(32)
          .regex(/^\d+\.\d+(\.\d+)?(-[\w.]+)?$/)
          .describe('Required. VictronConnect client version string (semver: MAJOR.MINOR[.PATCH][-tag]). Supply the current running version; do not hardcode.'),
        query: passthroughQuerySchema,
      },
      outputSchema: outputSchemas.success,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ feedChannel, victronConnectVersion, query }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const q: Record<string, QueryValue | undefined> = { feedChannel, victronConnectVersion };
        if (query) {
          for (const [k, v] of Object.entries(query)) {
            q[k] = v as QueryValue;
          }
        }
        const data = await auth.client.get<GenericResponse>('/firmwares', q);
        return {
          content: [{ type: 'text', text: `# /firmwares (feedChannel=${feedChannel}, victronConnectVersion=${victronConnectVersion})\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_add_system',
    {
      title: 'Register a new system (admin-only)',
      description:
        '⚠️ ADMIN-ONLY. Register a new system in VRM. DESTRUCTIVE: creates persistent state. Endpoint: POST /systems/add-system.',
      inputSchema: {
        body: z
          .record(z.string(), z.unknown())
          .describe('Body object for the new system. Refer to VRM docs for required fields.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ body, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_add_system', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const data = await auth.client.post<GenericResponse>('/systems/add-system', body);
        return {
          content: [{ type: 'text', text: `# /systems/add-system\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_installation_overview_download',
    {
      title: 'Bulk installation-overview download (binary)',
      description:
        'Bulk export of installation overviews. Returns a binary payload (typically a ZIP archive) as base64. Despite the POST verb this is a read (takes filter body). Endpoint: POST /installation-overview-download.',
      inputSchema: {
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Filter body for the export.'),
      },
      outputSchema: outputSchemas.download,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ body }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        const dl = await auth.client.postDownload('/installation-overview-download', body ?? {});
        const lines = [
          '# /installation-overview-download',
          '',
          `- **Content-Type**: \`${dl.contentType}\``,
          `- **Size**: ${dl.bytes} bytes`,
          '- **Encoding**: base64 (see structuredContent.base64)',
          '',
          'Decode the base64 payload in `structuredContent.base64` to access the binary export.',
        ];
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { ...dl } as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
