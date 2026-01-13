/**
 * Dashboard command - Web UI for sailing project overview
 */
import { createServer } from '../dashboard/server.js';
import { createRoutes } from '../dashboard/routes.js';
const DEFAULT_PORT = 3456;
/**
 * Register dashboard commands
 */
export function registerDashboardCommands(program) {
    program.command('dashboard')
        .description('Start web dashboard for project overview')
        .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
        .option('--no-open', 'Do not open browser automatically')
        .action(async (options) => {
        const port = parseInt(options.port, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            console.error(`Invalid port: ${options.port}`);
            process.exit(1);
        }
        console.log('Starting Sailing Dashboard...');
        const routes = createRoutes();
        const server = createServer(port, routes);
        // Handle shutdown
        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            server.stop();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            server.stop();
            process.exit(0);
        });
        // Start server with callback for browser open
        server.start(async (actualPort) => {
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
        });
    });
}
