#!/usr/bin/env node
/**
 * Rudder Control (rdrctl) - Service manager for Sailing
 *
 * Like systemctl but for Sailing services:
 *   - agents: MCP server for sandbox agents
 *   - conductor: MCP server for orchestrator
 *   - dashboard: Web dashboard (HTTP + WebSocket)
 *
 * Usage:
 *   rdrctl start <service> [options]
 *   rdrctl stop <service>
 *   rdrctl status [service]
 *   rdrctl list
 */

import { Command } from 'commander';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConductorServer } from './conductor/server.js';
import { createServer as createDashboardServer } from './dashboard/server.js';
import { createRoutes } from './dashboard/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

// Default configuration
const DEFAULT_PORT = 3456;
const DEFAULT_TIMEOUT = 300;
const DEFAULT_CACHE = 300;

// Service definitions
const SERVICES = {
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
    description: 'Full conductor server (dashboard + WebSocket)',
    start: startServeService
  }
};

type ServiceName = keyof typeof SERVICES;

// ============================================================================
// Service implementations
// ============================================================================

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

// rdrctl start <service>
program
  .command('start <service>')
  .description('Start a service')
  .option('-p, --port <port>', 'Port number (dashboard/serve)', String(DEFAULT_PORT))
  .option('-t, --timeout <seconds>', 'Idle timeout (-1 for infinite)', String(DEFAULT_TIMEOUT))
  .option('-c, --cache <seconds>', 'Cache TTL (0 to disable)', String(DEFAULT_CACHE))
  .option('--no-open', 'Do not open browser')
  .action(async (service: string, options) => {
    const serviceDef = SERVICES[service as ServiceName];

    if (!serviceDef) {
      console.error(`Unknown service: ${service}`);
      console.error('Available services:', Object.keys(SERVICES).join(', '));
      process.exit(1);
    }

    const opts = {
      port: parseInt(options.port, 10),
      timeout: parseInt(options.timeout, 10),
      cache: parseInt(options.cache, 10),
      open: options.open
    };

    await serviceDef.start(opts);
  });

// rdrctl stop <service> - placeholder for future daemon mode
program
  .command('stop <service>')
  .description('Stop a service (requires daemon mode)')
  .action((service: string) => {
    console.log(`[rdrctl] Stop not implemented yet (service: ${service})`);
    console.log('Services run in foreground. Use Ctrl+C to stop.');
    process.exit(1);
  });

// rdrctl status [service]
program
  .command('status [service]')
  .description('Show service status')
  .option('-p, --port <port>', 'Port to check', String(DEFAULT_PORT))
  .action(async (service: string | undefined, options) => {
    const port = parseInt(options.port, 10);

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

// rdrctl list
program
  .command('list')
  .description('List available services')
  .action(() => {
    console.log('Available services:\n');
    for (const [key, service] of Object.entries(SERVICES)) {
      console.log(`  ${key.padEnd(12)} ${service.description}`);
    }
    console.log('\nUsage: rdrctl start <service>');
  });

// Default action: show help
program.action(() => {
  program.help();
});

program.parse();
