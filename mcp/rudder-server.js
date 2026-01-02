#!/usr/bin/env node
/**
 * Rudder MCP Server
 *
 * Exposes rudder CLI commands as MCP tools for sandboxed agents.
 * Agents can interact with rudder without needing filesystem write access.
 *
 * Usage:
 *   node mcp/rudder-server.js [--task-id TNNN] [--project-root /path] [--port PORT] [--socket PATH]
 *
 * Options:
 *   --task-id       Restrict operations to a specific task (for agent isolation)
 *   --project-root  Project root path
 *   --port          Listen on TCP port instead of stdio (for external MCP)
 *   --socket        Listen on Unix socket instead of stdio (for external MCP)
 *
 * When --port or --socket is used, the server runs outside the sandbox and agents
 * connect via socat bridge.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line args
const args = process.argv.slice(2);
let taskId = null;
let projectRoot = path.resolve(__dirname, '..');
let port = null;
let socketPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--task-id' && args[i + 1]) {
    taskId = args[++i];
  } else if (args[i] === '--project-root' && args[i + 1]) {
    projectRoot = args[++i];
  } else if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[++i], 10);
  } else if (args[i] === '--socket' && args[i + 1]) {
    socketPath = args[++i];
  }
}

const RUDDER_BIN = path.join(projectRoot, 'bin', 'rudder');

/**
 * Execute rudder command and return result
 */
function runRudder(command, options = {}) {
  const { allowedTaskId, json = false } = options;

  try {
    const fullCmd = `${RUDDER_BIN} ${command}${json ? ' --json' : ''}`;
    const result = execSync(fullCmd, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SAILING_PROJECT: projectRoot
      }
    });
    return { success: true, output: result.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr?.toString() || ''
    };
  }
}

/**
 * Validate task ID matches allowed task (if restriction is set)
 */
function validateTaskAccess(requestedTaskId) {
  if (!taskId) return true; // No restriction
  return requestedTaskId === taskId;
}

// Define available tools
const TOOLS = [
  {
    name: 'task_log',
    description: 'Log a message for a task. Use during work to record progress, tips, warnings, or errors.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' },
        message: { type: 'string', description: 'Log message' },
        level: {
          type: 'string',
          enum: ['info', 'tip', 'warn', 'error', 'critical'],
          description: 'Log level (default: info)'
        },
        file: { type: 'string', description: 'Related file path (optional)' },
        command: { type: 'string', description: 'Related command (optional)' }
      },
      required: ['task_id', 'message']
    }
  },
  {
    name: 'task_show',
    description: 'Show task details including metadata, description, and deliverables.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_show_memory',
    description: 'Show memory/context for a task (tips and learnings from previous work on the epic).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'assign_claim',
    description: 'Claim a task assignment. Returns full context for the agent to work on the task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'assign_release',
    description: 'Release a task assignment when work is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'deps_show',
    description: 'Show dependencies for a task (what blocks it and what it blocks).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_targets',
    description: 'Show target versions for a task (components to bump when task is done).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'context_load',
    description: 'Load context for a specific operation (agent bootstrap).',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Operation name (e.g., task-start)' },
        role: {
          type: 'string',
          enum: ['agent', 'skill'],
          description: 'Context role (default: agent)'
        }
      },
      required: ['operation']
    }
  },
  {
    name: 'versions',
    description: 'Show current component versions.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'status',
    description: 'Show project status overview (PRDs, epics, tasks).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'cli',
    description: 'Execute any rudder CLI command. Use exactly as documented (without "rudder" prefix). Examples: "task:log T042 \\"msg\\" --info", "deps:show T042", "artifact:edit T042 --section Notes --append \\"text\\""',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Rudder command (without "rudder" prefix). Example: task:log T042 "message" --info'
        }
      },
      required: ['command']
    }
  }
];

// Create server
const server = new Server(
  {
    name: 'rudder-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools (stdio mode)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls (stdio mode) - uses shared handleToolCall()
server.setRequestHandler(CallToolRequestSchema, handleToolCall);

/**
 * Create a transport adapter for TCP socket
 * MCP uses JSON-RPC over newline-delimited JSON
 */
class SocketTransport {
  constructor(socket) {
    this.socket = socket;
    this._onMessage = null;
    this._onClose = null;
    this._onError = null;
    this._buffer = '';

    socket.on('data', (data) => {
      this._buffer += data.toString();
      this._processBuffer();
    });

    socket.on('close', () => {
      if (this._onClose) this._onClose();
    });

    socket.on('error', (err) => {
      if (this._onError) this._onError(err);
    });
  }

  _processBuffer() {
    // MCP uses newline-delimited JSON
    let newlineIndex;
    while ((newlineIndex = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, newlineIndex);
      this._buffer = this._buffer.slice(newlineIndex + 1);

      if (line.trim() && this._onMessage) {
        try {
          const message = JSON.parse(line);
          this._onMessage(message);
        } catch (e) {
          console.error('Failed to parse MCP message:', e);
        }
      }
    }
  }

  set onmessage(handler) {
    this._onMessage = handler;
  }

  set onclose(handler) {
    this._onClose = handler;
  }

  set onerror(handler) {
    this._onError = handler;
  }

  async start() {
    // Nothing to do for socket transport
  }

  async send(message) {
    const json = JSON.stringify(message);
    this.socket.write(json + '\n');
  }

  async close() {
    this.socket.end();
  }
}

/**
 * Create connection handler for TCP/Unix socket servers
 */
function createConnectionHandler(mode) {
  return async (socket) => {
    const clientInfo = mode === 'tcp'
      ? `${socket.remoteAddress}:${socket.remotePort}`
      : 'unix socket';
    log(`Client connected from ${clientInfo}`);

    // Create a new server instance for this connection
    const clientServer = new Server(
      { name: 'rudder-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    // Copy handlers to client server
    clientServer.setRequestHandler(ListToolsRequestSchema, async () => {
      log('tools/list requested');
      return { tools: TOOLS };
    });

    clientServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      return handleToolCall(request);
    });

    const transport = new SocketTransport(socket);
    await clientServer.connect(transport);

    socket.on('close', () => {
      log('Client disconnected');
    });
  };
}

// Start server
async function main() {
  if (port) {
    // TCP mode: listen on port
    const tcpServer = net.createServer(createConnectionHandler('tcp'));

    tcpServer.listen(port, '127.0.0.1', () => {
      console.error(`Rudder MCP Server started (TCP mode)`);
      console.error(`  Listening on: 127.0.0.1:${port}`);
      if (taskId) {
        console.error(`  Restricted to task: ${taskId}`);
      }
      console.error(`  Project root: ${projectRoot}`);
      // Output port for parent process to read
      console.log(port);
    });

  } else if (socketPath) {
    // Unix socket mode: listen on socket file
    // Remove old socket file if exists
    try {
      fs.unlinkSync(socketPath);
    } catch (e) {
      // Ignore if doesn't exist
    }

    // PID file in same directory as socket
    const pidFile = socketPath.replace(/\.sock$/, '.pid');

    const unixServer = net.createServer(createConnectionHandler('unix'));

    unixServer.listen(socketPath, () => {
      // Write PID file
      fs.writeFileSync(pidFile, String(process.pid));

      console.error(`Rudder MCP Server started (Unix socket mode)`);
      console.error(`  Listening on: ${socketPath}`);
      console.error(`  PID file: ${pidFile}`);
      if (taskId) {
        console.error(`  Restricted to task: ${taskId}`);
      }
      console.error(`  Project root: ${projectRoot}`);
      // Output socket path for parent process to read
      console.log(socketPath);
    });

    // Cleanup socket and PID on exit
    process.on('SIGINT', () => {
      try { fs.unlinkSync(socketPath); } catch (e) {}
      try { fs.unlinkSync(pidFile); } catch (e) {}
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      try { fs.unlinkSync(socketPath); } catch (e) {}
      try { fs.unlinkSync(pidFile); } catch (e) {}
      process.exit(0);
    });

  } else {
    // Stdio mode (original behavior)
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`Rudder MCP Server started`);
    if (taskId) {
      console.error(`  Restricted to task: ${taskId}`);
    }
    console.error(`  Project root: ${projectRoot}`);
  }
}

/**
 * Log with timestamp
 */
function log(msg) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ${msg}`);
}

/**
 * Handle tool call (extracted for reuse in TCP mode)
 */
async function handleToolCall(request) {
  const { name, arguments: args } = request.params;

  log(`Tool call: ${name} ${JSON.stringify(args)}`);

  // Validate task access for task-specific operations
  const taskOps = ['task_log', 'task_show', 'task_show_memory', 'assign_claim', 'assign_release', 'deps_show', 'task_targets'];
  if (taskOps.includes(name) && args.task_id) {
    if (!validateTaskAccess(args.task_id)) {
      log(`Access denied for task ${args.task_id}`);
      return {
        content: [{
          type: 'text',
          text: `Access denied: This agent can only access task ${taskId}`
        }],
        isError: true
      };
    }
  }

  let result;

  switch (name) {
    case 'task_log': {
      let cmd = `task:log ${args.task_id} "${args.message.replace(/"/g, '\\"')}"`;
      if (args.level) cmd += ` --${args.level}`;
      if (args.file) cmd += ` -f "${args.file}"`;
      if (args.command) cmd += ` -c "${args.command}"`;
      result = runRudder(cmd);
      break;
    }

    case 'task_show':
      result = runRudder(`task:show ${args.task_id}`);
      break;

    case 'task_show_memory':
      result = runRudder(`task:show-memory ${args.task_id}`);
      break;

    case 'assign_claim':
      result = runRudder(`assign:claim ${args.task_id}`);
      break;

    case 'assign_release':
      result = runRudder(`assign:release ${args.task_id}`);
      break;

    case 'deps_show':
      result = runRudder(`deps:show ${args.task_id}`);
      break;

    case 'task_targets':
      result = runRudder(`task:targets ${args.task_id}`);
      break;

    case 'context_load': {
      const role = args.role || 'agent';
      result = runRudder(`context:load ${args.operation} --role ${role}`);
      break;
    }

    case 'versions':
      result = runRudder('versions');
      break;

    case 'status':
      result = runRudder('status');
      break;

    case 'cli': {
      // Generic CLI passthrough - validate task access if restricted
      const cmd = args.command;

      // Extract task ID from command if present (T followed by digits)
      const taskMatch = cmd.match(/\bT(\d{3,})\b/i);
      if (taskMatch && taskId) {
        const cmdTaskId = `T${taskMatch[1]}`.toUpperCase();
        if (!validateTaskAccess(cmdTaskId)) {
          return {
            content: [{
              type: 'text',
              text: `Access denied: This agent can only access task ${taskId}`
            }],
            isError: true
          };
        }
      }

      result = runRudder(cmd);
      break;
    }

    default:
      log(`Unknown tool: ${name}`);
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true
      };
  }

  if (result.success) {
    log(`Tool ${name} succeeded (${result.output.length} chars)`);
    return {
      content: [{ type: 'text', text: result.output }]
    };
  } else {
    log(`Tool ${name} failed: ${result.error}`);
    return {
      content: [{
        type: 'text',
        text: `Error: ${result.error}\n${result.stderr}`
      }],
      isError: true
    };
  }
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
