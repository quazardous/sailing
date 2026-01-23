#!/usr/bin/env node
/**
 * Rudder Control (rdrctl) - Service manager for Sailing
 *
 * Like systemctl but for Sailing services:
 *   - mcp: Start MCP servers (conductor + optionally agent)
 *   - agents: MCP server for sandbox agents (stdio)
 *   - conductor: MCP server for orchestrator (stdio)
 *   - dashboard: Web dashboard (HTTP + WebSocket)
 *   - serve: Full conductor server (dashboard + WebSocket + MCP)
 *
 * Usage:
 *   rdrctl start [options]           # Start MCP servers based on config
 *   rdrctl start <service> [options] # Start specific service
 *   rdrctl stop <service>
 *   rdrctl status [service]
 *   rdrctl list
 */

import { Command } from 'commander';
import { fork, ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createConductorServer } from './conductor/server.js';
import { createServer as createDashboardServer } from './dashboard/server.js';
import { createRoutes } from './dashboard/routes.js';
import { getAgentConfig } from './managers/config-manager.js';
import { getPath, findProjectRoot, setProjectRoot, setScriptDir } from './managers/core-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set script directory for project root detection (same pattern as rudder.ts)
setScriptDir(import.meta.dirname);

// Check for SAILING_PROJECT environment variable (set by bin/rdrctl wrapper)
if (process.env.SAILING_PROJECT) {
  setProjectRoot(process.env.SAILING_PROJECT);
}

const program = new Command();

// Default configuration
const DEFAULT_PORT = 3456;
const DEFAULT_TIMEOUT = 300;
const DEFAULT_CACHE = 300;

// Service definitions
const SERVICES = {
  mcp: {
    name: 'mcp',
    description: 'MCP servers (conductor + agent if subprocess mode)',
    start: startMcpServices
  },
  agents: {
    name: 'agents',
    description: 'MCP server for sandbox agents (stdio)',
    start: startAgentsService
  },
  conductor: {
    name: 'conductor',
    description: 'MCP server for orchestrator (stdio)',
    start: startConductorMcpService
  },
  dashboard: {
    name: 'dashboard',
    description: 'Web dashboard (HTTP + WebSocket)',
    start: startDashboardService
  },
  serve: {
    name: 'serve',
    description: 'Full conductor server (dashboard + WebSocket + MCP)',
    start: startServeService
  }
};

// MCP state file for client discovery
interface McpState {
  conductor?: { socket?: string; port?: number; pid?: number };
  agent?: { socket?: string; port?: number; pid?: number };
  pid: number;  // Main PID (conductor) for quick status check
  startedAt: string;
}

type ServiceName = keyof typeof SERVICES;

// ============================================================================
// Service implementations
// ============================================================================

/**
 * Start MCP servers based on config (daemonized)
 * - Always starts conductor MCP
 * - Starts agent MCP only if use_subprocess is enabled
 * - Uses socket transport by default (configurable via mcp_mode)
 * - Runs as daemon (detached), returns immediately
 */
async function startMcpServices(options: Record<string, unknown>) {
  const config = getAgentConfig();
  const haven = getPath('haven');
  const projectRoot = findProjectRoot();
  const foreground = options.foreground as boolean;

  if (!haven) {
    console.error('[rdrctl] Cannot determine haven path');
    process.exit(1);
  }

  // Check if already running
  const stateFile = path.join(haven, 'mcp-state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state: McpState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      // Check if process is still alive
      try {
        process.kill(state.pid, 0);

        // Check if config has changed
        const agentExpected = config.use_subprocess;
        const agentRunning = !!state.agent;

        if (agentExpected !== agentRunning) {
          console.log(`[rdrctl] MCP servers running but config changed:`);
          console.log(`  - use_subprocess: ${agentExpected} (config) vs ${agentRunning} (running)`);
          console.log('[rdrctl] Use "rdrctl restart" to apply new config');
          process.exit(1);
        }

        console.log(`[rdrctl] MCP servers already running (pid ${state.pid})`);
        console.log('[rdrctl] Use "rdrctl stop" first, or "rdrctl restart"');
        process.exit(1);
      } catch {
        // Process dead, clean up stale state
        fs.unlinkSync(stateFile);
      }
    } catch {
      // Corrupted state file, remove it
      fs.unlinkSync(stateFile);
    }
  }

  // Ensure haven directory exists
  fs.mkdirSync(haven, { recursive: true });

  // Use CLI option if provided, otherwise config, otherwise default to socket
  const mcpMode = (options.mcpMode as string) || config.mcp_mode || 'socket';
  const portRange = config.mcp_port_range || '9100-9199';
  const [portStart] = portRange.split('-').map(Number);

  // Determine transport args based on config
  const getTransportArgs = (service: 'conductor' | 'agent', offset: number): string[] => {
    if (mcpMode === 'port') {
      const port = portStart + offset;
      return ['--port', String(port)];
    } else {
      const socketPath = path.join(haven, `mcp-${service}.sock`);
      // Remove stale socket
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
      return ['--socket', socketPath];
    }
  };

  // Prepare log files
  const conductorLog = path.join(haven, 'mcp-conductor.log');
  const agentLog = path.join(haven, 'mcp-agent.log');

  // Build state object
  const mcpState: McpState = {
    pid: 0, // Will be set after spawn
    startedAt: new Date().toISOString()
  };

  const pids: number[] = [];

  // Start conductor MCP
  console.log('[rdrctl] Starting MCP conductor...');
  const conductorArgs = getTransportArgs('conductor', 0);
  conductorArgs.push('--project-root', projectRoot);

  const mcpConductorPath = path.join(__dirname, 'conductor', 'mcp-conductor.ts');
  const conductorOut = fs.openSync(conductorLog, 'a');
  const conductorChild = spawn('npx', ['tsx', mcpConductorPath, ...conductorArgs], {
    stdio: ['ignore', conductorOut, conductorOut],
    cwd: projectRoot,
    detached: !foreground
  });

  if (conductorChild.pid) {
    pids.push(conductorChild.pid);
    if (!foreground) conductorChild.unref();
  }

  if (mcpMode === 'port') {
    mcpState.conductor = { port: portStart, pid: conductorChild.pid };
    console.log(`[rdrctl] Conductor: port ${portStart} (pid ${conductorChild.pid})`);
  } else {
    mcpState.conductor = { socket: path.join(haven, 'mcp-conductor.sock'), pid: conductorChild.pid };
    console.log(`[rdrctl] Conductor: ${mcpState.conductor.socket} (pid ${conductorChild.pid})`);
  }

  // Start agent MCP only if subprocess mode is enabled
  if (config.use_subprocess) {
    console.log('[rdrctl] Starting MCP agent...');
    const agentArgs = getTransportArgs('agent', 1);
    agentArgs.push('--project-root', projectRoot);

    const mcpAgentPath = path.join(__dirname, 'mcp-agent.ts');
    const agentOut = fs.openSync(agentLog, 'a');
    const agentChild = spawn('npx', ['tsx', mcpAgentPath, ...agentArgs], {
      stdio: ['ignore', agentOut, agentOut],
      cwd: projectRoot,
      detached: !foreground
    });

    if (agentChild.pid) {
      pids.push(agentChild.pid);
      if (!foreground) agentChild.unref();
    }

    if (mcpMode === 'port') {
      mcpState.agent = { port: portStart + 1, pid: agentChild.pid };
      console.log(`[rdrctl] Agent: port ${portStart + 1} (pid ${agentChild.pid})`);
    } else {
      mcpState.agent = { socket: path.join(haven, 'mcp-agent.sock'), pid: agentChild.pid };
      console.log(`[rdrctl] Agent: ${mcpState.agent.socket} (pid ${agentChild.pid})`);
    }
  } else {
    console.log('[rdrctl] Agent: skipped (use_subprocess=false)');
  }

  // Use first PID as main state PID (for status check)
  mcpState.pid = pids[0] || 0;

  // Write MCP state file for client discovery
  fs.writeFileSync(stateFile, JSON.stringify(mcpState, null, 2));

  if (foreground) {
    console.log('[rdrctl] Running in foreground (Ctrl+C to stop)');
    // Wait for exit
    await new Promise<void>((resolve) => {
      conductorChild.on('exit', resolve);
    });
  } else {
    console.log('[rdrctl] MCP servers started (daemonized)');
    console.log(`[rdrctl] Logs: ${conductorLog}`);
    console.log('[rdrctl] Use "rdrctl status" to check, "rdrctl stop" to stop');
  }
}

async function startAgentsService(_options: Record<string, unknown>) {
  // Start MCP server for agents (stdio mode)
  // Fork the mcp-server.ts script and pass through stdio
  console.error('[rdrctl] Starting MCP agents server (stdio)...');

  const mcpServerPath = path.join(__dirname, 'mcp-server.ts');

  // Fork with inherited stdio for MCP protocol
  const child = fork(mcpServerPath, ['start', '-f'], {
    stdio: 'inherit',
    execArgv: ['--import', 'tsx']
  });

  child.on('error', (err) => {
    console.error(`[rdrctl] MCP agents server error: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Forward signals
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  // Keep process alive
  await new Promise(() => {});
}

async function startConductorMcpService(_options: Record<string, unknown>) {
  // Start MCP server for conductor (stdio mode)
  // This exposes all rudder commands via MCP for the orchestrator
  console.error('[rdrctl] Starting MCP conductor server (stdio)...');

  const mcpConductorPath = path.join(__dirname, 'conductor', 'mcp-conductor.ts');

  // Fork with inherited stdio for MCP protocol
  const child = fork(mcpConductorPath, [], {
    stdio: 'inherit',
    execArgv: ['--import', 'tsx']
  });

  child.on('error', (err) => {
    console.error(`[rdrctl] MCP conductor server error: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Forward signals
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  // Keep process alive
  await new Promise(() => {});
}

async function startDashboardService(options: Record<string, unknown>) {
  const port = (options.port as number) || DEFAULT_PORT;
  const timeout = (options.timeout as number) ?? DEFAULT_TIMEOUT;
  const cacheTTL = (options.cache as number) ?? DEFAULT_CACHE;
  const openBrowser = options.open !== false;

  console.log('[rdrctl] Starting dashboard...');

  const routes = createRoutes({ cacheTTL });
  const server = createDashboardServer(port, routes, { timeout });

  setupShutdown(() => {
    server.stop();
  });

  server.start(async (actualPort) => {
    console.log(`[rdrctl] Dashboard: http://127.0.0.1:${actualPort}`);

    if (openBrowser) {
      await openUrl(`http://127.0.0.1:${actualPort}`);
    }
  }, () => process.exit(0));
}

async function startServeService(options: Record<string, unknown>) {
  const port = (options.port as number) || DEFAULT_PORT;
  const timeout = (options.timeout as number) ?? DEFAULT_TIMEOUT;
  const cacheTTL = (options.cache as number) ?? DEFAULT_CACHE;
  const openBrowser = options.open !== false;

  console.log('[rdrctl] Starting conductor server...');

  const server = createConductorServer(port, {
    timeout,
    cacheTTL,
    websocket: true
  });

  setupShutdown(() => {
    server.stop();
  });

  server.start(async (actualPort) => {
    console.log(`[rdrctl] Conductor: http://127.0.0.1:${actualPort}`);
    console.log(`[rdrctl] WebSocket: ws://127.0.0.1:${actualPort}`);

    if (openBrowser) {
      await openUrl(`http://127.0.0.1:${actualPort}`);
    }
  }, () => process.exit(0));
}

// ============================================================================
// Helpers
// ============================================================================

function setupShutdown(cleanup: () => void) {
  process.on('SIGINT', () => {
    console.log('\n[rdrctl] Shutting down...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}

async function openUrl(url: string) {
  const { exec } = await import('child_process');
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32' ? 'start' : 'xdg-open';

  exec(`${cmd} ${url}`, (err) => {
    if (err) {
      console.log(`[rdrctl] Open ${url} in your browser`);
    }
  });
}

// ============================================================================
// CLI Commands
// ============================================================================

program
  .name('rdrctl')
  .description('Rudder Control - Service manager for Sailing')
  .version('1.0.0');

// rdrctl start [service]
program
  .command('start [service]')
  .description('Start a service (default: mcp)')
  .option('-p, --port <port>', 'Port number (dashboard/serve/mcp)', String(DEFAULT_PORT))
  .option('-t, --timeout <seconds>', 'Idle timeout (-1 for infinite)', String(DEFAULT_TIMEOUT))
  .option('-c, --cache <seconds>', 'Cache TTL (0 to disable)', String(DEFAULT_CACHE))
  .option('--no-open', 'Do not open browser')
  .option('--mcp-mode <mode>', 'MCP transport mode: socket or port (default: from config)')
  .option('-f, --foreground', 'Run in foreground (do not daemonize)')
  .action(async (service: string | undefined, options) => {
    // Default to 'mcp' if no service specified
    const serviceName = service || 'mcp';
    const serviceDef = SERVICES[serviceName as ServiceName];

    if (!serviceDef) {
      console.error(`Unknown service: ${serviceName}`);
      console.error('Available services:', Object.keys(SERVICES).join(', '));
      process.exit(1);
    }

    const opts = {
      port: parseInt(options.port, 10),
      timeout: parseInt(options.timeout, 10),
      cache: parseInt(options.cache, 10),
      open: options.open,
      mcpMode: options.mcpMode,
      foreground: options.foreground
    };

    await serviceDef.start(opts);
  });

// rdrctl stop [service]
program
  .command('stop [service]')
  .description('Stop a service (default: mcp)')
  .action((service: string | undefined) => {
    const serviceName = service || 'mcp';

    if (serviceName === 'mcp') {
      const haven = getPath('haven');
      if (!haven) {
        console.error('[rdrctl] Cannot determine haven path');
        process.exit(1);
      }

      const stateFile = path.join(haven, 'mcp-state.json');
      if (!fs.existsSync(stateFile)) {
        console.log('[rdrctl] MCP servers not running');
        process.exit(0);
      }

      try {
        const state: McpState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        const pidsToKill: number[] = [];

        // Collect PIDs
        if (state.conductor?.pid) pidsToKill.push(state.conductor.pid);
        if (state.agent?.pid) pidsToKill.push(state.agent.pid);

        // Kill processes
        for (const pid of pidsToKill) {
          try {
            process.kill(pid, 'SIGTERM');
            console.log(`[rdrctl] Stopped process ${pid}`);
          } catch (e: any) {
            if (e.code !== 'ESRCH') {
              console.error(`[rdrctl] Failed to stop process ${pid}: ${e.message}`);
            }
          }
        }

        // Clean up state file
        fs.unlinkSync(stateFile);

        // Clean up sockets
        if (state.conductor?.socket && fs.existsSync(state.conductor.socket)) {
          fs.unlinkSync(state.conductor.socket);
        }
        if (state.agent?.socket && fs.existsSync(state.agent.socket)) {
          fs.unlinkSync(state.agent.socket);
        }

        console.log('[rdrctl] MCP servers stopped');
      } catch (e: any) {
        console.error(`[rdrctl] Error stopping MCP: ${e.message}`);
        process.exit(1);
      }
    } else {
      console.log(`[rdrctl] Stop not implemented for service: ${serviceName}`);
      console.log('Use Ctrl+C to stop foreground services.');
      process.exit(1);
    }
  });

// rdrctl status [service]
program
  .command('status [service]')
  .description('Show service status')
  .option('-p, --port <port>', 'Port to check', String(DEFAULT_PORT))
  .action(async (service: string | undefined, options) => {
    const port = parseInt(options.port, 10);

    // Check MCP servers status
    if (service === 'mcp' || !service) {
      const haven = getPath('haven');
      if (haven) {
        const stateFile = path.join(haven, 'mcp-state.json');
        if (fs.existsSync(stateFile)) {
          try {
            const state: McpState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));

            // Helper to check if process is alive
            const isAlive = (pid?: number): boolean => {
              if (!pid) return false;
              try {
                process.kill(pid, 0);
                return true;
              } catch {
                return false;
              }
            };

            // Check conductor
            const conductorAlive = isAlive(state.conductor?.pid);
            const agentAlive = isAlive(state.agent?.pid);

            if (!conductorAlive && !agentAlive) {
              console.log('mcp: stopped (stale state file)');
              fs.unlinkSync(stateFile);
            } else {
              console.log(`mcp: running (started ${state.startedAt})`);

              // Show conductor status
              if (state.conductor) {
                const transport = state.conductor.socket
                  ? `socket ${state.conductor.socket}`
                  : `port ${state.conductor.port}`;
                const status = conductorAlive ? '✓ running' : '✗ dead';
                console.log(`  conductor: pid ${state.conductor.pid} ${status}`);
                console.log(`             ${transport}`);
              }

              // Show agent status
              if (state.agent) {
                const transport = state.agent.socket
                  ? `socket ${state.agent.socket}`
                  : `port ${state.agent.port}`;
                const status = agentAlive ? '✓ running' : '✗ dead';
                console.log(`  agent:     pid ${state.agent.pid} ${status}`);
                console.log(`             ${transport}`);
              } else {
                console.log('  agent:     not configured (use_subprocess=false)');
              }
            }
          } catch {
            console.log('mcp: state file corrupted');
          }
        } else {
          console.log('mcp: stopped');
        }
      } else {
        console.log('mcp: haven not configured');
      }
    }

    if (service === 'dashboard' || service === 'serve' || !service) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          const data = await response.json();
          console.log(`dashboard: running (port ${port})`);
          console.log(`  status: ${data.status}`);
          console.log(`  timestamp: ${data.timestamp}`);

          // Try to get agent stats
          try {
            const agentsResponse = await fetch(`http://127.0.0.1:${port}/api/system/status`);
            if (agentsResponse.ok) {
              const agentsData = await agentsResponse.json();
              console.log(`  agents: ${agentsData.agents.running}/${agentsData.agents.total}`);
            }
          } catch {
            // Ignore
          }
        } else {
          console.log(`dashboard: not responding (port ${port})`);
        }
      } catch {
        console.log(`dashboard: stopped`);
      }
    }

    if (service === 'agents' || service === 'conductor') {
      console.log(`${service}: stdio service (run with 'rdrctl start ${service}')`);
    }
  });

// rdrctl restart [service]
program
  .command('restart [service]')
  .description('Restart a service (default: mcp)')
  .option('--mcp-mode <mode>', 'MCP transport mode: socket or port')
  .action(async (service: string | undefined, options) => {
    const serviceName = service || 'mcp';

    if (serviceName === 'mcp') {
      // Stop first
      const haven = getPath('haven');
      if (haven) {
        const stateFile = path.join(haven, 'mcp-state.json');
        if (fs.existsSync(stateFile)) {
          console.log('[rdrctl] Stopping MCP servers...');
          // Trigger stop logic
          program.parse(['node', 'rdrctl', 'stop', 'mcp']);
        }
      }

      // Then start
      console.log('[rdrctl] Starting MCP servers...');
      await startMcpServices({ mcpMode: options.mcpMode });
    } else {
      console.error(`[rdrctl] Restart not implemented for: ${serviceName}`);
      process.exit(1);
    }
  });

// rdrctl log <service>
program
  .command('log <service>')
  .description('Show MCP server logs (conductor or agent)')
  .option('-f, --follow', 'Follow log output (like tail -f)')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .action(async (service: string, options) => {
    const haven = getPath('haven');
    if (!haven) {
      console.error('[rdrctl] Cannot determine haven path');
      process.exit(1);
    }

    // Validate service name
    if (service !== 'conductor' && service !== 'agent') {
      console.error(`[rdrctl] Unknown service: ${service}`);
      console.error('Available: conductor, agent');
      process.exit(1);
    }

    const logFile = path.join(haven, `mcp-${service}.log`);

    if (!fs.existsSync(logFile)) {
      console.error(`[rdrctl] Log file not found: ${logFile}`);
      console.error(`[rdrctl] Service "${service}" may not have been started yet`);
      process.exit(1);
    }

    if (options.follow) {
      // Use tail -f
      const { spawn } = await import('child_process');
      const tail = spawn('tail', ['-f', '-n', options.lines, logFile], {
        stdio: 'inherit'
      });
      tail.on('exit', (code) => process.exit(code || 0));
    } else {
      // Just read last N lines
      const { execSync } = await import('child_process');
      const output = execSync(`tail -n ${options.lines} "${logFile}"`, { encoding: 'utf-8' });
      console.log(output);
    }
  });

// rdrctl list
program
  .command('list')
  .description('List available services')
  .action(() => {
    console.log('Available services:\n');
    for (const [key, service] of Object.entries(SERVICES)) {
      const isDefault = key === 'mcp' ? ' (default)' : '';
      console.log(`  ${key.padEnd(12)} ${service.description}${isDefault}`);
    }
    console.log('\nUsage:');
    console.log('  rdrctl start           # Start MCP servers (daemonized)');
    console.log('  rdrctl start -f        # Start in foreground');
    console.log('  rdrctl stop            # Stop MCP servers');
    console.log('  rdrctl restart         # Restart MCP servers');
    console.log('  rdrctl status          # Show status');
    console.log('  rdrctl log conductor   # Show conductor logs');
    console.log('  rdrctl log agent       # Show agent logs');
    console.log('  rdrctl log conductor -f # Follow logs (tail -f)');
  });

// Default action: show help
program.action(() => {
  program.help();
});

program.parse();
