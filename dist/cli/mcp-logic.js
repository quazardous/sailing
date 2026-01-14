/**
 * Rudder MCP Server Logic
 *
 * Exposes rudder CLI commands as MCP tools for sandboxed agents.
 * Agents can interact with rudder without needing filesystem write access.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { execaSync } from 'execa';
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
    }
    else if (args[i] === '--project-root' && args[i + 1]) {
        projectRoot = args[++i];
    }
    else if (args[i] === '--port' && args[i + 1]) {
        port = parseInt(args[++i], 10);
    }
    else if (args[i] === '--socket' && args[i + 1]) {
        socketPath = args[++i];
    }
}
const RUDDER_BIN = path.join(projectRoot, 'bin', 'rudder');
/**
 * Execute rudder command and return result
 */
function runRudder(command, options = {}) {
    const { json = false } = options;
    try {
        const args = command.split(/\s+/);
        if (json)
            args.push('--json');
        const { stdout, stderr } = execaSync(RUDDER_BIN, args, {
            cwd: projectRoot,
            env: {
                ...process.env,
                SAILING_PROJECT: projectRoot
            }
        });
        return { success: true, output: stdout.trim(), stderr };
    }
    catch (error) {
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
    if (!taskId)
        return true; // No restriction
    return requestedTaskId === taskId;
}
// Define available tools
const TOOLS = [
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
    {
        name: 'assign_claim',
        description: 'Claim a task.',
        inputSchema: {
            type: 'object',
            properties: { task_id: { type: 'string' } },
            required: ['task_id']
        }
    },
    {
        name: 'assign_release',
        description: 'Release a task.',
        inputSchema: {
            type: 'object',
            properties: { task_id: { type: 'string' } },
            required: ['task_id']
        }
    },
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
const server = new Server({ name: 'rudder-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, (request) => handleToolCall(request));
class SocketTransport {
    socket;
    _onMessage = null;
    _onClose = null;
    _onError = null;
    _buffer = '';
    constructor(socket) {
        this.socket = socket;
        socket.on('data', (data) => {
            this._buffer += data.toString();
            this._processBuffer();
        });
        socket.on('close', () => { if (this._onClose)
            this._onClose(); });
        socket.on('error', (err) => { if (this._onError)
            this._onError(err); });
    }
    _processBuffer() {
        let newlineIndex;
        while ((newlineIndex = this._buffer.indexOf('\n')) !== -1) {
            const line = this._buffer.slice(0, newlineIndex);
            this._buffer = this._buffer.slice(newlineIndex + 1);
            if (line.trim() && this._onMessage) {
                try {
                    this._onMessage(JSON.parse(line));
                }
                catch (e) { }
            }
        }
    }
    set onmessage(handler) { this._onMessage = handler; }
    set onclose(handler) { this._onClose = handler; }
    set onerror(handler) { this._onError = handler; }
    async start() { }
    async send(message) { this.socket.write(JSON.stringify(message) + '\n'); }
    async close() { this.socket.end(); }
}
function createConnectionHandler(mode) {
    return async (socket) => {
        const clientServer = new Server({ name: 'rudder-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
        clientServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
        clientServer.setRequestHandler(CallToolRequestSchema, async (request) => handleToolCall(request));
        const transport = new SocketTransport(socket);
        await clientServer.connect(transport);
    };
}
async function main() {
    if (port) {
        net.createServer(createConnectionHandler('tcp')).listen(port, '127.0.0.1');
    }
    else if (socketPath) {
        try {
            fs.unlinkSync(socketPath);
        }
        catch (e) { }
        net.createServer(createConnectionHandler('unix')).listen(socketPath);
    }
    else {
        await server.connect(new StdioServerTransport());
    }
}
async function handleToolCall(request) {
    const { name, arguments: callArgs } = request.params;
    const args = callArgs;
    let result;
    switch (name) {
        case 'task_log': {
            let cmd = `task:log ${args.task_id} "${args.message}"`;
            if (args.level)
                cmd += ` --${args.level}`;
            if (args.file)
                cmd += ` -f "${args.file}"`;
            if (args.command)
                cmd += ` -c "${args.command}"`;
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
        case 'context_load':
            result = runRudder(`context:load ${args.operation} --role ${args.role || 'agent'}`);
            break;
        case 'versions':
            result = runRudder('versions');
            break;
        case 'status':
            result = runRudder('status');
            break;
        case 'cli':
            result = runRudder(args.command);
            break;
        default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return result.success
        ? { content: [{ type: 'text', text: result.output || '' }] }
        : { content: [{ type: 'text', text: `Error: ${result.error}\n${result.stderr}` }], isError: true };
}
main().catch(() => process.exit(1));
