/**
 * Conductor command - Unified server for browser-controlled development
 *
 * Features:
 * - All dashboard routes (PRD, Epic, Task views)
 * - Agent control API (spawn, reap, kill)
 * - WebSocket for real-time events
 * - MCP server for orchestrator agents
 */
import { createConductorServer } from '../conductor/server.js';

const DEFAULT_PORT = 3456;
const DEFAULT_TIMEOUT = 300; // 5 minutes
const DEFAULT_CACHE = 300; // 5 minutes

/**
 * Register conductor commands
 */
export function registerConductorCommands(program: any) {
  const conductor = program.command('conductor')
    .description('Browser-controlled development server with real-time agent control');

  // conductor start (default)
  conductor.command('start', { isDefault: true })
    .description('Start conductor server with HTTP + WebSocket')
    .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
    .option('-t, --timeout <seconds>', `Idle timeout in seconds (default: ${DEFAULT_TIMEOUT}, -1 for infinite)`, String(DEFAULT_TIMEOUT))
    .option('-c, --cache <seconds>', `Data cache TTL in seconds (default: ${DEFAULT_CACHE}, 0 to disable)`, String(DEFAULT_CACHE))
    .option('--no-open', 'Do not open browser automatically')
    .option('--no-websocket', 'Disable WebSocket (HTTP only)')
    .action(async (options: {
      port: string;
      timeout: string;
      cache: string;
      open: boolean;
      websocket: boolean;
    }) => {
      const port = parseInt(options.port, 10);
      const timeout = parseInt(options.timeout, 10);
      const cacheTTL = parseInt(options.cache, 10);

      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${options.port}`);
        process.exit(1);
      }

      if (isNaN(timeout) || timeout < -1) {
        console.error(`Invalid timeout: ${options.timeout} (use -1 for infinite)`);
        process.exit(1);
      }

      if (isNaN(cacheTTL) || cacheTTL < 0) {
        console.error(`Invalid cache TTL: ${options.cache} (use 0 to disable)`);
        process.exit(1);
      }

      console.log('Starting Sailing Conductor...');
      console.log('');

      const server = createConductorServer(port, {
        timeout,
        cacheTTL,
        websocket: options.websocket
      });

      // Handle shutdown
      const shutdown = () => {
        console.log('\nShutting down conductor...');
        server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Start server with callback for browser open
      server.start((actualPort) => {
        void (async () => {
          console.log('');
          if (timeout > 0) {
            console.log(`Idle timeout: ${timeout}s`);
          } else if (timeout === -1) {
            console.log('Idle timeout: disabled');
          }
          if (cacheTTL > 0) {
            console.log(`Cache TTL: ${cacheTTL}s`);
          } else {
            console.log('Cache: disabled');
          }
          console.log('');
          console.log('Features:');
          console.log('  - Dashboard UI with agent control');
          console.log('  - HTTP API: /api/agents/*/spawn, /api/agents/*/reap, /api/agents/*/kill');
          if (options.websocket) {
            console.log('  - WebSocket: real-time events and log streaming');
          }
          console.log('');
          console.log('Press Ctrl+C to stop');

          // Open browser with actual port
          if (options.open) {
            const url = `http://127.0.0.1:${actualPort}`;
            const { exec } = await import('child_process');

            // Platform-specific open command
            const cmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start' : 'xdg-open';

            exec(`${cmd} ${url}`, (err) => {
              if (err) {
                console.log(`Open ${url} in your browser`);
              }
            });
          }
        })();
      }, shutdown);
    });

  // conductor status - show status of running conductor
  conductor.command('status')
    .description('Check if conductor is running')
    .option('-p, --port <port>', 'Port to check', String(DEFAULT_PORT))
    .action(async (options: { port: string }) => {
      const port = parseInt(options.port, 10);

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          const data = await response.json();
          console.log(`Conductor is running on port ${port}`);
          console.log(`Status: ${data.status}`);
          console.log(`Timestamp: ${data.timestamp}`);

          // Get agent stats
          const agentsResponse = await fetch(`http://127.0.0.1:${port}/api/system/status`);
          if (agentsResponse.ok) {
            const agentsData = await agentsResponse.json();
            console.log(`Agents: ${agentsData.agents.running} running / ${agentsData.agents.total} total`);
          }
        } else {
          console.log(`Conductor not responding on port ${port}`);
          process.exit(1);
        }
      } catch (e) {
        console.log(`Conductor not running on port ${port}`);
        process.exit(1);
      }
    });
}
