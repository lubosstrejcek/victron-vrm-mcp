import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  READ_ONLY_ANNOTATIONS,
  assertSiteAllowed,
  formatVrmError,
  idSiteSchema,
  resolveAuth,
  sitePath,
} from './helpers.js';
import type { QueryValue } from '../vrm/client.js';
import { outputSchemas } from './output_schemas.js';

interface GenericRead {
  success: boolean;
  [k: string]: unknown;
}

const unixTs = z.number().int().min(0).max(10_000_000_000).optional();

export function registerReadsTools(server: McpServer): void {
  server.registerTool(
    'vrm_get_system_overview',
    {
      title: 'Site system overview',
      description:
        'Retrieve the list of connected devices and their roles for an installation. Endpoint: GET /installations/{idSite}/system-overview.',
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
        const data = await auth.client.get<GenericRead>(sitePath(idSite, 'system-overview'));
        return {
          content: [{ type: 'text', text: `# System overview — site ${idSite}\n\nsuccess: ${data.success}\n\n(structured payload available)` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_get_diagnostics',
    {
      title: 'Site diagnostics',
      description:
        'Per-device diagnostic readings — last known value for every attribute on every device. Endpoint: GET /installations/{idSite}/diagnostics.',
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
        const data = await auth.client.get<GenericRead>(sitePath(idSite, 'diagnostics'));
        const records = (data as { records?: unknown[] }).records ?? [];
        return {
          content: [{ type: 'text', text: `# Diagnostics — site ${idSite}\n\nDiagnostic entries: ${Array.isArray(records) ? records.length : 'n/a'}\n` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_get_stats',
    {
      title: 'Installation stats',
      description:
        'Time-series stats for an installation. Supports 15-min / hours / days / weeks / months / years intervals with documented max-range limits. Supports `custom` datatype with attribute codes. Endpoint: GET /installations/{idSite}/stats.',
      inputSchema: {
        idSite: idSiteSchema,
        datatype: z.enum(['live_feed', 'kwh', 'custom', 'venus', 'solar_yield', 'consumption']).optional().describe('Kind of stats to return.'),
        interval: z.enum(['15mins', 'hours', 'days', 'weeks', 'months', 'years']).optional(),
        type: z.string().optional().describe('Legacy alias for interval (some endpoints use "type").'),
        start: unixTs,
        end: unixTs,
        attributeCodes: z.array(z.string().min(1).max(32)).max(20).optional().describe('Attribute codes when datatype=custom.'),
      },
      outputSchema: outputSchemas.success,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idSite, datatype, interval, type, start, end, attributeCodes }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const query: Record<string, QueryValue | undefined> = {
          datatype,
          interval,
          type,
          start,
          end,
        };
        if (attributeCodes && attributeCodes.length > 0) {
          query['attributeCodes[]'] = attributeCodes;
        }
        const data = await auth.client.get<GenericRead>(sitePath(idSite, 'stats'), query);
        return {
          content: [{ type: 'text', text: `# Stats — site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_get_overallstats',
    {
      title: 'Installation overall stats',
      description:
        'Lifetime aggregate stats for an installation. Endpoint: GET /installations/{idSite}/overallstats.',
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
        const data = await auth.client.get<GenericRead>(sitePath(idSite, 'overallstats'));
        return {
          content: [{ type: 'text', text: `# Overall stats — site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_get_dynamic_ess_settings',
    {
      title: 'Get Dynamic ESS configuration',
      description:
        'Read the current Dynamic ESS configuration for an installation. Endpoint: GET /installations/{idSite}/dynamic-ess-settings.',
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
        const data = await auth.client.get<GenericRead>(sitePath(idSite, 'dynamic-ess-settings'));
        return {
          content: [{ type: 'text', text: `# Dynamic ESS settings — site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_get_gps_download',
    {
      title: 'Download site GPS track',
      description:
        'Fetch GPS position history for an installation. Endpoint: GET /installations/{idSite}/gps-download.',
      inputSchema: {
        idSite: idSiteSchema,
        start: unixTs,
        end: unixTs,
      },
      outputSchema: outputSchemas.success,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idSite, start, end }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.get<GenericRead>(sitePath(idSite, 'gps-download'), { start, end });
        return {
          content: [{ type: 'text', text: `# GPS download — site ${idSite}\n\nsuccess: ${data.success}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_get_forecasts_last_reset',
    {
      title: 'Get last forecasts-reset timestamp',
      description:
        'Retrieve the timestamp of the last forecasts reset (or 0 if never reset). Endpoint: GET /installations/{idSite}/reset-forecasts.',
      inputSchema: { idSite: idSiteSchema },
      outputSchema: outputSchemas.forecastsLastReset,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idSite }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.get<GenericRead>(sitePath(idSite, 'reset-forecasts'));
        const ts = (data as { last_reset?: number }).last_reset ?? 0;
        const when = ts > 0 ? new Date(ts * 1000).toISOString() : '(never reset)';
        return {
          content: [{ type: 'text', text: `# Last forecasts reset — site ${idSite}\n\n- Timestamp: ${ts}\n- When: ${when}` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
