/**
 * MCP Conductor Server - Full Access for Orchestrator
 *
 * All rudder commands exposed as MCP tools.
 * Uses shared tool definitions from mcp-tools-manager.
 *
 * Design: AI-first, JSON responses, auto-discoverable.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseMcpCliArgs,
  setProjectRoot,
  setLogFile,
  log,
  SocketTransport,
  createSocketServer,
  createTcpServer,
} from '../managers/mcp-manager.js';
import {
  getConductorTools,
  handleConductorTool,
} from '../managers/mcp-tools-manager/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI args
const cliArgs = parseMcpCliArgs(path.resolve(__dirname, '../..'));
setProjectRoot(cliArgs.projectRoot);

if (cliArgs.socketPath) {
  setLogFile(cliArgs.socketPath.replace(/\.sock$/, '.log'));
}

// Get tools from manager
const TOOLS = getConductorTools();

// =============================================================================
// Server Setup
// =============================================================================

let connectionCounter = 0;

function createConnectionHandler(mode: 'tcp' | 'unix') {
  return async (socket: net.Socket) => {
    const connId = ++connectionCounter;
    log('INFO', `Client #${connId} connected`, { mode });

    const clientServer = new Server(
      { name: 'rudder-mcp-conductor', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    clientServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    clientServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: callArgs } = request.params;
      const result = await handleConductorTool(name, callArgs as Record<string, any>);
      return result as any;
    });

    socket.on('close', () => log('INFO', `Client #${connId} disconnected`));

    const transport = new SocketTransport(socket) as any;
    await clientServer.connect(transport);
  };
}

async function main() {
  const { port, socketPath, projectRoot } = cliArgs;

  if (port) {
    log('INFO', 'MCP conductor starting', { mode: 'tcp', port, projectRoot });
    createTcpServer(port, createConnectionHandler('tcp'));
  } else if (socketPath) {
    log('INFO', 'MCP conductor starting', { mode: 'unix', socket: socketPath, projectRoot });
    createSocketServer(socketPath, createConnectionHandler('unix'));
  } else {
    // Stdio mode
    const server = new Server(
      { name: 'rudder-mcp-conductor', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: callArgs } = request.params;
      const result = await handleConductorTool(name, callArgs as Record<string, any>);
      return result as any;
    });
    await server.connect(new StdioServerTransport());
  }
}

main().catch(() => process.exit(1));
