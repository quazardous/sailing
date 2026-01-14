/**
 * Dashboard command - Web UI for sailing project overview
 */
import { createServer } from '../dashboard/server.js';
import { createRoutes } from '../dashboard/routes.js';
const DEFAULT_PORT = 3456;
const DEFAULT_TIMEOUT = 300; // 5 minutes
/**
 * Register dashboard commands
 */
export function registerDashboardCommands(program) {
    program.command('dashboard')
        .description('Start web dashboard for project overview')
        .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
        .option('-t, --timeout <seconds>', `Idle timeout in seconds (default: ${DEFAULT_TIMEOUT}, -1 for infinite)`, String(DEFAULT_TIMEOUT))
        .option('--no-open', 'Do not open browser automatically')
        .action(async (options) => {
        const port = parseInt(options.port, 10);
        const timeout = parseInt(options.timeout, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            console.error(`Invalid port: ${options.port}`);
            process.exit(1);
        }
        if (isNaN(timeout) || timeout < -1) {
            console.error(`Invalid timeout: ${options.timeout} (use -1 for infinite)`);
            process.exit(1);
        }
        console.log('Starting Sailing Dashboard...');
        const routes = createRoutes();
        const server = createServer(port, routes, { timeout });
        // Handle shutdown
        const shutdown = () => {
            server.stop();
            process.exit(0);
        };
        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            shutdown();
        });
        process.on('SIGTERM', shutdown);
        // Start server with callback for browser open
        server.start(async (actualPort) => {
            if (timeout > 0) {
                console.log(`Idle timeout: ${timeout}s`);
            }
            else if (timeout === -1) {
                console.log('Idle timeout: disabled');
            }
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
        }, shutdown); // Pass shutdown as onShutdown callback
    });
}
