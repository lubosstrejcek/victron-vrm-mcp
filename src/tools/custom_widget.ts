import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
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

interface GenericResponse {
  success: boolean;
  [k: string]: unknown;
}

const customWidgetBody = z
  .record(z.string(), z.unknown())
  .describe('Custom-widget payload. Refer to VRM docs for required fields (typically: name, type, config).');

export function registerCustomWidgetTools(server: McpServer): void {
  server.registerTool(
    'vrm_get_custom_widgets',
    {
      title: 'List custom widgets on an installation',
      description:
        'Retrieve all custom widgets configured on a VRM installation. Endpoint: GET /installations/{idSite}/custom-widget.',
      inputSchema: { idSite: idSiteSchema },
      outputSchema: outputSchemas.success,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idSite }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.get<GenericResponse>(sitePath(idSite, 'custom-widget'));
        return {
          content: [{ type: 'text', text: `# Custom widgets — site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_create_custom_widget',
    {
      title: 'Create a custom widget',
      description:
        'Add a new custom widget to a VRM installation. DESTRUCTIVE: creates persistent state. Endpoint: POST /installations/{idSite}/custom-widget.',
      inputSchema: {
        idSite: idSiteSchema,
        widget: customWidgetBody,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ idSite, widget, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_create_custom_widget', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericResponse>(sitePath(idSite, 'custom-widget'), widget);
        return {
          content: [{ type: 'text', text: `# Custom widget created on site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_patch_custom_widget',
    {
      title: 'Update a custom widget',
      description:
        'Partially update an existing custom widget. DESTRUCTIVE. Endpoint: PATCH /installations/{idSite}/custom-widget.',
      inputSchema: {
        idSite: idSiteSchema,
        widget: customWidgetBody,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, widget, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_patch_custom_widget', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.patch<GenericResponse>(sitePath(idSite, 'custom-widget'), widget);
        return {
          content: [{ type: 'text', text: `# Custom widget patched on site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_delete_custom_widget',
    {
      title: 'Delete a custom widget',
      description:
        'Remove a custom widget from a VRM installation. DESTRUCTIVE. Endpoint: DELETE /installations/{idSite}/custom-widget.',
      inputSchema: {
        idSite: idSiteSchema,
        widget: customWidgetBody.optional().describe('Identifier body for the widget to delete (e.g. { id: ... }). Check VRM docs.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, widget, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_delete_custom_widget', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.delete<GenericResponse>(sitePath(idSite, 'custom-widget'), widget);
        return {
          content: [{ type: 'text', text: `# Custom widget deleted on site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
