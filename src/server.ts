import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerInstallationsTools } from './tools/installations.js';
import { registerAlarmsTools } from './tools/alarms.js';
import { registerUsersTools } from './tools/users.js';
import { registerTagsTools } from './tools/tags.js';
import { registerDataAttributesTools } from './tools/data_attributes.js';
import { registerWidgetsTools } from './tools/widgets.js';
import { registerAdminTools } from './tools/admin.js';
import { registerAccessTokensTools } from './tools/accesstokens.js';
import { registerSiteWritesTools } from './tools/site_writes.js';
import { registerReadsTools } from './tools/reads.js';
import { registerUserOpsTools } from './tools/user_ops.js';
import { registerAdminOpsTools } from './tools/admin_ops.js';
import { registerAuthTools } from './tools/auth.js';
import { registerCustomWidgetTools } from './tools/custom_widget.js';
import { registerCapabilitiesTools } from './tools/capabilities.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'victron-vrm-mcp',
    version,
  });

  registerInstallationsTools(server);
  registerAlarmsTools(server);
  registerUsersTools(server);
  registerTagsTools(server);
  registerDataAttributesTools(server);
  registerWidgetsTools(server);
  registerAdminTools(server);
  registerAccessTokensTools(server);
  registerSiteWritesTools(server);
  registerReadsTools(server);
  registerUserOpsTools(server);
  registerAdminOpsTools(server);
  registerAuthTools(server);
  registerCustomWidgetTools(server);
  registerCapabilitiesTools(server);

  return server;
}
