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
import { spawn } from 'child_process';
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
  if (arg === 'start' || arg === 'status' || arg === 'stop') {
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

// Get haven path
const havenPath = getPath('haven');
const defaultSocket = customSocket || path.join(havenPath, 'mcp.sock');
const pidFile = path.join(havenPath, 'mcp.pid');

/**
 * Check if server is running
 */
function getServerStatus() {
  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 0);  // Signal 0 = check if process exists
    return { running: true, pid };
  } catch (e) {
    // Process not running, clean up stale files
    try { fs.unlinkSync(pidFile); } catch {}
    try { fs.unlinkSync(defaultSocket); } catch {}
    return { running: false };
  }
}

/**
 * Handle status command
 */
function handleStatus() {
  const status = getServerStatus();

  if (status.running) {
    console.log(`MCP server running (pid: ${status.pid})`);
    console.log(`  Socket: ${defaultSocket}`);
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

    // Wait a bit and clean up
    setTimeout(() => {
      try { fs.unlinkSync(pidFile); } catch {}
      try { fs.unlinkSync(defaultSocket); } catch {}
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
function handleStart() {
  const status = getServerStatus();

  if (status.running) {
    console.log(`MCP server already running (pid: ${status.pid})`);
    console.log(`  Socket: ${defaultSocket}`);
    process.exit(0);
  }

  // Build final args
  const finalArgs = [];

  // Add socket if not using port
  if (!usePort && !passArgs.includes('--socket')) {
    finalArgs.push('--socket', defaultSocket);
  }

  // Add project root
  if (!passArgs.includes('--project-root')) {
    finalArgs.push('--project-root', projectRoot);
  }

  finalArgs.push(...passArgs);

  // Find MCP server
  const mcpServerPath = path.resolve(__dirname, '../mcp/rudder-server.js');

  if (foreground) {
    // Foreground mode
    console.log(`Starting MCP server...`);
    console.log(`  Socket: ${defaultSocket}`);
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
    // Daemon mode (default): detach and write PID
    const logFile = path.join(havenPath, 'mcp.log');
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const child = spawn('node', [mcpServerPath, ...finalArgs], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: projectRoot
    });

    // Wait briefly for startup
    setTimeout(() => {
      if (fs.existsSync(defaultSocket) || fs.existsSync(pidFile)) {
        console.log(`MCP server started (pid: ${child.pid})`);
        console.log(`  Socket: ${defaultSocket}`);
        console.log(`  Log: ${logFile}`);
      } else {
        console.log(`MCP server starting (pid: ${child.pid})`);
        console.log(`  Check log: ${logFile}`);
      }
      child.unref();
      process.exit(0);
    }, 500);
  }
}

// Execute command
switch (command) {
  case 'status':
    handleStatus();
    break;
  case 'stop':
    handleStop();
    break;
  case 'start':
  default:
    handleStart();
    break;
}
