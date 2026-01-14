#!/usr/bin/env node
/**
 * Rudder MCP Server CLI Entry Point
 *
 * Wrapper around mcp/rudder-server.js with project detection.
 * Uses the same project detection logic as rudder CLI.
 *
 * Usage:
 *   rudder-mcp                     # Start server (daemon, default)
 *   rudder-mcp start               # Start server (daemon)
 *   rudder-mcp start -f            # Start server (foreground)
 *   rudder-mcp status              # Check if running
 *   rudder-mcp stop                # Stop server
 *   rudder-mcp --socket /path      # Custom socket path
 *   rudder-mcp --port 9999         # TCP mode
 *
 * Project detection (same as rudder):
 *   1. --root flag
 *   2. SAILING_PROJECT environment variable
 *   3. Walk up from script location
 *   4. Walk up from current directory
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import net from 'net';
import { setScriptDir, setProjectRoot, findProjectRoot, getPath } from './lib/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set script dir for project detection
setScriptDir(__dirname);

// Parse args
const args = process.argv.slice(2);
let projectRootArg = null;
let command = 'start';  // Default command
let foreground = false;  // Default: daemon mode
let customSocket = null;
let usePort = false;
const passArgs = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  // Commands
  if (arg === 'start' || arg === 'status' || arg === 'stop' || arg === 'log') {
    command = arg;
  }
  // Options
  else if (arg === '--root' && args[i + 1]) {
    projectRootArg = args[++i];
  } else if (arg === '-f' || arg === '--foreground') {
    foreground = true;
  } else if (arg === '--socket' && args[i + 1]) {
    customSocket = args[++i];
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
  rudder-mcp [command] [options]

Commands:
  start     Start MCP server (default, daemon mode)
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
  rudder-mcp               # Start as daemon (default)
  rudder-mcp start         # Same as above
  rudder-mcp start -f      # Start in foreground
  rudder-mcp status        # Check status
  rudder-mcp stop          # Stop server
  rudder-mcp log           # Tail logs
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
import { getAgentConfig } from './lib/config.js';

const havenPath = getPath('haven');
const agentConfig = getAgentConfig();
const mcpMode = usePort ? 'port' : (agentConfig.mcp_mode || 'socket');
const defaultSocket = customSocket || path.join(havenPath, 'mcp.sock');
const portFile = path.join(havenPath, 'mcp.port');
const pidFile = path.join(havenPath, 'mcp.pid');

/**
 * Check if server is running
 * Checks both socket and port mode
 * Verifies port is actually our MCP by checking the process
 */
function getServerStatus() {
  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 0);  // Signal 0 = check if process exists

    // Determine mode from existing files
    let mode = 'socket';
    let port = null;
    let socket = null;

    if (fs.existsSync(portFile)) {
      mode = 'port';
      port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);

      // Verify the port is actually in use by our PID
      // This prevents stale port files from misleading us
      try {
        const lsof = execSync(`lsof -i :${port} -t 2>/dev/null`, { encoding: 'utf8' }).trim();
        const portPids = lsof.split('\n').map(p => parseInt(p, 10));
        if (!portPids.includes(pid)) {
          // Port is no longer used by our process, clean up
          throw new Error('Port not owned by MCP');
        }
      } catch (e) {
        // lsof failed or port not owned - clean up and report not running
        try { fs.unlinkSync(pidFile); } catch {}
        try { fs.unlinkSync(portFile); } catch {}
        return { running: false };
      }
    } else if (fs.existsSync(defaultSocket)) {
      socket = defaultSocket;
    }

    return { running: true, pid, mode, port, socket };
  } catch (e) {
    // Process not running, clean up stale files
    try { fs.unlinkSync(pidFile); } catch {}
    try { fs.unlinkSync(defaultSocket); } catch {}
    try { fs.unlinkSync(portFile); } catch {}
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
 * Handle stop command
 */
function handleStop() {
  const status = getServerStatus();

  if (!status.running) {
    console.log('MCP server not running');
    process.exit(0);
  }

  try {
    process.kill(status.pid, 'SIGTERM');
    console.log(`Stopped MCP server (pid: ${status.pid})`);

    // Wait a bit and clean up all possible files
    setTimeout(() => {
      try { fs.unlinkSync(pidFile); } catch {}
      try { fs.unlinkSync(defaultSocket); } catch {}
      try { fs.unlinkSync(portFile); } catch {}
    }, 500);

    process.exit(0);
  } catch (e) {
    console.error(`Failed to stop server: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Handle start command
 */
async function handleStart() {
  const status = getServerStatus();

  if (status.running) {
    console.log(`MCP server already running (pid: ${status.pid})`);
    if (status.mode === 'port') {
      console.log(`  Port: ${status.port}`);
    } else {
      console.log(`  Socket: ${status.socket || defaultSocket}`);
    }
    process.exit(0);
  }

  // Build final args based on mode
  const finalArgs = [];
  const usePortMode = mcpMode === 'port';
  let allocatedPort = null;

  if (usePortMode) {
    // Port mode: find available port in range
    try {
      allocatedPort = await findAvailablePort();
      finalArgs.push('--port', String(allocatedPort));
    } catch (e) {
      console.error(`Failed to find available port: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Socket mode (default)
    if (!passArgs.includes('--socket')) {
      finalArgs.push('--socket', defaultSocket);
    }
  }

  // Add project root
  if (!passArgs.includes('--project-root')) {
    finalArgs.push('--project-root', projectRoot);
  }

  finalArgs.push(...passArgs);

  // Find MCP server
  const mcpServerPath = path.resolve(__dirname, '../mcp/rudder-server.js');
  const logFile = path.join(havenPath, 'mcp.log');

  if (foreground) {
    // Foreground mode
    console.log(`Starting MCP server...`);
    console.log(`  Mode: ${usePortMode ? 'port' : 'socket'}`);
    if (!usePortMode) console.log(`  Socket: ${defaultSocket}`);
    console.log(`  Project: ${projectRoot}`);
    console.log('');

    const child = spawn('node', [mcpServerPath, ...finalArgs], {
      stdio: 'inherit',
      cwd: projectRoot
    });

    child.on('error', (err) => {
      console.error(`Failed to start MCP server: ${err.message}`);
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });

    // Forward signals
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
  } else {
    // Daemon mode (default): detach
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const child = spawn('node', [mcpServerPath, ...finalArgs], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: projectRoot
    });

    // Wait briefly for startup, then check and report
    setTimeout(() => {
      // Write PID file
      fs.writeFileSync(pidFile, String(child.pid));

      if (usePortMode) {
        // Port mode: write port file
        fs.writeFileSync(portFile, String(allocatedPort));
        console.log(`Rudder MCP server started (pid: ${child.pid})`);
        console.log(`  Port: ${allocatedPort}`);
        console.log(`  Mode: port`);
        console.log(`  Log: ${logFile}`);
      } else {
        // Socket mode
        if (fs.existsSync(defaultSocket)) {
          console.log(`Rudder MCP server started (pid: ${child.pid})`);
          console.log(`  Socket: ${defaultSocket}`);
          console.log(`  Mode: socket`);
          console.log(`  Log: ${logFile}`);
        } else {
          console.log(`Rudder MCP server starting (pid: ${child.pid})`);
          console.log(`  Check log: ${logFile}`);
        }
      }
      child.unref();
      process.exit(0);
    }, 500);
  }
}

/**
 * Handle log command
 */
function handleLog() {
  const logFile = path.join(havenPath, 'mcp.log');

  if (!fs.existsSync(logFile)) {
    console.error(`Log file not found: ${logFile}`);
    console.error('Start the MCP server first: rudder-mcp start');
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
  case 'log':
    handleLog();
    break;
  case 'start':
  default:
    handleStart();
    break;
}
