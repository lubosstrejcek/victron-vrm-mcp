/**
 * Canonical tool catalog — must match every MCP tool the server registers.
 * Update this list whenever a tool is added or removed. Shared by
 * tools.coverage.test.ts (registration/shape checks over the wire) and
 * handlers.test.ts (in-process handler execution against a stubbed VRM).
 */

export type Args = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  destructive: boolean;
  /** Minimal args that pass zod validation but omit `confirm` (so destructive tools hit the runtime refusal). */
  minimalArgs: Args;
}

export const TOOLS: ToolSpec[] = [
  // Auth (3)
  { name: 'vrm_auth_login_as_demo', destructive: false, minimalArgs: {} },
  { name: 'vrm_auth_login', destructive: true, minimalArgs: { username: 'a@b.co', password: 'p' } },
  { name: 'vrm_auth_logout', destructive: true, minimalArgs: {} },

  // Users (4)
  { name: 'vrm_list_installations', destructive: false, minimalArgs: {} },
  { name: 'vrm_search_sites', destructive: false, minimalArgs: { query: 'x' } },
  { name: 'vrm_get_site_id', destructive: false, minimalArgs: { installation_identifier: 'abcd' } },
  { name: 'vrm_list_invites', destructive: false, minimalArgs: {} },
  { name: 'vrm_add_site', destructive: true, minimalArgs: { installation_identifier: 'abcd' } },

  // Access tokens (2)
  { name: 'vrm_create_access_token', destructive: true, minimalArgs: { idUser: 1, name: 't' } },
  { name: 'vrm_delete_access_token', destructive: true, minimalArgs: { idUser: 1, idAccessToken: 1 } },

  // Installation reads (8)
  { name: 'vrm_get_system_overview', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_diagnostics', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_stats', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_overallstats', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_alarms', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_site_users', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_tags', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_dynamic_ess_settings', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_gps_download', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_get_forecasts_last_reset', destructive: false, minimalArgs: { idSite: 1 } },

  // Installation writes (16)
  { name: 'vrm_clear_alarm', destructive: true, minimalArgs: { idSite: 1, alarmId: 1 } },
  { name: 'vrm_add_alarm', destructive: true, minimalArgs: { idSite: 1, alarm: { idDataAttribute: 1 } } },
  { name: 'vrm_edit_alarm', destructive: true, minimalArgs: { idSite: 1, alarm: { idDataAttribute: 1 } } },
  { name: 'vrm_delete_alarm', destructive: true, minimalArgs: { idSite: 1, idDataAttribute: 1, instance: 0 } },
  { name: 'vrm_set_favorite', destructive: true, minimalArgs: { idSite: 1, favorite: 1 } },
  { name: 'vrm_tags_add', destructive: true, minimalArgs: { idSite: 1, tag: 'x', source: 'user' } },
  { name: 'vrm_tags_remove', destructive: true, minimalArgs: { idSite: 1, tag: 'x', source: 'user' } },
  { name: 'vrm_invite_user', destructive: true, minimalArgs: { idSite: 1, name: 'a', email: 'a@b.co', accessLevel: 0 } },
  { name: 'vrm_unlink_user', destructive: true, minimalArgs: { idSite: 1, idUser: 1 } },
  { name: 'vrm_unlink_installation', destructive: true, minimalArgs: { idSite: 1 } },
  { name: 'vrm_set_user_rights', destructive: true, minimalArgs: { idSite: 1, idUser: [1], accessLevel: [0] } },
  { name: 'vrm_set_invite_rights', destructive: true, minimalArgs: { idSite: 1, email: ['a@b.co'], accessLevel: [0] } },
  { name: 'vrm_link_user_groups', destructive: true, minimalArgs: { idSite: 1, userGroups: [{ idUserGroup: 1, accessLevel: 0 }] } },
  { name: 'vrm_set_user_group_access_level', destructive: true, minimalArgs: { idSite: 1, idUserGroup: 1, accessLevel: 0 } },
  { name: 'vrm_reset_forecasts', destructive: true, minimalArgs: { idSite: 1, resetType: 0 } },
  { name: 'vrm_set_site_settings', destructive: true, minimalArgs: { idSite: 1, notes: 'x' } },
  { name: 'vrm_set_dynamic_ess_settings', destructive: true, minimalArgs: { idSite: 1, settings: {} } },

  // Widgets (3)
  { name: 'vrm_widget_graph', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_widget', destructive: false, minimalArgs: { idSite: 1, widget: 'BatterySummary' } },
  { name: 'vrm_widget_generator_state', destructive: false, minimalArgs: { idSite: 1 } },

  // Custom widgets (4)
  { name: 'vrm_get_custom_widgets', destructive: false, minimalArgs: { idSite: 1 } },
  { name: 'vrm_create_custom_widget', destructive: true, minimalArgs: { idSite: 1, widget: { name: 'x' } } },
  { name: 'vrm_patch_custom_widget', destructive: true, minimalArgs: { idSite: 1, widget: { id: 1 } } },
  { name: 'vrm_delete_custom_widget', destructive: true, minimalArgs: { idSite: 1 } },

  // Admin / collection (7)
  { name: 'vrm_find_by_data_attributes', destructive: false, minimalArgs: { query: 'bs' } },
  { name: 'vrm_list_data_attributes', destructive: false, minimalArgs: {} },
  { name: 'vrm_admin_list_devices', destructive: false, minimalArgs: {} },
  { name: 'vrm_admin_data_attributes_count', destructive: false, minimalArgs: {} },
  { name: 'vrm_admin_search_download', destructive: false, minimalArgs: {} },
  { name: 'vrm_list_firmwares', destructive: false, minimalArgs: { feedChannel: 'release', victronConnectVersion: '6.0.0' } },
  { name: 'vrm_installation_overview_download', destructive: false, minimalArgs: {} },
  { name: 'vrm_add_system', destructive: true, minimalArgs: { description: 'Test', favorite: 0, devices: [{ serial: 'H123', productId: '0xC00A', instance: 0 }] } },

  // Capabilities probe (1)
  { name: 'vrm_capabilities', destructive: false, minimalArgs: {} },
];
