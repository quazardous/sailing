/**
 * SRT (Sandbox Runtime) Wrapper
 *
 * Shared library for spawning Claude with or without srt sandbox.
 * Used by spawnClaude (agent:spawn) and sandbox:run.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ensureDir } from './paths.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Process a stream-json line and return condensed output
 * Returns null if event should be filtered out
 * @param {string} line - Raw JSON line
 * @returns {string|null} Condensed output or null
 */
export function processStreamJsonLine(line) {
    if (!line.trim())
        return null;
    try {
        const event = JSON.parse(line);
        switch (event.type) {
            case 'system':
                if (event.subtype === 'init') {
                    return `[INIT] model=${event.model} tools=${event.tools?.length || 0}`;
                }
                break;
            case 'assistant': {
                const content = event.message?.content || [];
                const toolUses = content.filter(c => c.type === 'tool_use');
                const text = content.filter(c => c.type === 'text');
                const parts = [];
                for (const t of toolUses) {
                    // Show tool name and brief input summary
                    const inputSummary = t.input?.command || t.input?.file_path || t.input?.pattern || '';
                    parts.push(`[TOOL] ${t.name}${inputSummary ? ': ' + inputSummary.slice(0, 50) : ''}`);
                }
                // Only show text if no tool use (final answer)
                if (text.length && !toolUses.length) {
                    const preview = text[0].text?.slice(0, 100)?.replace(/\n/g, ' ') || '';
                    parts.push(`[TEXT] ${preview}${text[0].text?.length > 100 ? '...' : ''}`);
                }
                return parts.length ? parts.join('\n') : null;
            }
            case 'user': {
                // Tool results - just acknowledge, don't dump content
                if (event.tool_use_result) {
                    const size = event.tool_use_result.stdout?.length || 0;
                    return `[RESULT] ${size} bytes`;
                }
                return null;
            }
            case 'result':
                return `[DONE] ${event.subtype} turns=${event.num_turns} cost=$${event.total_cost_usd?.toFixed(4) || '?'}`;
            default:
                return null;
        }
    }
    catch {
        // Not JSON - could be stderr or other output
        return line.trim() ? `[RAW] ${line.trim().slice(0, 100)}` : null;
    }
    return null;
}
/**
 * Find rudder MCP server path for a project
 * Looks in project first, then falls back to current sailing installation
 * @param {string} projectRoot - Project root path
 * @returns {string} Path to MCP server
 */
export function findMcpServerPath(projectRoot) {
    // Priority 1: Project's own sailing installation
    const projectMcp = path.join(projectRoot, 'mcp', 'rudder-server.js');
    if (fs.existsSync(projectMcp)) {
        return projectMcp;
    }
    // Priority 2: Project's node_modules sailing
    const nodeModulesMcp = path.join(projectRoot, 'node_modules', '@quazardous', 'sailing', 'mcp', 'rudder-server.js');
    if (fs.existsSync(nodeModulesMcp)) {
        return nodeModulesMcp;
    }
    // Priority 3: Current sailing installation (fallback)
    return path.resolve(__dirname, '../../mcp/rudder-server.js');
}
/**
 * Find an available TCP port
 * @returns {Promise<number>} Available port number
 */
export function getAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = require('net').createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}
/**
 * Check if MCP server is already running for a haven
 * Supports both socket and port modes
 * @param {string} havenDir - Haven directory
 * @returns {{ running: boolean, mode?: string, socket?: string, port?: number, pid?: number }}
 */
export function checkMcpServer(havenDir) {
    const socketPath = path.join(havenDir, 'mcp.sock');
    const portFile = path.join(havenDir, 'mcp.port');
    const pidFile = path.join(havenDir, 'mcp.pid');
    if (!fs.existsSync(pidFile)) {
        return { running: false };
    }
    // Check if PID is still running
    try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        process.kill(pid, 0); // Signal 0 = check if process exists
        // Determine mode
        if (fs.existsSync(portFile)) {
            const port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
            return { running: true, mode: 'port', port, pid };
        }
        else if (fs.existsSync(socketPath)) {
            return { running: true, mode: 'socket', socket: socketPath, pid };
        }
        else {
            // PID exists but no socket or port file - stale
            throw new Error('Stale PID file');
        }
    }
    catch (e) {
        // Process not running, clean up stale files
        try {
            fs.unlinkSync(socketPath);
        }
        catch { }
        try {
            fs.unlinkSync(pidFile);
        }
        catch { }
        try {
            fs.unlinkSync(portFile);
        }
        catch { }
        return { running: false };
    }
}
/**
 * Generate MCP config for agent
 * Supports three modes:
 * - externalSocket: Connect to Unix socket via socat (preferred for sandbox)
 * - externalPort: Connect to TCP port via socat (fallback)
 * - internal: Spawn MCP server as child process (no sandbox)
 *
 * @param {object} options - Options
 * @param {string} options.outputPath - Where to write the MCP config
 * @param {string} options.projectRoot - Project root path
 * @param {string} [options.externalSocket] - Unix socket path for external MCP
 * @param {number} [options.externalPort] - TCP port for external MCP (fallback)
 * @param {string} [options.taskId] - Task ID (only for internal mode)
 * @returns {{ configPath: string, mode: string }}
 */
export function generateAgentMcpConfig(options) {
    const { outputPath, projectRoot, externalSocket, externalPort, taskId } = options;
    let config;
    let mode;
    if (externalSocket) {
        // Unix socket mode: use socat to bridge to Unix socket (preferred)
        config = {
            mcpServers: {
                rudder: {
                    command: 'socat',
                    args: ['-', `UNIX-CONNECT:${externalSocket}`]
                }
            }
        };
        mode = 'socket';
    }
    else if (externalPort) {
        // TCP port mode: use socat to bridge to TCP server (fallback)
        config = {
            mcpServers: {
                rudder: {
                    command: 'socat',
                    args: ['-', `TCP:127.0.0.1:${externalPort}`]
                }
            }
        };
        mode = 'tcp';
    }
    else {
        // Internal MCP mode: spawn server as child process (no sandbox)
        const mcpServerPath = findMcpServerPath(projectRoot);
        const args = [mcpServerPath, '--project-root', projectRoot];
        if (taskId) {
            args.push('--task-id', taskId);
        }
        config = {
            mcpServers: {
                rudder: {
                    command: 'node',
                    args
                }
            }
        };
        mode = 'internal';
    }
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    return {
        configPath: outputPath,
        mode
    };
}
/**
 * Load base srt config from file or generate defaults
 * @param {string} [configPath] - Path to existing config
 * @returns {object} SRT configuration
 */
export function loadBaseSrtConfig(configPath) {
    if (configPath && fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        catch {
            // Fall through to defaults
        }
    }
    const homeDir = os.homedir();
    return {
        network: {
            allowedDomains: [
                'localhost', // MCP server (TCP mode)
                '127.0.0.1', // MCP server (TCP mode, IP form)
                'api.anthropic.com',
                '*.anthropic.com',
                'sentry.io',
                'statsig.anthropic.com',
                'github.com',
                '*.github.com',
                'api.github.com',
                'raw.githubusercontent.com',
                'registry.npmjs.org',
                '*.npmjs.org'
            ],
            deniedDomains: []
        },
        filesystem: {
            allowWrite: [
                `${homeDir}/.claude`,
                `${homeDir}/.claude.json`,
                `${homeDir}/.npm/_logs`,
                '/tmp'
            ],
            denyWrite: [],
            denyRead: [
                `${homeDir}/.ssh`,
                `${homeDir}/.gnupg`,
                `${homeDir}/.aws`
            ]
        }
    };
}
/**
 * Generate agent-specific srt config with additional write paths
 * @param {object} options - Options
 * @param {string} options.baseConfigPath - Base config path (optional)
 * @param {string} options.outputPath - Where to write the generated config
 * @param {string[]} options.additionalWritePaths - Additional paths to allow writing
 * @param {string[]} [options.additionalDenyReadPaths] - Additional paths to deny reading
 * @param {boolean} [options.strictMode=false] - If true, ONLY allow /tmp + additionalWritePaths (ignore base config paths)
 * @returns {string} Path to generated config
 */
export function generateSrtConfig(options) {
    const { baseConfigPath, outputPath, additionalWritePaths = [], additionalDenyReadPaths = [], strictMode = false } = options;
    const config = loadBaseSrtConfig(baseConfigPath);
    if (strictMode) {
        // Strict mode: only essential paths + explicitly provided paths
        // This is for worktree agents that should be sandboxed to their worktree
        const homeDir = os.homedir();
        config.filesystem.allowWrite = [
            '/tmp', // Temp files
            `${homeDir}/.claude`, // Claude session data (required)
            `${homeDir}/.claude.json`, // Claude config (required)
            `${homeDir}/.cache/claude-cli-nodejs` // Claude cache (required)
        ];
        for (const p of additionalWritePaths) {
            if (p) {
                config.filesystem.allowWrite.push(p);
            }
        }
    }
    else {
        // Normal mode: merge additional paths with base config
        const existingPaths = new Set(config.filesystem.allowWrite);
        for (const p of additionalWritePaths) {
            if (p && !existingPaths.has(p)) {
                config.filesystem.allowWrite.push(p);
            }
        }
    }
    // Add additional denyRead paths (e.g., other worktrees)
    for (const p of additionalDenyReadPaths) {
        if (p && !config.filesystem.denyRead.includes(p)) {
            config.filesystem.denyRead.push(p);
        }
    }
    // Ensure output directory exists
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    return outputPath;
}
/**
 * Spawn Claude with optional srt wrapper
 *
 * @param {object} options - Spawn options
 * @param {string} options.prompt - The prompt to send (via stdin)
 * @param {string} options.cwd - Working directory
 * @param {string} [options.logFile] - Log file for tee mode (optional)
 * @param {boolean} [options.sandbox=false] - Wrap with srt
 * @param {string} [options.srtConfigPath] - Path to srt config (required if sandbox=true)
 * @param {boolean} [options.riskyMode=false] - Add --dangerously-skip-permissions
 * @param {string[]} [options.extraArgs=[]] - Additional claude args
 * @param {boolean} [options.debug=false] - Enable SRT_DEBUG
 * @param {number} [options.timeout] - Timeout in seconds
 * @param {function} [options.onStdout] - Custom stdout handler (data => void)
 * @param {function} [options.onStderr] - Custom stderr handler (data => void)
 * @param {string} [options.mcpConfigPath] - Path to MCP config for agent (adds --mcp-config + --strict-mcp-config)
 * @param {string} [options.sandboxHome] - Custom HOME directory for sandbox isolation
 * @param {number} [options.maxBudgetUsd] - Max budget in USD (-1 or undefined = no limit)
 * @param {number} [options.watchdogTimeout] - Kill if no output for N seconds (0 = disabled)
 * @param {boolean} [options.noSessionPersistence=true] - Disable session persistence (lighter weight)
 * @returns {{ process: ChildProcess, pid: number, logFile?: string }}
 */
export function spawnClaudeWithSrt(options) {
    const { prompt, cwd, logFile, sandbox = false, srtConfigPath, riskyMode = false, extraArgs = [], debug = false, timeout, onStdout, onStderr, mcpConfigPath, sandboxHome, maxBudgetUsd, watchdogTimeout, noSessionPersistence = true } = options;
    // Build claude args
    const claudeArgs = [];
    if (riskyMode) {
        claudeArgs.push('--dangerously-skip-permissions');
    }
    // Add MCP config for agent (restricted to specific MCP servers only)
    if (mcpConfigPath) {
        claudeArgs.push('--mcp-config', mcpConfigPath);
        claudeArgs.push('--strict-mcp-config'); // Only use specified MCP servers
    }
    // Disable session persistence (lighter weight, no disk writes)
    if (noSessionPersistence) {
        claudeArgs.push('--no-session-persistence');
    }
    // Stream JSON for real-time events (required for watchdog stall detection)
    // --verbose is required for --output-format stream-json
    claudeArgs.push('--verbose', '--output-format', 'stream-json');
    // Budget limit (only with -p mode)
    if (maxBudgetUsd && maxBudgetUsd > 0) {
        claudeArgs.push('--max-budget-usd', String(maxBudgetUsd));
    }
    // Add any extra args
    claudeArgs.push(...extraArgs);
    // -p without argument: read prompt from stdin
    claudeArgs.push('-p');
    // Build final command
    let command, finalArgs;
    if (sandbox) {
        command = 'srt';
        finalArgs = [];
        if (srtConfigPath) {
            finalArgs.push('--settings', srtConfigPath);
        }
        finalArgs.push('claude', ...claudeArgs);
    }
    else {
        command = 'claude';
        finalArgs = claudeArgs;
    }
    // Setup dual log streams if logFile provided:
    // - jsonLogStream: raw JSON for post-mortem (.jsonlog)
    // - filteredLogStream: filtered output like stdout (.log)
    let jsonLogStream = null;
    let filteredLogStream = null;
    let jsonLogFile = null;
    let filteredLogFile = null;
    if (logFile) {
        ensureDir(path.dirname(logFile));
        // Determine file paths based on extension
        const basePath = logFile.replace(/\.(log|jsonlog)$/, '');
        jsonLogFile = `${basePath}.jsonlog`;
        filteredLogFile = `${basePath}.log`;
        jsonLogStream = fs.createWriteStream(jsonLogFile, { flags: 'a' });
        filteredLogStream = fs.createWriteStream(filteredLogFile, { flags: 'a' });
        const startTime = new Date().toISOString();
        const header = [
            `\n=== Claude Started: ${startTime} ===`,
            `CWD: ${cwd}`,
            `Command: ${command} ${finalArgs.join(' ')} (prompt via stdin)`,
            `Sandbox: ${sandbox ? 'enabled' : 'disabled'}`,
            srtConfigPath ? `SRT Config: ${srtConfigPath}` : null,
            mcpConfigPath ? `MCP Config: ${mcpConfigPath}` : null,
            '='.repeat(50) + '\n'
        ].filter(Boolean).join('\n');
        jsonLogStream.write(header);
        filteredLogStream.write(header);
    }
    // Prepare environment
    const spawnEnv = { ...process.env };
    if (debug)
        spawnEnv.SRT_DEBUG = '1';
    // Sandbox HOME isolation: Claude writes to isolated home instead of real ~/.claude.json
    if (sandboxHome) {
        ensureDir(sandboxHome);
        ensureDir(path.join(sandboxHome, '.claude'));
        spawnEnv.HOME = sandboxHome;
        // Copy credentials from real ~/.claude.json and ~/.claude/.credentials.json
        const realHome = os.homedir();
        const realClaudeJson = path.join(realHome, '.claude.json');
        const realCredentials = path.join(realHome, '.claude', '.credentials.json');
        const sandboxClaudeJson = path.join(sandboxHome, '.claude.json');
        const sandboxClaudeDir = path.join(sandboxHome, '.claude');
        const sandboxCredentials = path.join(sandboxClaudeDir, '.credentials.json');
        // Copy .claude.json (full copy - Claude needs various fields to work)
        if (fs.existsSync(realClaudeJson)) {
            try {
                fs.copyFileSync(realClaudeJson, sandboxClaudeJson);
            }
            catch {
                // Ignore errors
            }
        }
        // Copy .claude/.credentials.json (contains OAuth tokens)
        if (fs.existsSync(realCredentials)) {
            try {
                fs.copyFileSync(realCredentials, sandboxCredentials);
                // Schedule cleanup of credentials.json only (not .claude.json which Claude needs)
                // 5 seconds is enough for Claude to read and cache the tokens
                setTimeout(() => {
                    try {
                        if (fs.existsSync(sandboxCredentials))
                            fs.unlinkSync(sandboxCredentials);
                    }
                    catch {
                        // Ignore cleanup errors
                    }
                }, 5000);
            }
            catch {
                // Ignore errors
            }
        }
        if (jsonLogStream) {
            jsonLogStream.write(`Sandbox HOME: ${sandboxHome}\n`);
        }
        if (filteredLogStream) {
            filteredLogStream.write(`Sandbox HOME: ${sandboxHome}\n`);
        }
    }
    // Spawn process
    const child = spawn(command, finalArgs, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
        env: spawnEnv
    });
    // Write prompt to stdin and close
    child.stdin.write(prompt);
    child.stdin.end();
    // Watchdog: kill if no output for N seconds (detects stalls)
    let watchdogId = null;
    let lastOutputTime = Date.now();
    const resetWatchdog = () => {
        lastOutputTime = Date.now();
        if (watchdogId) {
            clearTimeout(watchdogId);
            watchdogId = null;
        }
        if (watchdogTimeout && watchdogTimeout > 0) {
            watchdogId = setTimeout(() => {
                const stallDuration = Math.round((Date.now() - lastOutputTime) / 1000);
                const msg = `\n=== WATCHDOG: No output for ${stallDuration}s, killing process ===\n`;
                if (jsonLogStream)
                    jsonLogStream.write(msg);
                if (filteredLogStream)
                    filteredLogStream.write(msg);
                process.stderr.write(msg);
                child.kill('SIGTERM');
                setTimeout(() => {
                    if (!child.killed) {
                        child.kill('SIGKILL');
                    }
                }, 5000);
            }, watchdogTimeout * 1000);
        }
    };
    // Start watchdog
    resetWatchdog();
    // Line buffer for stream-json processing
    let lineBuffer = '';
    /**
     * Write filtered output to both stdout and filtered log
     */
    const writeFiltered = (text) => {
        process.stdout.write(text + '\n');
        if (filteredLogStream)
            filteredLogStream.write(text + '\n');
    };
    /**
     * Process buffered data:
     * - Raw JSON → jsonLogStream (post-mortem)
     * - Filtered → stdout + filteredLogStream
     */
    const processData = (data) => {
        resetWatchdog(); // Activity detected
        // Raw data goes to JSON log file (post-mortem)
        if (jsonLogStream)
            jsonLogStream.write(data);
        // If custom handler, pass raw data
        if (onStdout) {
            onStdout(data);
            return;
        }
        // Buffer and process line by line for filtered output
        lineBuffer += data.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer
        for (const line of lines) {
            const filtered = processStreamJsonLine(line);
            if (filtered) {
                writeFiltered(filtered);
            }
        }
    };
    // Handle stdout
    child.stdout.on('data', (data) => processData(data));
    // Handle stderr (pass through, usually errors)
    child.stderr.on('data', (data) => {
        resetWatchdog();
        // Stderr goes to both log files
        if (jsonLogStream)
            jsonLogStream.write(data);
        if (filteredLogStream)
            filteredLogStream.write(data);
        // Stderr always goes through (errors are important)
        if (onStderr) {
            onStderr(data);
        }
        else {
            process.stderr.write(data);
        }
    });
    // Handle timeout (absolute timeout, independent of watchdog)
    let timeoutId = null;
    if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
            const msg = `\n=== TIMEOUT after ${timeout}s ===\n`;
            if (jsonLogStream)
                jsonLogStream.write(msg);
            if (filteredLogStream)
                filteredLogStream.write(msg);
            child.kill('SIGTERM');
            setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }, 5000);
        }, timeout * 1000);
    }
    // Handle exit
    child.on('exit', (code, signal) => {
        if (timeoutId)
            clearTimeout(timeoutId);
        if (watchdogId)
            clearTimeout(watchdogId);
        const endTime = new Date().toISOString();
        const footer = `\n=== Claude Exited: ${endTime} ===\nExit code: ${code}, Signal: ${signal}\n`;
        if (jsonLogStream) {
            jsonLogStream.write(footer, () => jsonLogStream.end());
        }
        if (filteredLogStream) {
            filteredLogStream.write(footer, () => filteredLogStream.end());
        }
    });
    return {
        process: child,
        pid: child.pid,
        logFile: filteredLogFile, // .log (filtered, like stdout)
        jsonLogFile // .jsonlog (raw JSON for post-mortem)
    };
}
