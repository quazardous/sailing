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
 *
 * ARCHITECTURE: This file is a CLI entry point.
 * Business logic is delegated to managers (ServiceManager, etc.).
 */
import { Command } from 'commander';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConductorServer } from './conductor/server.js';
import { createServer as createDashboardServer } from './dashboard/server.js';
import { createRoutes } from './dashboard/routes.js';
import { setProjectRoot, setScriptDir } from './managers/core-manager.js';
import { getServiceManager } from './managers/service-manager.js';
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
const SERVICES = {
    mcp: {
        name: 'mcp',
        description: 'MCP servers (conductor + agent if subprocess mode)',
        start: startMcpService
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
// ============================================================================
// Service Starters (thin wrappers that delegate to managers)
// ============================================================================
/**
 * Start MCP services - delegates to ServiceManager
 */
async function startMcpService(options) {
    const manager = getServiceManager();
    const foreground = options.foreground;
    const result = await manager.startMcp({
        mcpMode: options.mcpMode,
        foreground
    });
    if (!result.success) {
        if (result.alreadyRunning && result.configChanged) {
            console.log(`[rdrctl] MCP servers running but config changed:`);
            console.log(`  ${result.error}`);
            console.log('[rdrctl] Use "rdrctl restart" to apply new config');
            process.exit(1);
        }
        else if (result.alreadyRunning) {
            console.log(`[rdrctl] ${result.error}`);
            console.log('[rdrctl] Use "rdrctl stop" first, or "rdrctl restart"');
            process.exit(1);
        }
        else {
            console.error(`[rdrctl] ${result.error}`);
            process.exit(1);
        }
    }
    // Output success info
    console.log('[rdrctl] Starting MCP conductor...');
    if (result.conductor) {
        const transport = result.conductor.socket
            ? result.conductor.socket
            : `port ${result.conductor.port}`;
        console.log(`[rdrctl] Conductor: ${transport} (pid ${result.conductor.pid})`);
    }
    if (result.agent) {
        console.log('[rdrctl] Starting MCP agent...');
        const transport = result.agent.socket
            ? result.agent.socket
            : `port ${result.agent.port}`;
        console.log(`[rdrctl] Agent: ${transport} (pid ${result.agent.pid})`);
    }
    else {
        console.log('[rdrctl] Agent: skipped (use_subprocess=false)');
    }
    if (foreground) {
        console.log('[rdrctl] Running in foreground (Ctrl+C to stop)');
    }
    else {
        const haven = manager.getHaven();
        if (haven) {
            console.log(`[rdrctl] Logs: ${path.join(haven, 'mcp-conductor.log')}`);
        }
        console.log('[rdrctl] MCP servers started (daemonized)');
        console.log('[rdrctl] Use "rdrctl status" to check, "rdrctl stop" to stop');
    }
}
/**
 * Start agents stdio service - forks mcp-server.ts
 */
async function startAgentsService(_options) {
    console.error('[rdrctl] Starting MCP agents server (stdio)...');
    const mcpServerPath = path.join(__dirname, 'mcp-server.ts');
    const child = fork(mcpServerPath, ['start', '-f'], {
        stdio: 'inherit',
        execArgv: ['--import', 'tsx']
    });
    setupChildHandlers(child, 'agents');
    await new Promise(() => { }); // Keep alive
}
/**
 * Start conductor stdio service - forks mcp-conductor.ts
 */
async function startConductorMcpService(_options) {
    console.error('[rdrctl] Starting MCP conductor server (stdio)...');
    const mcpConductorPath = path.join(__dirname, 'conductor', 'mcp-conductor.ts');
    const child = fork(mcpConductorPath, [], {
        stdio: 'inherit',
        execArgv: ['--import', 'tsx']
    });
    setupChildHandlers(child, 'conductor');
    await new Promise(() => { }); // Keep alive
}
/**
 * Start dashboard HTTP service
 */
async function startDashboardService(options) {
    const port = options.port || DEFAULT_PORT;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const cacheTTL = options.cache ?? DEFAULT_CACHE;
    const openBrowser = options.open !== false;
    console.log('[rdrctl] Starting dashboard...');
    const routes = createRoutes({ cacheTTL });
    const server = createDashboardServer(port, routes, { timeout });
    setupShutdown(() => server.stop());
    server.start(async (actualPort) => {
        console.log(`[rdrctl] Dashboard: http://127.0.0.1:${actualPort}`);
        if (openBrowser) {
            await openUrl(`http://127.0.0.1:${actualPort}`);
        }
    }, () => process.exit(0));
}
/**
 * Start full conductor server
 */
async function startServeService(options) {
    const port = options.port || DEFAULT_PORT;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const cacheTTL = options.cache ?? DEFAULT_CACHE;
    const openBrowser = options.open !== false;
    console.log('[rdrctl] Starting conductor server...');
    const server = createConductorServer(port, {
        timeout,
        cacheTTL,
        websocket: true
    });
    setupShutdown(() => server.stop());
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
function setupChildHandlers(child, name) {
    child.on('error', (err) => {
        console.error(`[rdrctl] ${name} error: ${err.message}`);
        process.exit(1);
    });
    child.on('exit', (code) => {
        process.exit(code || 0);
    });
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
}
function setupShutdown(cleanup) {
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
async function openUrl(url) {
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
    .action(async (service, options) => {
    const serviceName = (service || 'mcp');
    const serviceDef = SERVICES[serviceName];
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
    .action((service) => {
    const serviceName = service || 'mcp';
    if (serviceName === 'mcp') {
        const manager = getServiceManager();
        const result = manager.stopMcp();
        if (result.notRunning) {
            console.log('[rdrctl] MCP servers not running');
            process.exit(0);
        }
        if (!result.success) {
            console.error(`[rdrctl] Error stopping MCP: ${result.error}`);
            process.exit(1);
        }
        if (result.stoppedPids?.length) {
            result.stoppedPids.forEach(pid => {
                console.log(`[rdrctl] Stopped process ${pid}`);
            });
        }
        console.log('[rdrctl] MCP servers stopped');
    }
    else {
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
    .action(async (service, options) => {
    const port = parseInt(options.port, 10);
    const manager = getServiceManager();
    // MCP status
    if (service === 'mcp' || !service) {
        const status = manager.getMcpStatus();
        if (!status.running) {
            console.log('mcp: stopped');
        }
        else {
            console.log(`mcp: running (started ${status.startedAt})`);
            if (status.conductor) {
                const alive = status.conductor.alive ? '✓ running' : '✗ dead';
                console.log(`  conductor: pid ${status.conductor.pid} ${alive}`);
                console.log(`             ${status.conductor.transport}`);
            }
            if (status.agent) {
                const alive = status.agent.alive ? '✓ running' : '✗ dead';
                console.log(`  agent:     pid ${status.agent.pid} ${alive}`);
                console.log(`             ${status.agent.transport}`);
            }
            else if (status.agent === null) {
                console.log('  agent:     not configured (use_subprocess=false)');
            }
        }
    }
    // Dashboard status
    if (service === 'dashboard' || service === 'serve' || !service) {
        const dashStatus = await manager.getDashboardStatus(port);
        if (dashStatus.running) {
            console.log(`dashboard: running (port ${dashStatus.port})`);
            console.log(`  status: ${dashStatus.status}`);
            console.log(`  timestamp: ${dashStatus.timestamp}`);
            if (dashStatus.agents) {
                console.log(`  agents: ${dashStatus.agents.running}/${dashStatus.agents.total}`);
            }
        }
        else {
            console.log(`dashboard: stopped`);
        }
    }
    // Stdio services
    if (service === 'agents' || service === 'conductor') {
        console.log(`${service}: stdio service (run with 'rdrctl start ${service}')`);
    }
});
// rdrctl restart [service]
program
    .command('restart [service]')
    .description('Restart a service (default: mcp)')
    .option('--mcp-mode <mode>', 'MCP transport mode: socket or port')
    .action(async (service, options) => {
    const serviceName = service || 'mcp';
    if (serviceName === 'mcp') {
        const manager = getServiceManager();
        // Stop first (if running)
        const stopResult = manager.stopMcp();
        if (!stopResult.notRunning) {
            console.log('[rdrctl] Stopping MCP servers...');
            if (stopResult.stoppedPids?.length) {
                stopResult.stoppedPids.forEach(pid => {
                    console.log(`[rdrctl] Stopped process ${pid}`);
                });
            }
        }
        // Then start
        console.log('[rdrctl] Starting MCP servers...');
        await startMcpService({ mcpMode: options.mcpMode });
    }
    else {
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
    .action(async (service, options) => {
    if (service !== 'conductor' && service !== 'agent') {
        console.error(`[rdrctl] Unknown service: ${service}`);
        console.error('Available: conductor, agent');
        process.exit(1);
    }
    const manager = getServiceManager();
    const logFile = manager.getLogFile(service);
    if (!logFile) {
        console.error(`[rdrctl] Log file not found for service "${service}"`);
        console.error(`[rdrctl] Service may not have been started yet`);
        process.exit(1);
    }
    if (options.follow) {
        const { spawn } = await import('child_process');
        const tail = spawn('tail', ['-f', '-n', options.lines, logFile], {
            stdio: 'inherit'
        });
        tail.on('exit', (code) => process.exit(code || 0));
    }
    else {
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
