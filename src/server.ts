import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerInstallationsTools } from './tools/installations.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'victron-vrm-mcp',
    version,
  });

  registerInstallationsTools(server);

  return server;
}
