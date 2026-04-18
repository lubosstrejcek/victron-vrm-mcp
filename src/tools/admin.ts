import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  WRITE_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  accessLevelSchema,
  assertSiteAllowed,
  confirmSchema,
  formatVrmError,
  idSiteSchema,
  idUserSchema,
  requireConfirm,
  resolveAuth,
  sitePath,
} from './helpers.js';
import { outputSchemas } from './output_schemas.js';

interface GenericSuccess {
  success: boolean;
  [k: string]: unknown;
}

export function registerAdminTools(server: McpServer): void {
  server.registerTool(
    'vrm_invite_user',
    {
      title: 'Invite user to installation',
      description:
        'Send an email invitation to grant another user access to a VRM installation. DESTRUCTIVE: modifies membership. Endpoint: POST /installations/{idSite}/invite.',
      inputSchema: {
        idSite: idSiteSchema,
        name: z.string().min(1).max(128).describe('Invitee full name.'),
        email: z.string().email().max(256).describe('Invitee email address.'),
        accessLevel: accessLevelSchema,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ idSite, name, email, accessLevel, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_invite_user', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'invite'), {
          name,
          email,
          accessLevel,
        });
        return {
          content: [{ type: 'text', text: `Invitation sent to ${email} for site ${idSite} at access level ${accessLevel}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_unlink_user',
    {
      title: 'Remove a user from an installation',
      description:
        'Remove another user from a VRM installation. Requires full-control or technician access. Cannot remove the last admin. DESTRUCTIVE. Endpoint: POST /installations/{idSite}/unlink-user.',
      inputSchema: {
        idSite: idSiteSchema,
        idUser: idUserSchema,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.successWithIdSite,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, idUser, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_unlink_user', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'unlink-user'), { idUser });
        return {
          content: [{ type: 'text', text: `Unlink request for user ${idUser} on site ${idSite} returned success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_unlink_installation',
    {
      title: 'Unlink the authenticated user from an installation',
      description:
        'Remove the CURRENT user\'s own access to an installation. DESTRUCTIVE: you will lose access to this site. Endpoint: POST /installations/{idSite}/unlink.',
      inputSchema: {
        idSite: idSiteSchema,
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.successWithIdSite,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_unlink_installation', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'unlink'));
        return {
          content: [{ type: 'text', text: `Unlinked from site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_set_user_rights',
    {
      title: 'Update access levels for users on an installation',
      description:
        'Update the access level for one or more users on a VRM installation. The idUser and accessLevel arrays must be the same length. DESTRUCTIVE: changes who can do what. Endpoint: POST /installations/{idSite}/user-rights.',
      inputSchema: {
        idSite: idSiteSchema,
        idUser: z.array(idUserSchema).min(1).max(50).describe('User IDs to update (same index as accessLevel).'),
        accessLevel: z.array(accessLevelSchema).min(1).max(50).describe('Access levels (same index as idUser).'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, idUser, accessLevel, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_set_user_rights', extra);
      if (gate) {
        return gate;
      }
      if (idUser.length !== accessLevel.length) {
        return formatVrmError(new Error('idUser and accessLevel arrays must have the same length.'));
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'user-rights'), {
          idUser,
          accessLevel,
        });
        return {
          content: [{ type: 'text', text: `User rights updated on site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_set_invite_rights',
    {
      title: 'Update access levels for pending invites',
      description:
        'Update the access level for one or more pending email invitations on a VRM installation. DESTRUCTIVE. Endpoint: POST /installations/{idSite}/invite-rights.',
      inputSchema: {
        idSite: idSiteSchema,
        email: z.array(z.string().email().max(256)).min(1).max(50).describe('Pending-invite emails (same index as accessLevel).'),
        accessLevel: z.array(accessLevelSchema).min(1).max(50).describe('Access levels (same index as email).'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, email, accessLevel, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_set_invite_rights', extra);
      if (gate) {
        return gate;
      }
      if (email.length !== accessLevel.length) {
        return formatVrmError(new Error('email and accessLevel arrays must have the same length.'));
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'invite-rights'), {
          email,
          accessLevel,
        });
        return {
          content: [{ type: 'text', text: `Invite rights updated on site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_link_user_groups',
    {
      title: 'Link user groups to an installation',
      description:
        'Link one or more user groups to a VRM installation with given access levels. DESTRUCTIVE. Endpoint: POST /installations/{idSite}/link-user-groups.',
      inputSchema: {
        idSite: idSiteSchema,
        userGroups: z
          .array(
            z.object({
              idUserGroup: z.number().int().positive(),
              accessLevel: accessLevelSchema,
            }),
          )
          .min(1)
          .max(50)
          .describe('Groups to link, each with {idUserGroup, accessLevel}.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, userGroups, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_link_user_groups', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'link-user-groups'), {
          userGroups,
        });
        return {
          content: [{ type: 'text', text: `Linked ${userGroups.length} user group(s) to site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );

  server.registerTool(
    'vrm_set_user_group_access_level',
    {
      title: 'Update or unlink a user group from an installation',
      description:
        'Set a new access level for a user group on an installation, or unlink it entirely by passing accessLevel: null. DESTRUCTIVE. Endpoint: POST /installations/{idSite}/user-group-access-level.',
      inputSchema: {
        idSite: idSiteSchema,
        idUserGroup: z.number().int().positive().describe('User group ID.'),
        accessLevel: z.union([accessLevelSchema, z.null()]).describe('New access level, or null to unlink.'),
        confirm: confirmSchema,
      },
      outputSchema: outputSchemas.success,
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ idSite, idUserGroup, accessLevel, confirm }, extra) => {
      const gate = requireConfirm(confirm, 'vrm_set_user_group_access_level', extra);
      if (gate) {
        return gate;
      }
      const auth = resolveAuth(extra);
      if (!auth.ok) {
        return auth.error;
      }
      try {
        assertSiteAllowed(idSite);
        const data = await auth.client.post<GenericSuccess>(sitePath(idSite, 'user-group-access-level'), {
          idUserGroup,
          accessLevel,
        });
        const action = accessLevel === null ? 'unlinked from' : `set to access level ${accessLevel} on`;
        return {
          content: [{ type: 'text', text: `User group ${idUserGroup} ${action} site ${idSite}. success=${data.success}.` }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return formatVrmError(error);
      }
    },
  );
}
