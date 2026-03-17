#!/usr/bin/env node
/**
 * Rudder MCP Server CLI Entry Point
 *
 * Wrapper around mcp/agent-server.js with project detection.
 * Uses the same project detection logic as rudder CLI.
 *
 * Usage:
 *   rdrctl                     # Start server (daemon, default)
 *   rdrctl start               # Start server (daemon)
 *   rdrctl start -f            # Start server (foreground)
 *   rdrctl status              # Check if running
 *   rdrctl stop                # Stop server
 *   rdrctl restart             # Stop + start server
 *   rdrctl --socket /path      # Custom socket path
 *   rdrctl --port 9999         # TCP mode
 *
 * Project detection (same as rudder):
 *   1. --root flag
 *   2. SAILING_PROJECT environment variable
 *   3. Walk up from script location
 *   4. Walk up from current directory
 */

import { errorMessage } from './lib/errors.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { execaSync } from 'execa';
import net from 'net';
import { setScriptDir, setProjectRoot, findProjectRoot, getPath } from './managers/core-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set script dir for project detection
setScriptDir(__dirname);

// Parse args
const args = process.argv.slice(2);
let projectRootArg: string | null = null;
let command = 'start';  // Default command
let foreground = false;  // Default: daemon mode
let customSocket: string | null = null;
let usePort = false;
const passArgs: string[] = [];

const commands = new Set(['start', 'status', 'stop', 'restart', 'log']);
let skipNext = false;

for (let i = 0; i < args.length; i++) {
  if (skipNext) {
    skipNext = false;
    continue;
  }

  const arg = args[i];
  const next: string | undefined = args[i + 1];

  if (commands.has(arg)) {
    command = arg;
  } else if (arg === '--root' && next) {
    projectRootArg = next;
    skipNext = true;
  } else if (arg === '-f' || arg === '--foreground') {
    foreground = true;
  } else if (arg === '--socket' && next) {
    customSocket = next;
    skipNext = true;
    passArgs.push('--socket', customSocket);
  } else if (arg === '--port') {
    usePort = true;
    passArgs.push(arg);
  } else if (arg === '-h' || arg === '--help') {
    showHelp();
    process.exit(0);
  } else {
    passArgs.push(arg);
  }
}

function showHelp() {
  console.log(`Rudder MCP Server

Usage:
  rdrctl [command] [options]

Commands:
  start     Start MCP server (default, daemon mode)
  restart   Stop and start server
  status    Check if server is running
  stop      Stop MCP server
  log       Tail MCP server logs (tail -f)

Options:
  -f, --foreground   Run in foreground (default: daemon)
  --socket PATH      Custom socket path
  --port PORT        Use TCP port instead of socket
  --root PATH        Project root path
  -h, --help         Show this help

Examples:
  rdrctl               # Start as daemon (default)
  rdrctl start         # Same as above
  rdrctl start -f      # Start in foreground
  rdrctl restart       # Stop + start
  rdrctl status        # Check status
  rdrctl stop          # Stop server
  rdrctl log           # Tail logs
`);
}

// Set project root if provided
if (projectRootArg) {
  setProjectRoot(projectRootArg);
} else if (process.env.SAILING_PROJECT) {
  setProjectRoot(process.env.SAILING_PROJECT);
}

// Find project root
const projectRoot = findProjectRoot();
if (!projectRoot) {
  console.error('Error: Could not find project root');
  console.error('Run from a project with .sailing/ or set SAILING_PROJECT');
  process.exit(1);
}

// Get haven path and config
import { getAgentConfig } from './managers/core-manager.js';

const havenPath = getPath('haven');
if (!havenPath) {
  console.error('Error: Could not determine haven path');
  process.exit(1);
}
const agentConfig = getAgentConfig();
const mcpMode = usePort ? 'port' : (agentConfig.mcp_mode || 'socket');
const defaultSocket = customSocket || path.join(havenPath, 'mcp.sock');
const portFile = path.join(havenPath, 'mcp.port');
const pidFile = path.join(havenPath, 'mcp.pid');

interface ServerStatus {
  running: boolean;
  pid?: number;
  mode?: string;
  port?: number | null;
  socket?: string | null;
}

/**
 * Safely remove a file, ignoring errors if it doesn't exist.
 */
function safeUnlink(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

/**
 * Clean up all MCP state files.
 */
function cleanupStateFiles(): void {
  safeUnlink(pidFile);
  safeUnlink(defaultSocket);
  safeUnlink(portFile);
}

/**
 * Verify that the given port is owned by the given PID.
 * Returns true if ownership confirmed, false otherwise.
 */
function verifyPortOwnership(port: number, pid: number): boolean {
  try {
    const { stdout, exitCode } = execaSync('lsof', ['-i', `:${port}`, '-t'], { reject: false });
    if (exitCode !== 0 || !stdout.trim()) {
      return false;
    }
    const portPids = stdout.trim().split('\n').map(p => parseInt(p, 10));
    return portPids.includes(pid);
  } catch {
    return false;
  }
}

/**
 * Check if server is running
 * Checks both socket and port mode
 * Verifies port is actually our MCP by checking the process
 */
function getServerStatus(): ServerStatus {
  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 0);  // Signal 0 = check if process exists

    // Determine mode from existing files
    let mode = 'socket';
    let port: number | null = null;
    let socket: string | null = null;

    if (fs.existsSync(portFile)) {
      mode = 'port';
      port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);

      if (!verifyPortOwnership(port, pid)) {
        safeUnlink(pidFile);
        safeUnlink(portFile);
        return { running: false };
      }
    } else if (fs.existsSync(defaultSocket)) {
      socket = defaultSocket;
    }

    return { running: true, pid, mode, port, socket };
  } catch {
    // Process not running, clean up stale files
    cleanupStateFiles();
    return { running: false };
  }
}

/**
 * Find an available port in the configured range
 * @returns {Promise<number>} Available port
 */
async function findAvailablePort() {
  const portRange = agentConfig.mcp_port_range || '9100-9199';
  const [minPort, maxPort] = portRange.split('-').map(p => parseInt(p, 10));

  for (let port = minPort; port <= maxPort; port++) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });

    if (available) {
      return port;
    }
  }

  throw new Error(`No available port in range ${portRange}`);
}

/**
 * Handle status command
 */
function handleStatus() {
  const status = getServerStatus();

  if (status.running) {
    console.log(`MCP server running (pid: ${status.pid})`);
    if (status.mode === 'port') {
      console.log(`  Port: ${status.port}`);
    } else {
      console.log(`  Socket: ${status.socket || defaultSocket}`);
    }
    console.log(`  Mode: ${status.mode}`);
    console.log(`  Project: ${projectRoot}`);
    process.exit(0);
  } else {
    console.log('MCP server not running');
    process.exit(1);
  }
}

/**
 * Wait for a process to terminate, using SIGKILL if needed.
 */
function waitForProcessExit(pid: number): void {
  const start = Date.now();
  while (Date.now() - start < 2000) {
    try {
      process.kill(pid, 0);
      spawnSync('sleep', ['0.1'], { stdio: 'ignore' });
    } catch {
      return; // Process gone
    }
  }
  // Still running after timeout, try SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
    spawnSync('sleep', ['0.5'], { stdio: 'ignore' });
  } catch {
    // Already dead
  }
}

/**
 * Stop the server (internal, no exit)
 * @returns {boolean} true if stopped, false if not running
 */
function stopServer(): boolean {
  const status = getServerStatus();

  if (!status.running || !status.pid) {
    return false;
  }

  const pid = status.pid;

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped MCP server (pid: ${pid})`);
    cleanupStateFiles();
    waitForProcessExit(pid);
    return true;
  } catch (e: unknown) {
    console.error(`Failed to stop server: ${errorMessage(e)}`);
    return false;
  }
}

/**
 * Handle stop command
 */
function handleStop() {
  const stopped = stopServer();
  if (!stopped) {
    console.log('MCP server not running');
  }
  process.exit(0);
}

/**
 * Start the MCP server in foreground mode.
 */
function startForeground(mcpServerPath: string, finalArgs: string[], usePortMode: boolean): void {
  console.log(`Starting agent MCP server...`);
  console.log(`  Mode: ${usePortMode ? 'port' : 'socket'}`);
  if (!usePortMode) console.log(`  Socket: ${defaultSocket}`);
  console.log(`  Project: ${projectRoot}`);
  console.log('');

  const child = spawn('node', [mcpServerPath, ...finalArgs], {
    stdio: 'inherit',
    cwd: projectRoot
  });

  child.on('error', (err: Error) => {
    console.error(`Failed to start MCP server: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code: number | null) => {
    process.exit(code || 0);
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

/**
 * Start the MCP server in daemon (detached) mode.
 */
function startDaemon(
  mcpServerPath: string, finalArgs: string[],
  logFile: string, usePortMode: boolean, allocatedPort: number | null
): void {
  const out = fs.openSync(logFile, 'a');
  const errFd = fs.openSync(logFile, 'a');

  const child = spawn('node', [mcpServerPath, ...finalArgs], {
    detached: true,
    stdio: ['ignore', out, errFd],
    cwd: projectRoot
  });

  setTimeout(() => {
    fs.writeFileSync(pidFile, String(child.pid));

    if (usePortMode) {
      fs.writeFileSync(portFile, String(allocatedPort));
      console.log(`Rudder MCP server started (pid: ${child.pid})`);
      console.log(`  Port: ${allocatedPort}`);
      console.log(`  Mode: port`);
      console.log(`  Log: ${logFile}`);
    } else if (fs.existsSync(defaultSocket)) {
      console.log(`Rudder MCP server started (pid: ${child.pid})`);
      console.log(`  Socket: ${defaultSocket}`);
      console.log(`  Mode: socket`);
      console.log(`  Log: ${logFile}`);
    } else {
      console.log(`Rudder MCP server starting (pid: ${child.pid})`);
      console.log(`  Check log: ${logFile}`);
    }

    child.unref();
    process.exit(0);
  }, 500);
}

/**
 * Log the status of an already-running server and exit.
 */
function reportAlreadyRunning(status: ServerStatus): void {
  console.log(`MCP server already running (pid: ${status.pid})`);
  if (status.mode === 'port') {
    console.log(`  Port: ${status.port}`);
  } else {
    console.log(`  Socket: ${status.socket || defaultSocket}`);
  }
  process.exit(0);
}

/**
 * Handle start command
 */
async function handleStart() {
  const status = getServerStatus();

  if (status.running) {
    reportAlreadyRunning(status);
  }

  // Build final args based on mode
  const finalArgs: string[] = [];
  const usePortMode = mcpMode === 'port';
  let allocatedPort: number | null = null;

  if (usePortMode) {
    try {
      allocatedPort = await findAvailablePort();
      finalArgs.push('--port', String(allocatedPort));
    } catch (e: unknown) {
      console.error(`Failed to find available port: ${errorMessage(e)}`);
      process.exit(1);
    }
  } else if (!passArgs.includes('--socket')) {
    finalArgs.push('--socket', defaultSocket);
  }

  if (!passArgs.includes('--project-root')) {
    finalArgs.push('--project-root', projectRoot);
  }

  finalArgs.push(...passArgs);

  const mcpServerPath = path.resolve(__dirname, '../mcp/agent-server.js');
  const logFile = path.join(havenPath, 'mcp.log');

  if (foreground) {
    startForeground(mcpServerPath, finalArgs, usePortMode);
  } else {
    startDaemon(mcpServerPath, finalArgs, logFile, usePortMode, allocatedPort);
  }
}

/**
 * Handle log command
 */
function handleLog() {
  const logFile = path.join(havenPath, 'mcp.log');

  if (!fs.existsSync(logFile)) {
    console.error(`Log file not found: ${logFile}`);
    console.error('Start the MCP server first: rdrctl start');
    process.exit(1);
  }

  console.log(`Tailing ${logFile} (Ctrl+C to stop)\n`);

  const child = spawn('tail', ['-f', logFile], {
    stdio: 'inherit'
  });

  child.on('error', (err) => {
    console.error(`Failed to tail log: ${err.message}`);
    process.exit(1);
  });

  // Forward signals
  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
    process.exit(0);
  });
}

// Execute command
switch (command) {
  case 'status':
    handleStatus();
    break;
  case 'stop':
    handleStop();
    break;
  case 'restart':
    stopServer();
    void handleStart();
    break;
  case 'log':
    handleLog();
    break;
  case 'start':
  default:
    void handleStart();
    break;
}
