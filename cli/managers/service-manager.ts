/**
 * Service Manager - MCP service lifecycle management
 *
 * MANAGER: Has config access, encapsulates service start/stop/status logic.
 * Extracted from rdrctl.ts to follow Commands → Managers → Libs architecture.
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getAgentConfig } from './config-manager.js';
import { getPath, findProjectRoot } from './core-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Detect if running from source (.ts) or dist (.js)
function getScriptInfo(basePath: string): { cmd: string; args: string[]; ext: string } {
  const tsPath = basePath + '.ts';
  const jsPath = basePath + '.js';

  // Check if .ts file exists (dev mode)
  if (fs.existsSync(tsPath)) {
    return { cmd: 'npx', args: ['tsx', tsPath], ext: '.ts' };
  }
  // Otherwise use .js (dist mode)
  return { cmd: 'node', args: [jsPath], ext: '.js' };
}

// =============================================================================
// Types
// =============================================================================

export interface McpState {
  conductor?: { socket?: string; port?: number; pid?: number };
  agent?: { socket?: string; port?: number; pid?: number };
  pid: number;
  startedAt: string;
}

export interface ServiceStatus {
  running: boolean;
  startedAt?: string;
  conductor?: {
    pid?: number;
    alive: boolean;
    transport: string;
  };
  agent?: {
    pid?: number;
    alive: boolean;
    transport: string;
  } | null;
}

export interface DashboardStatus {
  running: boolean;
  port?: number;
  status?: string;
  timestamp?: string;
  agents?: { running: number; total: number };
}

export interface StartMcpOptions {
  mcpMode?: string;
  foreground?: boolean;
}

export interface StartMcpResult {
  success: boolean;
  error?: string;
  alreadyRunning?: boolean;
  configChanged?: boolean;
  conductor?: { socket?: string; port?: number; pid?: number };
  agent?: { socket?: string; port?: number; pid?: number };
}

export interface StopMcpResult {
  success: boolean;
  error?: string;
  notRunning?: boolean;
  stoppedPids?: number[];
}

// =============================================================================
// ServiceManager Class
// =============================================================================

export class ServiceManager {
  private readonly haven: string | null;
  private readonly projectRoot: string;
  private readonly cliDir: string;

  constructor() {
    this.haven = getPath('haven');
    this.projectRoot = findProjectRoot();
    this.cliDir = path.resolve(__dirname, '..');
  }

  // --------------------------------------------------------------------------
  // MCP Services
  // --------------------------------------------------------------------------

  /**
   * Start MCP services (conductor + optionally agent)
   */
  async startMcp(options: StartMcpOptions = {}): Promise<StartMcpResult> {
    const config = getAgentConfig();
    const { foreground = false } = options;

    if (!this.haven) {
      return { success: false, error: 'Cannot determine haven path' };
    }

    const stateFile = path.join(this.haven, 'mcp-state.json');

    // Check if already running
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
            return {
              success: false,
              alreadyRunning: true,
              configChanged: true,
              error: `Config changed: use_subprocess=${agentExpected} (config) vs ${agentRunning} (running)`
            };
          }

          return {
            success: false,
            alreadyRunning: true,
            error: `MCP servers already running (pid ${state.pid})`
          };
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
    fs.mkdirSync(this.haven, { recursive: true });

    // Determine transport mode
    const mcpMode = options.mcpMode || config.mcp_mode || 'socket';
    const portRange = config.mcp_port_range || '9100-9199';
    const [portStart] = portRange.split('-').map(Number);

    // Helper to get transport args
    const getTransportArgs = (service: 'conductor' | 'agent', offset: number): string[] => {
      if (mcpMode === 'port') {
        const port = portStart + offset;
        return ['--port', String(port)];
      } else {
        const socketPath = path.join(this.haven, `mcp-${service}.sock`);
        if (fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
        return ['--socket', socketPath];
      }
    };

    // Prepare log files
    const conductorLog = path.join(this.haven, 'mcp-conductor.log');
    const agentLog = path.join(this.haven, 'mcp-agent.log');

    // Build state object
    const mcpState: McpState = {
      pid: 0,
      startedAt: new Date().toISOString()
    };

    const pids: number[] = [];

    // Start conductor MCP
    const conductorArgs = getTransportArgs('conductor', 0);
    conductorArgs.push('--project-root', this.projectRoot);

    const conductorScript = getScriptInfo(path.join(this.cliDir, 'conductor', 'mcp-conductor'));
    const conductorOut = fs.openSync(conductorLog, 'a');
    const conductorChild = spawn(conductorScript.cmd, [...conductorScript.args, ...conductorArgs], {
      stdio: ['ignore', conductorOut, conductorOut],
      cwd: this.projectRoot,
      detached: !foreground
    });

    if (conductorChild.pid) {
      pids.push(conductorChild.pid);
      if (!foreground) conductorChild.unref();
    }

    if (mcpMode === 'port') {
      mcpState.conductor = { port: portStart, pid: conductorChild.pid };
    } else {
      mcpState.conductor = { socket: path.join(this.haven, 'mcp-conductor.sock'), pid: conductorChild.pid };
    }

    // Start agent MCP only if subprocess mode is enabled
    if (config.use_subprocess) {
      const agentArgs = getTransportArgs('agent', 1);
      agentArgs.push('--project-root', this.projectRoot);

      const agentScript = getScriptInfo(path.join(this.cliDir, 'mcp-agent'));
      const agentOut = fs.openSync(agentLog, 'a');
      const agentChild = spawn(agentScript.cmd, [...agentScript.args, ...agentArgs], {
        stdio: ['ignore', agentOut, agentOut],
        cwd: this.projectRoot,
        detached: !foreground
      });

      if (agentChild.pid) {
        pids.push(agentChild.pid);
        if (!foreground) agentChild.unref();
      }

      if (mcpMode === 'port') {
        mcpState.agent = { port: portStart + 1, pid: agentChild.pid };
      } else {
        mcpState.agent = { socket: path.join(this.haven, 'mcp-agent.sock'), pid: agentChild.pid };
      }
    }

    // Use first PID as main state PID
    mcpState.pid = pids[0] || 0;

    // Write MCP state file
    fs.writeFileSync(stateFile, JSON.stringify(mcpState, null, 2));

    // If foreground mode, wait for conductor to exit
    if (foreground) {
      await new Promise<void>((resolve) => {
        conductorChild.on('exit', resolve);
      });
    }

    return {
      success: true,
      conductor: mcpState.conductor,
      agent: mcpState.agent
    };
  }

  /**
   * Stop MCP services
   */
  stopMcp(): StopMcpResult {
    if (!this.haven) {
      return { success: false, error: 'Cannot determine haven path' };
    }

    const stateFile = path.join(this.haven, 'mcp-state.json');

    if (!fs.existsSync(stateFile)) {
      return { success: true, notRunning: true };
    }

    try {
      const state: McpState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const pidsToKill: number[] = [];
      const stoppedPids: number[] = [];

      // Collect PIDs
      if (state.conductor?.pid) pidsToKill.push(state.conductor.pid);
      if (state.agent?.pid) pidsToKill.push(state.agent.pid);

      // Kill processes
      for (const pid of pidsToKill) {
        try {
          process.kill(pid, 'SIGTERM');
          stoppedPids.push(pid);
        } catch (e: any) {
          if (e.code !== 'ESRCH') {
            // Process exists but couldn't be killed
            return { success: false, error: `Failed to stop process ${pid}: ${e.message}` };
          }
          // ESRCH = process doesn't exist, which is fine
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

      return { success: true, stoppedPids };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get MCP services status
   */
  getMcpStatus(): ServiceStatus {
    if (!this.haven) {
      return { running: false };
    }

    const stateFile = path.join(this.haven, 'mcp-state.json');

    if (!fs.existsSync(stateFile)) {
      return { running: false };
    }

    try {
      const state: McpState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));

      const isAlive = (pid?: number): boolean => {
        if (!pid) return false;
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      const conductorAlive = isAlive(state.conductor?.pid);
      const agentAlive = isAlive(state.agent?.pid);

      // If neither is alive, clean up stale state
      if (!conductorAlive && !agentAlive) {
        fs.unlinkSync(stateFile);
        return { running: false };
      }

      const result: ServiceStatus = {
        running: true,
        startedAt: state.startedAt
      };

      if (state.conductor) {
        result.conductor = {
          pid: state.conductor.pid,
          alive: conductorAlive,
          transport: state.conductor.socket
            ? `socket ${state.conductor.socket}`
            : `port ${state.conductor.port}`
        };
      }

      if (state.agent) {
        result.agent = {
          pid: state.agent.pid,
          alive: agentAlive,
          transport: state.agent.socket
            ? `socket ${state.agent.socket}`
            : `port ${state.agent.port}`
        };
      } else {
        result.agent = null; // Explicitly not configured
      }

      return result;
    } catch {
      return { running: false };
    }
  }

  /**
   * Check dashboard status via HTTP
   */
  async getDashboardStatus(port: number): Promise<DashboardStatus> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        const data = await response.json();
        const result: DashboardStatus = {
          running: true,
          port,
          status: data.status,
          timestamp: data.timestamp
        };

        // Try to get agent stats
        try {
          const agentsResponse = await fetch(`http://127.0.0.1:${port}/api/system/status`);
          if (agentsResponse.ok) {
            const agentsData = await agentsResponse.json();
            result.agents = {
              running: agentsData.agents.running,
              total: agentsData.agents.total
            };
          }
        } catch {
          // Ignore
        }

        return result;
      } else {
        return { running: false };
      }
    } catch {
      return { running: false };
    }
  }

  /**
   * Get log file path for a service
   */
  getLogFile(service: 'conductor' | 'agent'): string | null {
    if (!this.haven) return null;
    const logFile = path.join(this.haven, `mcp-${service}.log`);
    return fs.existsSync(logFile) ? logFile : null;
  }

  /**
   * Get haven path
   */
  getHaven(): string | null {
    return this.haven;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let _instance: ServiceManager | null = null;

/**
 * Get service manager instance (singleton)
 */
export function getServiceManager(): ServiceManager {
  if (!_instance) {
    _instance = new ServiceManager();
  }
  return _instance;
}

/**
 * Reset service manager (for testing)
 */
export function resetServiceManager(): void {
  _instance = null;
}
