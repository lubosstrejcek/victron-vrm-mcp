import { z } from 'zod';

/**
 * Shared outputSchema shapes used across tool definitions. MCP SDK accepts
 * either a zod shape object (`ZodRawShapeCompat`) or a raw JSON Schema — we
 * use zod shapes so the SDK converts them to JSON Schema on the wire.
 *
 * Every VRM response includes `success: boolean`. Per-tool schemas extend
 * that with the fields the caller is most likely to key off. Unknown fields
 * flow through in `structuredContent` without strict validation.
 */
export const outputSchemas = {
  success: {
    success: z.boolean(),
  },

  successWithIdSite: {
    success: z.boolean(),
    idSite: z.union([z.number(), z.string()]).optional(),
  },

  successWithRecords: {
    success: z.boolean(),
    records: z.array(z.unknown()).optional(),
  },

  installations: {
    success: z.boolean(),
    records: z
      .array(
        z.object({
          idSite: z.number(),
          name: z.string(),
          identifier: z.string(),
          accessLevel: z.number(),
          owner: z.boolean(),
          is_admin: z.boolean(),
          idUser: z.number(),
          pvMax: z.number().optional(),
          timezone: z.string().optional(),
        }).passthrough(),
      )
      .optional(),
    user: z
      .object({
        id: z.number(),
        name: z.string().optional(),
        email: z.string().optional(),
        country: z.string().optional(),
        accessLevel: z.number().optional(),
      })
      .passthrough()
      .optional(),
  },

  alarms: {
    success: z.boolean(),
    rateLimited: z.boolean().optional(),
    alarms: z.array(z.unknown()).optional(),
    devices: z.array(z.unknown()).optional(),
    users: z.array(z.unknown()).optional(),
    attributes: z.array(z.unknown()).optional(),
  },

  tags: {
    success: z.boolean(),
    tags: z.record(z.string(), z.array(z.string())).optional(),
  },

  siteUsers: {
    success: z.boolean(),
    users: z.array(z.unknown()).optional(),
    invites: z.array(z.unknown()).optional(),
    pending: z.array(z.unknown()).optional(),
    userGroups: z.array(z.unknown()).optional(),
    siteGroups: z.array(z.unknown()).optional(),
  },

  widget: {
    success: z.boolean(),
    records: z.unknown().optional(),
  },

  widgetGraph: {
    success: z.boolean(),
    records: z
      .object({
        data: z.record(z.string(), z.array(z.array(z.number()))).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  },

  download: {
    contentType: z.string(),
    bytes: z.number(),
    base64: z.string(),
  },

  accessTokenCreate: {
    success: z.boolean(),
    token: z.string().optional(),
    idAccessToken: z.number().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  },

  accessTokenDelete: {
    success: z.boolean(),
    data: z
      .object({
        removed: z.number().optional(),
      })
      .passthrough()
      .optional(),
  },

  forecastsLastReset: {
    success: z.boolean(),
    last_reset: z.number().optional(),
  },

  dataAttributeSearch: {
    success: z.boolean(),
    records: z.array(z.unknown()).optional(),
    attributes: z.array(z.unknown()).optional(),
  },

  siteIdLookup: {
    success: z.boolean(),
    records: z
      .object({
        site_id: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
  },

  authLogin: {
    token: z.string().optional(),
    idUser: z.number().optional(),
    success: z.boolean().optional(),
  },
} as const;
