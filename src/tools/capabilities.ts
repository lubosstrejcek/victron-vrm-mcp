import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { READ_ONLY_ANNOTATIONS, formatVrmError, resolveAuth } from './helpers.js';
import { outputSchemas } from './output_schemas.js';
import { VrmApiError } from '../vrm/client.js';
import type { VrmUserResponse } from '../vrm/types.js';

interface CapabilitiesResult {
  user: { id: number; name?: string; email?: string; country?: string; accessLevel?: number };
  /** True if the token can call admin/* endpoints (probed via /admin/devices?count=1). */
  isAdmin: boolean;
  /** True if /users/me succeeded — i.e. the token is valid against VRM. */
  tokenValid: boolean;
}

export function registerCapabilitiesTools(server: McpServer): void {
  server.registerTool(
    'vrm_capabilities',
    {
      title: 'Probe VRM access level for the current token',
      description:
        'Reports the authenticated user (id, name, email) and probes whether the current token can reach admin endpoints. Use this BEFORE attempting any admin / system / firmware tool to avoid avoidable 403s. Probes /users/me + /admin/devices (count=1).',
      inputSchema: {
        probeAdmin: z
          .boolean()
          .optional()
          .describe('Whether to probe an admin endpoint to confirm admin-tier access. Default: true. Skip with false to avoid the extra round-trip if you only need the user identity.'),
      },
      outputSchema: {
        ...outputSchemas.success,
        user: z
          .object({
            id: z.number(),
            name: z.string().optional(),
            email: z.string().optional(),
            country: z.string().optional(),
            accessLevel: z.number().optional(),
          })
          .passthrough(),
        isAdmin: z.boolean(),
        tokenValid: z.boolean(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ probeAdmin }, extra) => {
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      const result: CapabilitiesResult = {
        user: { id: 0 },
        isAdmin: false,
        tokenValid: false,
      };

      try {
        const me = await auth.client.get<VrmUserResponse>('/users/me');
        result.user = me.user;
        result.tokenValid = me.success === true;
      } catch (error) {
        // /users/me failed — token is invalid or VRM unreachable. Surface cleanly.
        return formatVrmError(error, { hint: ' /users/me failed; the token may be invalid or expired.' });
      }

      if (probeAdmin !== false) {
        try {
          // Probe with count=1 to keep the response tiny if it succeeds.
          await auth.client.get<{ success: boolean }>('/admin/devices', { count: 1 });
          result.isAdmin = true;
        } catch (error) {
          if (error instanceof VrmApiError && error.status === 403) {
            result.isAdmin = false; // expected for non-admin tokens
          } else {
            // Any other error (rate-limit, 500, network) — surface but keep partial result.
            const msg = error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text',
                  text: `# VRM capabilities for user ${result.user.id}\n\n- tokenValid: true\n- admin probe failed: ${msg}\n\nPartial result returned in structuredContent.`,
                },
              ],
              structuredContent: { ...result, success: true } as unknown as Record<string, unknown>,
            };
          }
        }
      }

      const adminBlurb = result.isAdmin
        ? 'Token has admin-tier access; admin/system/firmware tools should work.'
        : probeAdmin === false
          ? 'Admin probe skipped.'
          : 'Token does NOT have admin access. Calls to vrm_admin_*, vrm_add_system, vrm_list_firmwares will return 403.';

      const lines = [
        `# VRM capabilities`,
        '',
        `- **User**: ${result.user.name ?? '(unknown)'} (${result.user.email ?? 'no email'}) — id ${result.user.id}`,
        `- **Country**: ${result.user.country ?? '(unknown)'}`,
        `- **Account access level**: ${result.user.accessLevel ?? '(unknown)'}`,
        `- **Token valid**: ${result.tokenValid}`,
        `- **Admin access**: ${result.isAdmin}`,
        '',
        adminBlurb,
      ];

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { ...result, success: true } as unknown as Record<string, unknown>,
      };
    },
  );
}
