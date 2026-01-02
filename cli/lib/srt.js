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
 * @param {string} havenDir - Haven directory
 * @returns {{ running: boolean, socket?: string, pid?: number }}
 */
export function checkMcpServer(havenDir) {
  const socketPath = path.join(havenDir, 'mcp.sock');
  const pidFile = path.join(havenDir, 'mcp.pid');

  if (!fs.existsSync(socketPath) || !fs.existsSync(pidFile)) {
    return { running: false };
  }

  // Check if PID is still running
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 0); // Signal 0 = check if process exists
    return { running: true, socket: socketPath, pid };
  } catch (e) {
    // Process not running, clean up stale files
    try { fs.unlinkSync(socketPath); } catch {}
    try { fs.unlinkSync(pidFile); } catch {}
    return { running: false };
  }
}

/**
 * Start external MCP server (outside sandbox)
 * Uses Unix socket at haven level (shared by all agents).
 * Automatically reuses existing server if already running.
 *
 * @param {object} options - Options
 * @param {string} options.havenDir - Haven directory (socket lives here)
 * @param {string} options.projectRoot - Project root path
 * @returns {Promise<{ socket: string, pid: number, mcpServerPath: string, reused: boolean }>}
 */
export async function startExternalMcpServer(options) {
  const { havenDir, projectRoot } = options;

  // Check if already running
  const existing = checkMcpServer(havenDir);
  if (existing.running) {
    return {
      socket: existing.socket,
      pid: existing.pid,
      mcpServerPath: findMcpServerPath(projectRoot),
      reused: true
    };
  }

  const mcpServerPath = findMcpServerPath(projectRoot);
  const socketPath = path.join(havenDir, 'mcp.sock');

  return new Promise((resolve, reject) => {
    const child = spawn('node', [
      mcpServerPath,
      '--socket', socketPath,
      '--project-root', projectRoot
    ], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true  // Run independently of parent
    });

    // Wait for the server to output the socket path (confirmation it started)
    let startupOutput = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('MCP server startup timeout'));
    }, 5000);

    child.stdout.on('data', (data) => {
      startupOutput += data.toString();
      if (startupOutput.includes(socketPath)) {
        clearTimeout(timeout);
        // Unref so parent can exit independently
        child.unref();

        // Save PID to file
        const pidFile = path.join(havenDir, 'mcp.pid');
        fs.writeFileSync(pidFile, String(child.pid));

        resolve({
          socket: socketPath,
          pid: child.pid,
          mcpServerPath,
          reused: false
        });
      }
    });

    child.stderr.on('data', (data) => {
      // Log to stderr for debugging
      process.stderr.write(`[MCP] ${data}`);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`MCP server exited with code ${code}`));
      }
    });
  });
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
  } else if (externalPort) {
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

/**
 * Load base srt config from file or generate defaults
 * @param {string} [configPath] - Path to existing config
 * @returns {object} SRT configuration
 */
export function loadBaseSrtConfig(configPath) {
  if (configPath && fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      // Fall through to defaults
    }
  }

  const homeDir = os.homedir();
  return {
    network: {
      allowedDomains: [
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
 * @param {boolean} [options.strictMode=false] - If true, ONLY allow /tmp + additionalWritePaths (ignore base config paths)
 * @returns {string} Path to generated config
 */
export function generateSrtConfig(options) {
  const { baseConfigPath, outputPath, additionalWritePaths = [], strictMode = false } = options;

  const config = loadBaseSrtConfig(baseConfigPath);

  if (strictMode) {
    // Strict mode: only essential paths + explicitly provided paths
    // This is for worktree agents that should be sandboxed to their worktree
    const homeDir = os.homedir();
    config.filesystem.allowWrite = [
      '/tmp',                         // Temp files
      `${homeDir}/.claude`,           // Claude session data (required)
      `${homeDir}/.claude.json`,      // Claude config (required)
      `${homeDir}/.cache/claude-cli-nodejs`  // Claude cache (required)
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
 * @returns {{ process: ChildProcess, pid: number, logFile?: string }}
 */
export function spawnClaudeWithSrt(options) {
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
    sandboxHome
  } = options;

  // Build claude args
  const claudeArgs = [];

  if (riskyMode) {
    claudeArgs.push('--dangerously-skip-permissions');
  }

  // Add MCP config for agent (restricted to specific MCP servers only)
  if (mcpConfigPath) {
    claudeArgs.push('--mcp-config', mcpConfigPath);
    claudeArgs.push('--strict-mcp-config');  // Only use specified MCP servers
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
  } else {
    command = 'claude';
    finalArgs = claudeArgs;
  }

  // Setup log stream if logFile provided
  let logStream = null;
  if (logFile) {
    ensureDir(path.dirname(logFile));
    logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const startTime = new Date().toISOString();
    logStream.write(`\n=== Claude Started: ${startTime} ===\n`);
    logStream.write(`CWD: ${cwd}\n`);
    logStream.write(`Command: ${command} ${finalArgs.join(' ')} (prompt via stdin)\n`);
    logStream.write(`Sandbox: ${sandbox ? 'enabled' : 'disabled'}\n`);
    if (srtConfigPath) {
      logStream.write(`SRT Config: ${srtConfigPath}\n`);
    }
    if (mcpConfigPath) {
      logStream.write(`MCP Config: ${mcpConfigPath}\n`);
    }
    logStream.write('='.repeat(50) + '\n\n');
  }

  // Prepare environment
  const spawnEnv = { ...process.env };
  if (debug) spawnEnv.SRT_DEBUG = '1';

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
      } catch {
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
            if (fs.existsSync(sandboxCredentials)) fs.unlinkSync(sandboxCredentials);
          } catch {
            // Ignore cleanup errors
          }
        }, 5000);
      } catch {
        // Ignore errors
      }
    }

    if (logStream) {
      logStream.write(`Sandbox HOME: ${sandboxHome}\n`);
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

  // Handle stdout (tee mode: log + custom handler or console)
  child.stdout.on('data', (data) => {
    if (logStream) logStream.write(data);
    if (onStdout) {
      onStdout(data);
    } else {
      process.stdout.write(data);
    }
  });

  // Handle stderr (tee mode: log + custom handler or console)
  child.stderr.on('data', (data) => {
    if (logStream) logStream.write(data);
    if (onStderr) {
      onStderr(data);
    } else {
      process.stderr.write(data);
    }
  });

  // Handle timeout
  let timeoutId = null;
  if (timeout && timeout > 0) {
    timeoutId = setTimeout(() => {
      if (logStream) logStream.write(`\n=== TIMEOUT after ${timeout}s ===\n`);
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
    if (logStream) {
      const endTime = new Date().toISOString();
      logStream.write(`\n=== Claude Exited: ${endTime} ===\n`);
      logStream.write(`Exit code: ${code}, Signal: ${signal}\n`, () => {
        logStream.end();
      });
    }
  });

  return {
    process: child,
    pid: child.pid,
    logFile
  };
}
