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

interface VrmAlarmsResponse {
  success: boolean;
  rateLimited?: boolean;
  alarms?: unknown[];
  devices?: unknown[];
  users?: unknown[];
  attributes?: unknown[];
}

export function registerAlarmsTools(server: McpServer): void {
  server.registerTool(
    'vrm_get_alarms',
    {
      title: 'Get VRM alarms for a site',
      description:
        'Get all alarms configured for a VRM installation, plus the devices, users (who receive notifications), and attributes that can be used to define new alarms. Read-only. Endpoint: GET /installations/{idSite}/alarms.',
      inputSchema: {
        idSite: idSiteSchema,
      },
      outputSchema: outputSchemas.alarms,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idSite }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }

      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.get<VrmAlarmsResponse>(sitePath(idSite, 'alarms'));

        const alarms = data.alarms ?? [];
        const devices = data.devices ?? [];
        const users = data.users ?? [];
        const attributes = data.attributes ?? [];

        const lines: string[] = [
          `# Alarms for site ${idSite}`,
          '',
          `- **Configured alarms**: ${alarms.length}`,
          `- **Devices**: ${devices.length}`,
          `- **Notification users**: ${users.length}`,
          `- **Available data attributes**: ${attributes.length}`,
          '',
        ];

        if (data.rateLimited) {
          lines.push('> ⚠️ VRM reported the response was rate-limited; some data may be missing.');
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
    'vrm_clear_alarm',
    {
      title: 'Clear an alarm on an installation',
      description:
        'Acknowledge and clear an active alarm on a VRM installation. DESTRUCTIVE: modifies the Event Log. Endpoint: POST /installations/{idSite}/clear-alarm.',
      inputSchema: {
        idSite: idSiteSchema,
        alarmId: z.number().int().positive().describe('The alarm ID (idDataAttribute) to clear.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.successWithIdSite,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, alarmId, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_clear_alarm', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<{ success: boolean; idSite?: string }>(
          sitePath(idSite, 'clear-alarm'),
          { alarmId },
        );
        return {
          content: [{ type: 'text', text: `Cleared alarm ${alarmId} on site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_add_alarm',
    {
      title: 'Add an alarm configuration',
      description:
        'Create a new alarm on an installation. Two variants: float (numeric threshold, PascalCase field names) and enum (set membership, camelCase names). DESTRUCTIVE. Endpoint: POST /installations/{idSite}/alarms.',
      inputSchema: {
        idSite: idSiteSchema,
        alarm: z
          .record(z.string(), z.unknown())
          .describe('Alarm body. Float example: { idDataAttribute, instance, AlarmEnabled, NotifyAfterSeconds, highAlarm, highAlarmHysteresis, lowAlarm, lowAlarmHysteresis }. Enum example: { idDataAttribute, instance, alarmEnabled, notifyAfterSeconds, enumValues: [...] }.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, alarm, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_add_alarm', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<{ success: boolean }>(sitePath(idSite, 'alarms'), alarm);
        return {
          content: [{ type: 'text', text: `# Alarm added on site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_edit_alarm',
    {
      title: 'Edit an alarm configuration',
      description:
        'Update an existing alarm on an installation. Same body shape as vrm_add_alarm (float or enum variant). DESTRUCTIVE. Endpoint: PUT /installations/{idSite}/alarms.',
      inputSchema: {
        idSite: idSiteSchema,
        alarm: z
          .record(z.string(), z.unknown())
          .describe('Alarm body. See vrm_add_alarm for the shape (float vs enum variants).'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, alarm, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_edit_alarm', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.put<{ success: boolean }>(sitePath(idSite, 'alarms'), alarm);
        return {
          content: [{ type: 'text', text: `# Alarm edited on site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_delete_alarm',
    {
      title: 'Delete an alarm configuration',
      description:
        'Remove an alarm definition from an installation (not just acknowledge — actually deletes it). DESTRUCTIVE. Endpoint: DELETE /installations/{idSite}/alarms.',
      inputSchema: {
        idSite: idSiteSchema,
        idDataAttribute: z.number().int().positive().describe('Data attribute ID bound to the alarm.'),
        instance: z.number().int().min(0).max(255).describe('Device instance.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.successWithIdSite,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, idDataAttribute, instance, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_delete_alarm', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.delete<{ success: boolean; idSite?: number }>(
          sitePath(idSite, 'alarms'),
          { idDataAttribute, instance },
        );
        return {
          content: [{ type: 'text', text: `Deleted alarm (idDataAttribute=${idDataAttribute}, instance=${instance}) on site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
