/**
 * Rudder MCP Server Logic
 *
 * Exposes rudder CLI commands as MCP tools for sandboxed agents.
 * Agents can interact with rudder without needing filesystem write access.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { execaSync } from 'execa';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line args
const args = process.argv.slice(2);
let taskId: string | null = null;
let projectRoot = path.resolve(__dirname, '..');
let port: number | null = null;
let socketPath: string | null = null;

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

// Logging helper
let logFile: string | null = null;

function log(level: string, message: string, context?: Record<string, any>) {
  const timestamp = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  const line = `[${timestamp}] [${level}] ${message}${ctx}\n`;

  // Write to log file if available, otherwise stderr
  if (logFile) {
    try { fs.appendFileSync(logFile, line); } catch {}
  } else {
    process.stderr.write(line);
  }
}

interface RunResult {
  success: boolean;
  output?: string;
  error?: string;
  stderr?: string;
}

/**
 * Execute rudder command and return result
 */
function runRudder(command: string, options: { json?: boolean } = {}): RunResult {
  const { json = false } = options;

  try {
    const args = command.split(/\s+/);
    if (json) args.push('--json');
    const { stdout, stderr } = execaSync(RUDDER_BIN, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        SAILING_PROJECT: projectRoot
      }
    });
    return { success: true, output: stdout.trim(), stderr };
  } catch (error: any) {
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
function validateTaskAccess(requestedTaskId: string): boolean {
  if (!taskId) return true; // No restriction
  return requestedTaskId === taskId;
}

// Define available tools
const TOOLS: Tool[] = [
  {
    name: 'task_log',
    description: 'Log a message for a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID' },
        message: { type: 'string', description: 'Log message' },
        level: { type: 'string', enum: ['info', 'tip', 'warn', 'error', 'critical'] },
        file: { type: 'string' },
        command: { type: 'string' }
      },
      required: ['task_id', 'message']
    }
  },
  {
    name: 'task_show',
    description: 'Show task details.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    }
  },
  {
    name: 'task_show_memory',
    description: 'Show memory for a task.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    }
  },
  // assign_claim/assign_release removed: sandbox agents get complete mission file,
  // no need to claim. Release is automatic on spawn exit.
  {
    name: 'deps_show',
    description: 'Show dependencies.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    }
  },
  {
    name: 'task_targets',
    description: 'Show target versions.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    }
  },
  {
    name: 'context_load',
    description: 'Load context.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string' },
        role: { type: 'string', enum: ['agent', 'skill'] }
      },
      required: ['operation']
    }
  },
  {
    name: 'versions',
    description: 'Show versions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'status',
    description: 'Show status.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cli',
    description: 'Execute rudder command.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command']
    }
  }
];

const server = new Server(
  { name: 'rudder-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, (request) => handleToolCall(request));

class SocketTransport {
  socket: net.Socket;
  _onMessage: ((message: any) => void) | null = null;
  _onClose: (() => void) | null = null;
  _onError: ((err: Error) => void) | null = null;
  _buffer = '';

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (data) => {
      this._buffer += data.toString();
      this._processBuffer();
    });
    socket.on('close', () => { if (this._onClose) this._onClose(); });
    socket.on('error', (err) => { if (this._onError) this._onError(err); });
  }

  _processBuffer() {
    let newlineIndex;
    while ((newlineIndex = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, newlineIndex);
      this._buffer = this._buffer.slice(newlineIndex + 1);
      if (line.trim() && this._onMessage) {
        try { this._onMessage(JSON.parse(line)); } catch (e) {}
      }
    }
  }

  set onmessage(handler: (message: any) => void) { this._onMessage = handler; }
  set onclose(handler: () => void) { this._onClose = handler; }
  set onerror(handler: (err: Error) => void) { this._onError = handler; }
  async start() {}
  async send(message: any) { this.socket.write(JSON.stringify(message) + '\n'); }
  async close() { this.socket.end(); }
}

let connectionCounter = 0;

function createConnectionHandler(mode: 'tcp' | 'unix') {
  return async (socket: net.Socket) => {
    const connId = ++connectionCounter;
    let clientTaskId: string | null = null; // Will be detected from first tool call

    log('INFO', `Client #${connId} connected`, { mode });

    const clientServer = new Server(
      { name: 'rudder-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    clientServer.setRequestHandler(ListToolsRequestSchema, async () => {
      log('DEBUG', `Client #${connId} listed tools`, { taskId: clientTaskId });
      return { tools: TOOLS };
    });

    clientServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: callArgs } = request.params;
      const args = callArgs as Record<string, any>;

      // Detect task ID from first call that has one
      if (!clientTaskId && args.task_id) {
        clientTaskId = args.task_id;
      }
      // Also detect from context:load operation
      if (!clientTaskId && name === 'context_load' && args.operation) {
        const match = args.operation.match(/^T\d+$/);
        if (match) clientTaskId = match[0];
      }

      log('INFO', `Client #${connId} call`, { tool: name, taskId: clientTaskId, args });

      const result = await handleToolCall(request);

      if ((result as any).isError) {
        log('WARN', `Client #${connId} error`, { tool: name, taskId: clientTaskId });
      }

      return result;
    });

    socket.on('close', () => {
      log('INFO', `Client #${connId} disconnected`, { taskId: clientTaskId });
    });

    const transport = new SocketTransport(socket) as any;
    await clientServer.connect(transport);
  };
}

async function main() {
  // Set log file path (same directory as socket/pid files)
  if (socketPath) {
    logFile = socketPath.replace(/\.sock$/, '.log');
  }

  if (port) {
    log('INFO', 'MCP server starting', { mode: 'tcp', port, projectRoot });
    net.createServer(createConnectionHandler('tcp')).listen(port, '127.0.0.1');
  } else if (socketPath) {
    try { fs.unlinkSync(socketPath); } catch (e) {}
    log('INFO', 'MCP server starting', { mode: 'unix', socket: socketPath, projectRoot });
    net.createServer(createConnectionHandler('unix')).listen(socketPath);
  } else {
    await server.connect(new StdioServerTransport());
  }
}

async function handleToolCall(request: any) {
  const { name, arguments: callArgs } = request.params;
  const args = callArgs as Record<string, any>;
  let result: RunResult;

  switch (name) {
    case 'task_log': {
      let cmd = `task:log ${args.task_id} "${args.message}"`;
      if (args.level) cmd += ` --${args.level}`;
      if (args.file) cmd += ` -f "${args.file}"`;
      if (args.command) cmd += ` -c "${args.command}"`;
      result = runRudder(cmd);
      break;
    }
    case 'task_show': result = runRudder(`task:show ${args.task_id}`); break;
    case 'task_show_memory': result = runRudder(`task:show-memory ${args.task_id}`); break;
    // assign_claim/assign_release removed - sandbox agents don't need them
    case 'deps_show': result = runRudder(`deps:show ${args.task_id}`); break;
    case 'task_targets': result = runRudder(`task:targets ${args.task_id}`); break;
    case 'context_load': result = runRudder(`context:load ${args.operation} --role ${args.role || 'agent'}`); break;
    case 'versions': result = runRudder('versions'); break;
    case 'status': result = runRudder('status'); break;
    case 'cli': result = runRudder(args.command); break;
    default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }

  return result.success 
    ? { content: [{ type: 'text', text: result.output || '' }] }
    : { content: [{ type: 'text', text: `Error: ${result.error}\n${result.stderr}` }], isError: true };
}

main().catch(() => process.exit(1));