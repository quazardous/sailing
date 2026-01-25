/**
 * MCP Manager - Shared utilities for MCP servers
 *
 * Provides:
 * - runRudder: Execute rudder CLI commands
 * - SocketTransport: Network transport for MCP
 * - Logging utilities
 * - Common tool response formatting
 */
import { execaSync } from 'execa';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { findProjectRoot, setProjectRoot as setCoreProjectRoot, clearPathsCache } from './core-manager.js';
// =============================================================================
// Logging
// =============================================================================
let _logFile = null;
export function setLogFile(logPath) {
    _logFile = logPath;
}
export function log(level, message, context) {
    const timestamp = new Date().toISOString();
    const ctx = context ? ` ${JSON.stringify(context)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${ctx}\n`;
    if (_logFile) {
        try {
            fs.appendFileSync(_logFile, line);
        }
        catch { }
    }
    else {
        process.stderr.write(line);
    }
}
// =============================================================================
// Rudder Execution
// =============================================================================
let _projectRoot = null;
export function setProjectRoot(root) {
    _projectRoot = root;
    // Also set core-manager's project root and clear its caches
    setCoreProjectRoot(root);
    clearPathsCache();
}
export function getProjectRoot() {
    return _projectRoot || findProjectRoot();
}
/**
 * Execute rudder CLI command
 */
export function runRudder(command, options = {}) {
    const projectRoot = getProjectRoot();
    const rudderBin = path.join(projectRoot, 'bin', 'rudder');
    const { json = false } = options;
    try {
        const args = command.split(/\s+/);
        if (json)
            args.push('--json');
        const { stdout, stderr } = execaSync(rudderBin, args, {
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
// =============================================================================
// Tool Response Helpers
// =============================================================================
/**
 * Format success response (JSON)
 */
export function okResponse(data) {
    return {
        content: [{
                type: 'text',
                text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
            }]
    };
}
/**
 * Format error response
 */
export function errorResponse(message, details) {
    const text = details ? `${message}\n${details}` : message;
    return {
        content: [{ type: 'text', text }],
        isError: true
    };
}
/**
 * Convert RunResult to MCP response
 */
export function runResultToResponse(result) {
    return result.success
        ? okResponse(result.output || '')
        : errorResponse(result.error || 'Command failed', result.stderr);
}
// =============================================================================
// Socket Transport
// =============================================================================
export class SocketTransport {
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
                catch { }
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
let _debugEnabled = false;
export function isDebugEnabled() {
    return _debugEnabled;
}
export function setDebugEnabled(enabled) {
    _debugEnabled = enabled;
}
export function logDebug(context, data) {
    if (_debugEnabled) {
        log('DEBUG', context, data);
    }
}
export function parseMcpCliArgs(defaultProjectRoot) {
    const args = process.argv.slice(2);
    let projectRoot = defaultProjectRoot;
    let port = null;
    let socketPath = null;
    let taskId = null;
    let debug = false;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--project-root':
                if (args[i + 1])
                    projectRoot = args[++i];
                break;
            case '--port':
                if (args[i + 1])
                    port = parseInt(args[++i], 10);
                break;
            case '--socket':
                if (args[i + 1])
                    socketPath = args[++i];
                break;
            case '--task-id':
                if (args[i + 1])
                    taskId = args[++i];
                break;
            case '--debug':
                debug = true;
                break;
        }
    }
    // Enable debug mode globally
    setDebugEnabled(debug);
    return { projectRoot, port, socketPath, taskId, debug };
}
// =============================================================================
// Server Creation Helpers
// =============================================================================
export function createSocketServer(socketPath, connectionHandler) {
    // Clean up existing socket
    try {
        fs.unlinkSync(socketPath);
    }
    catch { }
    const server = net.createServer(connectionHandler);
    server.listen(socketPath);
    return server;
}
export function createTcpServer(port, connectionHandler) {
    const server = net.createServer(connectionHandler);
    server.listen(port, '127.0.0.1');
    return server;
}
