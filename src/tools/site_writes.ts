import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
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

interface GenericSuccess {
  success: boolean;
  [k: string]: unknown;
}

export function registerSiteWritesTools(server: McpServer): void {
  server.registerTool(
    'vrm_set_favorite',
    {
      title: 'Mark / unmark an installation as favorite',
      description:
        'Toggle the favorite flag on a VRM installation. `favorite: 1` to mark, `0` to unmark. DESTRUCTIVE: modifies per-user site metadata. Endpoint: POST /installations/{idSite}/favorite.',
      inputSchema: {
        idSite: idSiteSchema,
        favorite: z.union([z.literal(0), z.literal(1)]).describe('1 = mark as favorite, 0 = unmark.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.successWithIdSite,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, favorite, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_set_favorite', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'favorite'), {
          favorite,
        });
        return {
          content: [{ type: 'text', text: `Favorite set to ${favorite} on site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_reset_forecasts',
    {
      title: 'Reset solar/ESS forecasts',
      description:
        'Reset the forecasting model for an installation. Future forecasts ignore data before this timestamp. DESTRUCTIVE: affects prediction quality for the site. Endpoint: POST /installations/{idSite}/reset-forecasts.',
      inputSchema: {
        idSite: idSiteSchema,
        resetType: z.number().int().min(0).max(10).describe('Reset type (check VRM docs for valid values; 0 is the common default).'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, resetType, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_reset_forecasts', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'reset-forecasts'), {
          resetType,
        });
        return {
          content: [{ type: 'text', text: `Reset forecasts on site ${idSite} (resetType=${resetType}). success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_set_dynamic_ess_settings',
    {
      title: 'Update Dynamic ESS configuration',
      description:
        'Write the Dynamic ESS configuration object for an installation. DESTRUCTIVE: changes battery/grid scheduling behavior. Body is a DynamicEssConfiguration object — refer to VRM docs for field list (scheduleEnabled, b2gEnabled, countryCode, batteryKwh, priceSchedule, etc.). Endpoint: POST /installations/{idSite}/dynamic-ess-settings.',
      inputSchema: {
        idSite: idSiteSchema,
        settings: z.record(z.string(), z.unknown()).describe('DynamicEssConfiguration object (pass-through).'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, settings, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_set_dynamic_ess_settings', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'dynamic-ess-settings'), settings);
        return {
          content: [{ type: 'text', text: `# Dynamic ESS settings updated — site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_set_site_settings',
    {
      title: 'Update site metadata / configuration',
      description:
        'Update one or more settings on a VRM installation (name, notes, geofence, alarm behavior, Node-RED restrictions, inverter-charger control, etc.). DESTRUCTIVE: changes site configuration. Endpoint: POST /installations/{idSite}/settings.',
      inputSchema: {
        idSite: idSiteSchema,
        description: z.string().max(256).optional().describe('Installation name.'),
        notes: z.string().max(4096).optional().describe('Free-form notes.'),
        phonenumber: z.string().max(64).optional().describe('Phone number.'),
        noDataAlarmTimeout: z.number().int().min(0).optional().describe('No-data alarm timeout (seconds).'),
        noDataAlarmActive: z.boolean().optional(),
        geofenceEnabled: z.boolean().optional(),
        alarmMonitoring: z.boolean().optional(),
        realtimeUpdates: z.boolean().optional(),
        restrictNodeRed: z.boolean().optional(),
        inverterChargerControl: z.boolean().optional(),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, confirm, ...settings }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_set_site_settings', extra);
      if (gate) {
        return gate;
      }
      const body = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
      if (Object.keys(body).length === 0) {
        return formatVrmError(new Error('No settings fields provided. Pass at least one of: description, notes, phonenumber, noDataAlarmTimeout, etc.'));
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'settings'), body);
        return {
          content: [{ type: 'text', text: `Updated ${Object.keys(body).length} setting(s) on site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
