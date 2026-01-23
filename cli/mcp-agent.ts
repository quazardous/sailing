/**
 * Rudder MCP Server - For Sandbox Agents (Limited)
 *
 * Limited toolset for sandboxed agents:
 * - task_log, task_show, task_show_memory
 * - deps_show, task_targets
 * - context_load, versions, status
 * - cli (passthrough)
 *
 * Uses shared tool definitions from mcp-tools-manager.
 * Design: AI-first, JSON responses.
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
} from './managers/mcp-manager.js';
import {
  getAgentTools,
  handleAgentTool,
} from './managers/mcp-tools-manager/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI args
const cliArgs = parseMcpCliArgs(path.resolve(__dirname, '..'));
setProjectRoot(cliArgs.projectRoot);

// Set log file for socket mode
if (cliArgs.socketPath) {
  setLogFile(cliArgs.socketPath.replace(/\.sock$/, '.log'));
}

// Get tools from manager
const TOOLS = getAgentTools();

// =============================================================================
// Server Setup
// =============================================================================

let connectionCounter = 0;

function createConnectionHandler(mode: 'tcp' | 'unix') {
  return async (socket: net.Socket) => {
    const connId = ++connectionCounter;
    let clientTaskId: string | null = null;

    log('INFO', `Client #${connId} connected`, { mode });

    const clientServer = new Server(
      { name: 'rudder-mcp-agent', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    clientServer.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    clientServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: callArgs } = request.params;
      const args = callArgs as Record<string, any>;

      // Track task ID from first call
      if (!clientTaskId && args.task_id) clientTaskId = args.task_id;
      if (!clientTaskId && name === 'context_load' && args.operation?.match(/^T\d+$/)) {
        clientTaskId = args.operation;
      }

      log('INFO', `Tool: ${name}`, { connId, taskId: clientTaskId, args });

      const result = await handleAgentTool(name, args);
      if (result.isError) log('WARN', `Error: ${name}`, { connId, taskId: clientTaskId });

      return result as any;
    });

    socket.on('close', () => log('INFO', `Client #${connId} disconnected`, { taskId: clientTaskId }));

    const transport = new SocketTransport(socket) as any;
    await clientServer.connect(transport);
  };
}

// Main
async function main() {
  const { port, socketPath, projectRoot } = cliArgs;

  if (port) {
    log('INFO', 'MCP agent server starting', { mode: 'tcp', port, projectRoot });
    createTcpServer(port, createConnectionHandler('tcp'));
  } else if (socketPath) {
    log('INFO', 'MCP agent server starting', { mode: 'unix', socket: socketPath, projectRoot });
    createSocketServer(socketPath, createConnectionHandler('unix'));
  } else {
    // Stdio mode
    const server = new Server(
      { name: 'rudder-mcp-agent', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: callArgs } = request.params;
      const result = await handleAgentTool(name, callArgs as Record<string, any>);
      return result as any;
    });
    await server.connect(new StdioServerTransport());
  }
}

main().catch(() => process.exit(1));
