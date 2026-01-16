/**
 * SRT (Sandbox Runtime) Wrapper
 *
 * Shared library for spawning Claude with or without srt sandbox.
 * Used by spawnClaude (agent:spawn) and sandbox:run.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ensureDir } from './fs-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Stream JSON event types */
interface StreamJsonEvent {
  type: string;
  subtype?: string;
  model?: string;
  tools?: unknown[];
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      text?: string;
      input?: {
        command?: string;
        file_path?: string;
        pattern?: string;
      };
    }>;
  };
  tool_use_result?: {
    stdout?: string;
  };
  num_turns?: number;
  total_cost_usd?: number;
}

/**
 * Process a stream-json line and return condensed output
 * Returns null if event should be filtered out
 * @param {string} line - Raw JSON line
 * @returns {string|null} Condensed output or null
 */
export function processStreamJsonLine(line: string): string | null {
  if (!line.trim()) return null;

  try {
    const event = JSON.parse(line) as StreamJsonEvent;

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

        const parts: string[] = [];
        for (const t of toolUses) {
          // Show tool name and brief input summary
          const inputSummary = t.input?.command || t.input?.file_path || t.input?.pattern || '';
          parts.push(`[TOOL] ${t.name}${inputSummary ? ': ' + inputSummary.slice(0, 50) : ''}`);
        }
        // Only show text if no tool use (final answer)
        if (text.length && !toolUses.length) {
          const preview = text[0].text?.slice(0, 100)?.replace(/\n/g, ' ') || '';
          parts.push(`[TEXT] ${preview}${(text[0].text?.length || 0) > 100 ? '...' : ''}`);
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
  } catch {
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
export function findMcpServerPath(projectRoot: string): string {
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
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    // Dynamic require needed for net module in this context
    const net = require('net') as typeof import('net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** Result of checking MCP server status */
interface McpServerStatus {
  running: boolean;
  mode?: string;
  socket?: string;
  port?: number;
  pid?: number;
}

/**
 * Check if MCP server is already running for a haven
 * Supports both socket and port modes
 * @param {string} havenDir - Haven directory
 * @returns {{ running: boolean, mode?: string, socket?: string, port?: number, pid?: number }}
 */
export function checkMcpServer(havenDir: string): McpServerStatus {
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
    } else if (fs.existsSync(socketPath)) {
      return { running: true, mode: 'socket', socket: socketPath, pid };
    } else {
      // PID exists but no socket or port file - stale
      throw new Error('Stale PID file');
    }
  } catch {
    // Process not running, clean up stale files
    try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
    try { fs.unlinkSync(portFile); } catch { /* ignore */ }
    return { running: false };
  }
}

/**
 * Start a socat bridge from Unix socket to TCP port
 * Used on Linux to allow sandbox agents to connect to MCP server in port mode
 *
 * On Linux, srt uses --unshare-net which isolates the network namespace.
 * This means localhost inside sandbox != host localhost, breaking TCP port mode.
 * Solution: Create a socat bridge that forwards Unix socket → TCP:
 * - Agent inside sandbox connects to the Unix socket (with allowAllUnixSockets: true)
 * - Socat bridges to the MCP server's TCP port on host
 *
 * @param {object} options - Options
 * @param {string} options.socketPath - Unix socket path to listen on
 * @param {number} options.targetPort - TCP port to forward to
 * @returns {{ pid: number, socket: string, cleanup: () => void }}
 */
export function startSocatBridge(options: { socketPath: string; targetPort: number }) {
  const { socketPath, targetPort } = options;

  // Remove any stale socket
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  // Start socat bridge: UNIX-LISTEN:socket,fork TCP:127.0.0.1:port
  const socat = spawn('socat', [
    `UNIX-LISTEN:${socketPath},fork,mode=666`,
    `TCP:127.0.0.1:${targetPort}`
  ], {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true
  });

  socat.unref();

  // Wait a bit for socket to be created
  const maxWait = 2000;
  const start = Date.now();
  while (!fs.existsSync(socketPath) && Date.now() - start < maxWait) {
    // Spin wait
    spawnSync('sleep', ['0.1'], { stdio: 'ignore' });
  }

  if (!fs.existsSync(socketPath)) {
    try {
      socat.kill();
    } catch {}
    throw new Error(`Failed to start socat bridge (socket ${socketPath} not created)`);
  }

  return {
    pid: socat.pid,
    socket: socketPath,
    cleanup: () => {
      try {
        socat.kill();
      } catch {}
      try {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      } catch {}
    }
  };
}

/** MCP config structure */
interface McpConfig {
  mcpServers: {
    rudder: {
      command: string;
      args: string[];
    };
  };
}

/** Options for generating agent MCP config */
interface GenerateAgentMcpConfigOptions {
  outputPath: string;
  projectRoot: string;
  externalSocket?: string;
  externalPort?: number;
  taskId?: string;
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
export function generateAgentMcpConfig(options: GenerateAgentMcpConfigOptions): { configPath: string; mode: string } {
  const { outputPath, projectRoot, externalSocket, externalPort, taskId } = options;

  let config: McpConfig;
  let mode: string;

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
  } else if (externalPort) {
    // TCP port mode: use nc (netcat) to bridge to TCP server
    // nc is simpler than socat and works better in sandbox environments
    config = {
      mcpServers: {
        rudder: {
          command: 'nc',
          args: ['127.0.0.1', String(externalPort)]
        }
      }
    };
    mode = 'tcp';
  } else {
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

/** SRT config structure */
interface SrtConfig {
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
    allowUnixSockets: string[];
    allowAllUnixSockets?: boolean;
  };
  filesystem: {
    allowWrite: string[];
    denyWrite: string[];
    denyRead: string[];
  };
}

/**
 * Load base srt config from file or generate defaults
 * @param {string} [configPath] - Path to existing config
 * @returns {object} SRT configuration
 */
export function loadBaseSrtConfig(configPath?: string): SrtConfig {
  if (configPath && fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8')) as SrtConfig;
    } catch {
      // Fall through to defaults
    }
  }

  const homeDir = os.homedir();
  return {
    network: {
      allowedDomains: [
        'localhost',              // MCP server (TCP mode)
        '127.0.0.1',              // MCP server (TCP mode, IP form)
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
      deniedDomains: [],
      allowUnixSockets: []        // Will be populated with MCP socket path
    },
    filesystem: {
      allowWrite: [
        `${homeDir}/.claude`,
        `${homeDir}/.claude.json`,
        `${homeDir}/.npm/_logs`,
        `${homeDir}/.gradle`,     // Gradle/Android build cache
        '/tmp',
        '/tmp/claude'             // tsx pipe files
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

/** Options for generating SRT config */
interface GenerateSrtConfigOptions {
  baseConfigPath?: string;
  outputPath: string;
  additionalWritePaths?: string[];
  additionalDenyReadPaths?: string[];
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  strictMode?: boolean;
}

/**
 * Generate agent-specific srt config with additional write paths
 * @param {object} options - Options
 * @param {string} options.baseConfigPath - Base config path (optional)
 * @param {string} options.outputPath - Where to write the generated config
 * @param {string[]} options.additionalWritePaths - Additional paths to allow writing
 * @param {string[]} [options.additionalDenyReadPaths] - Additional paths to deny reading
 * @param {string[]} [options.allowUnixSockets] - Unix sockets to allow (e.g., MCP socket, macOS only)
 * @param {boolean} [options.allowAllUnixSockets=false] - Allow all Unix sockets (Linux: disables seccomp AF_UNIX blocking)
 * @param {boolean} [options.strictMode=false] - If true, ONLY allow /tmp + additionalWritePaths (ignore base config paths)
 * @returns {string} Path to generated config
 */
export function generateSrtConfig(options: GenerateSrtConfigOptions): string {
  const { baseConfigPath, outputPath, additionalWritePaths = [], additionalDenyReadPaths = [], allowUnixSockets = [], allowAllUnixSockets = false, strictMode = false } = options;

  const config = loadBaseSrtConfig(baseConfigPath);

  if (strictMode) {
    // Strict mode: only essential paths + explicitly provided paths
    // This is for worktree agents that should be sandboxed to their worktree
    const homeDir = os.homedir();
    config.filesystem.allowWrite = [
      '/tmp',                         // Temp files
      `${homeDir}/.claude`,           // Claude session data (required)
      `${homeDir}/.claude.json`,      // Claude config (required)
      `${homeDir}/.cache/claude-cli-nodejs`,  // Claude cache (required)
      `${homeDir}/.gradle`,           // Gradle build cache (Android builds)
      `${homeDir}/.npm/_logs`         // npm logs
    ];
    for (const p of additionalWritePaths) {
      if (p) {
        config.filesystem.allowWrite.push(p);
      }
    }
  } else {
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

  // Network configuration for MCP connectivity
  // LIMITATION on Linux: srt uses --unshare-net which isolates the network namespace
  // This means localhost inside sandbox != host localhost, breaking MCP TCP port mode
  //
  // Solution for socket mode on Linux:
  // - allowAllUnixSockets: true  → disables seccomp AF_UNIX blocking
  // - Use socat bridge: UNIX-LISTEN:/tmp/bridge.sock,fork TCP:127.0.0.1:PORT
  // - Agent connects to bridge socket which forwards to MCP TCP port
  //
  // - socket mode on macOS: uses path-based allowUnixSockets (per-socket)
  // - socket mode on Linux: needs allowAllUnixSockets: true (disables seccomp)

  // Add allowed Unix sockets (e.g., MCP socket for agent communication)
  // This works on macOS where allowUnixSockets is path-based
  // On Linux, seccomp blocks AF_UNIX socket creation regardless of path
  if (allowUnixSockets.length > 0) {
    if (!config.network.allowUnixSockets) {
      config.network.allowUnixSockets = [];
    }
    for (const sock of allowUnixSockets) {
      if (sock && !config.network.allowUnixSockets.includes(sock)) {
        config.network.allowUnixSockets.push(sock);
      }
    }
  }

  // On Linux, enable allowAllUnixSockets to disable seccomp AF_UNIX blocking
  // This is required for socket mode MCP connectivity from inside sandbox
  if (allowAllUnixSockets) {
    config.network.allowAllUnixSockets = true;
  }

  // Ensure output directory exists
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));

  return outputPath;
}

/** Options for spawning Claude with SRT */
interface SpawnClaudeWithSrtOptions {
  prompt: string;
  cwd: string;
  logFile?: string;
  sandbox?: boolean;
  srtConfigPath?: string;
  riskyMode?: boolean;
  extraArgs?: string[];
  debug?: boolean;
  timeout?: number;
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  mcpConfigPath?: string;
  sandboxHome?: string;
  maxBudgetUsd?: number;
  watchdogTimeout?: number;
  noSessionPersistence?: boolean;
}

/** Result of spawning Claude with SRT */
interface SpawnClaudeWithSrtResult {
  process: ChildProcess;
  pid: number | undefined;
  logFile: string | null;
  jsonLogFile: string | null;
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
export function spawnClaudeWithSrt(options: SpawnClaudeWithSrtOptions): SpawnClaudeWithSrtResult {
  const {
    prompt,
    cwd,
    logFile,
    sandbox = false,
    srtConfigPath,
    riskyMode = false,
    extraArgs = [],
    debug = false,
    timeout,
    onStdout,
    onStderr,
    mcpConfigPath,
    sandboxHome,
    maxBudgetUsd,
    watchdogTimeout,
    noSessionPersistence = true
  } = options;

  // Build claude args
  const claudeArgs: string[] = [];

  if (riskyMode) {
    claudeArgs.push('--dangerously-skip-permissions');
  }

  // Add MCP config for agent (restricted to specific MCP servers only)
  if (mcpConfigPath) {
    claudeArgs.push('--mcp-config', mcpConfigPath);
    claudeArgs.push('--strict-mcp-config');  // Only use specified MCP servers
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
  let command: string;
  let finalArgs: string[];

  if (sandbox) {
    command = 'srt';
    finalArgs = [];

    if (srtConfigPath) {
      finalArgs.push('--settings', srtConfigPath);
    }

    finalArgs.push('claude', ...claudeArgs);
  } else {
    command = 'claude';
    finalArgs = claudeArgs;
  }

  // Setup dual log streams if logFile provided:
  // - jsonLogStream: raw JSON for post-mortem (.jsonlog)
  // - filteredLogStream: filtered output like stdout (.log)
  let jsonLogStream: fs.WriteStream | null = null;
  let filteredLogStream: fs.WriteStream | null = null;
  let jsonLogFile: string | null = null;
  let filteredLogFile: string | null = null;

  if (logFile) {
    ensureDir(path.dirname(logFile));

    // Determine file paths based on extension
    const basePath = logFile.replace(/\.(log|jsonlog)$/, '');
    jsonLogFile = `${basePath}.jsonlog`;
    filteredLogFile = `${basePath}.log`;

    // Rotate logs: .3 deleted, .2 → .3, .1 → .2, current → .1, start fresh
    const rotateLog = (filePath: string) => {
      try {
        // Delete .3 if exists
        if (fs.existsSync(`${filePath}.3`)) fs.unlinkSync(`${filePath}.3`);
        // .2 → .3
        if (fs.existsSync(`${filePath}.2`)) fs.renameSync(`${filePath}.2`, `${filePath}.3`);
        // .1 → .2
        if (fs.existsSync(`${filePath}.1`)) fs.renameSync(`${filePath}.1`, `${filePath}.2`);
        // current → .1
        if (fs.existsSync(filePath)) fs.renameSync(filePath, `${filePath}.1`);
      } catch {
        // Ignore rotation errors
      }
    };

    rotateLog(jsonLogFile);
    rotateLog(filteredLogFile);

    jsonLogStream = fs.createWriteStream(jsonLogFile, { flags: 'w' });
    filteredLogStream = fs.createWriteStream(filteredLogFile, { flags: 'w' });

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
  if (debug) spawnEnv.SRT_DEBUG = '1';

  // Track sandbox credentials for cleanup on exit
  let sandboxCredentialsPath: string | null = null;

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
    sandboxCredentialsPath = path.join(sandboxClaudeDir, '.credentials.json');

    // Copy .claude.json (full copy - Claude needs various fields to work)
    if (fs.existsSync(realClaudeJson)) {
      try {
        fs.copyFileSync(realClaudeJson, sandboxClaudeJson);
      } catch {
        // Ignore errors
      }
    }

    // Copy .claude/.credentials.json (contains OAuth tokens)
    // Credentials are cleaned up when Claude exits (see child.on('exit') handler)
    if (fs.existsSync(realCredentials)) {
      try {
        fs.copyFileSync(realCredentials, sandboxCredentialsPath);
      } catch {
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
  let watchdogId: ReturnType<typeof setTimeout> | null = null;
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
        if (jsonLogStream) jsonLogStream.write(msg);
        if (filteredLogStream) filteredLogStream.write(msg);
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
  const writeFiltered = (text: string): void => {
    process.stdout.write(text + '\n');
    if (filteredLogStream) filteredLogStream.write(text + '\n');
  };

  /**
   * Process buffered data:
   * - Raw JSON → jsonLogStream (post-mortem)
   * - Filtered → stdout + filteredLogStream
   */
  const processData = (data: Buffer): void => {
    resetWatchdog();  // Activity detected

    // Raw data goes to JSON log file (post-mortem)
    if (jsonLogStream) jsonLogStream.write(data);

    // If custom handler, pass raw data
    if (onStdout) {
      onStdout(data);
      return;
    }

    // Buffer and process line by line for filtered output
    lineBuffer += data.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';  // Keep incomplete line in buffer

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
    if (jsonLogStream) jsonLogStream.write(data);
    if (filteredLogStream) filteredLogStream.write(data);
    // Stderr always goes through (errors are important)
    if (onStderr) {
      onStderr(data);
    } else {
      process.stderr.write(data);
    }
  });

  // Handle timeout (absolute timeout, independent of watchdog)
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (timeout && timeout > 0) {
    timeoutId = setTimeout(() => {
      const msg = `\n=== TIMEOUT after ${timeout}s ===\n`;
      if (jsonLogStream) jsonLogStream.write(msg);
      if (filteredLogStream) filteredLogStream.write(msg);
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
    if (timeoutId) clearTimeout(timeoutId);
    if (watchdogId) clearTimeout(watchdogId);

    // Cleanup sandbox credentials (security: don't leave OAuth tokens lying around)
    if (sandboxCredentialsPath) {
      try {
        if (fs.existsSync(sandboxCredentialsPath)) fs.unlinkSync(sandboxCredentialsPath);
      } catch {
        // Ignore cleanup errors
      }
    }

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
    logFile: filteredLogFile,   // .log (filtered, like stdout)
    jsonLogFile                  // .jsonlog (raw JSON for post-mortem)
  };
}
