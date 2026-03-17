/**
 * Service Manager - MCP service lifecycle management
 *
 * MANAGER: Has config access, encapsulates service start/stop/status logic.
 * Extracted from rdrctl.ts to follow Commands → Managers → Libs architecture.
 */
import { errorMessage, errorCode } from '../lib/errors.js';
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
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Check if a process with the given PID is alive.
   */
  private isProcessAlive(pid?: number): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format transport string for a service endpoint.
   */
  private formatTransport(endpoint: { socket?: string; port?: number }): string {
    return endpoint.socket
      ? `socket ${endpoint.socket}`
      : `port ${endpoint.port}`;
  }

  /**
   * Build a ServiceStatus from MCP state, cleaning up stale state if needed.
   */
  private buildServiceStatus(state: McpState, stateFile: string): ServiceStatus {
    const conductorAlive = this.isProcessAlive(state.conductor?.pid);
    const agentAlive = this.isProcessAlive(state.agent?.pid);

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
        transport: this.formatTransport(state.conductor)
      };
    }

    if (state.agent) {
      result.agent = {
        pid: state.agent.pid,
        alive: agentAlive,
        transport: this.formatTransport(state.agent)
      };
    } else {
      result.agent = null;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // MCP Services
  // --------------------------------------------------------------------------

  /**
   * Check if an existing MCP state represents a running process.
   * Returns a StartMcpResult if already running, or null if the process is dead.
   */
  private checkExistingState(state: McpState, useSubprocess: boolean): StartMcpResult | null {
    try {
      process.kill(state.pid, 0);
    } catch {
      return null; // Process dead
    }

    const agentRunning = !!state.agent;
    if (useSubprocess !== agentRunning) {
      return {
        success: false,
        alreadyRunning: true,
        configChanged: true,
        error: `Config changed: use_subprocess=${useSubprocess} (config) vs ${agentRunning} (running)`
      };
    }

    return {
      success: false,
      alreadyRunning: true,
      error: `MCP servers already running (pid ${state.pid})`
    };
  }

  /**
   * Get transport args for a service (port or socket mode).
   */
  private getTransportArgs(
    haven: string, mcpMode: string, service: 'conductor' | 'agent',
    portStart: number, offset: number
  ): string[] {
    if (mcpMode === 'port') {
      return ['--port', String(portStart + offset)];
    }
    const socketPath = path.join(haven, `mcp-${service}.sock`);
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
    return ['--socket', socketPath];
  }

  /**
   * Spawn a single MCP service process and record its state.
   */
  private spawnService(
    haven: string, service: 'conductor' | 'agent', scriptBase: string,
    transportArgs: string[], logFile: string, foreground: boolean,
    mcpMode: string, portStart: number, offset: number
  ): { pid?: number; stateEntry: McpState['conductor'] } {
    const args = [...transportArgs, '--project-root', this.projectRoot];
    const script = getScriptInfo(scriptBase);
    const logFd = fs.openSync(logFile, 'a');

    const child = spawn(script.cmd, [...script.args, ...args], {
      stdio: ['ignore', logFd, logFd],
      cwd: this.projectRoot,
      detached: !foreground
    });

    if (child.pid && !foreground) {
      child.unref();
    }

    const stateEntry: McpState['conductor'] = mcpMode === 'port'
      ? { port: portStart + offset, pid: child.pid }
      : { socket: path.join(haven, `mcp-${service}.sock`), pid: child.pid };

    return { pid: child.pid, stateEntry };
  }

  /**
   * Clean up an existing stale state file if present.
   * Returns a StartMcpResult if the server is already running, or null to proceed.
   */
  private cleanupExistingState(stateFile: string, useSubprocess: boolean): StartMcpResult | null {
    if (!fs.existsSync(stateFile)) return null;

    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as McpState;
      const result = this.checkExistingState(state, useSubprocess);
      if (result) return result;
      fs.unlinkSync(stateFile);
    } catch {
      fs.unlinkSync(stateFile);
    }

    return null;
  }

  /**
   * Start MCP services (conductor + optionally agent)
   */
  startMcp(options: StartMcpOptions = {}): StartMcpResult {
    const config = getAgentConfig();
    const { foreground = false } = options;

    if (!this.haven) {
      return { success: false, error: 'Cannot determine haven path' };
    }

    const haven = this.haven;
    const stateFile = path.join(haven, 'mcp-state.json');

    const existingResult = this.cleanupExistingState(stateFile, config.use_subprocess);
    if (existingResult) return existingResult;

    fs.mkdirSync(haven, { recursive: true });

    const mcpMode = options.mcpMode || config.mcp_mode || 'socket';
    const portRange = config.mcp_port_range || '9100-9199';
    const [portStart] = portRange.split('-').map(Number);

    const conductorLog = path.join(haven, 'mcp-conductor.log');
    const conductorTransport = this.getTransportArgs(haven, mcpMode, 'conductor', portStart, 0);
    const conductor = this.spawnService(
      haven, 'conductor', path.join(this.cliDir, 'conductor', 'mcp-conductor'),
      conductorTransport, conductorLog, foreground, mcpMode, portStart, 0
    );

    const mcpState: McpState = {
      pid: conductor.pid || 0,
      startedAt: new Date().toISOString(),
      conductor: conductor.stateEntry
    };

    if (config.use_subprocess) {
      const agentLog = path.join(haven, 'mcp-agent.log');
      const agentTransport = this.getTransportArgs(haven, mcpMode, 'agent', portStart, 1);
      const agent = this.spawnService(
        haven, 'agent', path.join(this.cliDir, 'mcp-agent'),
        agentTransport, agentLog, foreground, mcpMode, portStart, 1
      );
      mcpState.agent = agent.stateEntry;
    }

    fs.writeFileSync(stateFile, JSON.stringify(mcpState, null, 2));

    return {
      success: true,
      conductor: mcpState.conductor,
      agent: mcpState.agent
    };
  }

  /**
   * Terminate a process by PID. Returns null on success, or an error string.
   */
  private terminateProcess(pid: number): string | null {
    try {
      process.kill(pid, 'SIGTERM');
      return null;
    } catch (e: unknown) {
      if (errorCode(e) === 'ESRCH') return null; // Already dead
      return `Failed to stop process ${pid}: ${errorMessage(e)}`;
    }
  }

  /**
   * Clean up socket files from MCP state.
   */
  private cleanupSockets(state: McpState): void {
    if (state.conductor?.socket && fs.existsSync(state.conductor.socket)) {
      fs.unlinkSync(state.conductor.socket);
    }
    if (state.agent?.socket && fs.existsSync(state.agent.socket)) {
      fs.unlinkSync(state.agent.socket);
    }
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
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as McpState;
      const pidsToKill: number[] = [];
      const stoppedPids: number[] = [];

      if (state.conductor?.pid) pidsToKill.push(state.conductor.pid);
      if (state.agent?.pid) pidsToKill.push(state.agent.pid);

      for (const pid of pidsToKill) {
        const error = this.terminateProcess(pid);
        if (error) {
          return { success: false, error };
        }
        stoppedPids.push(pid);
      }

      fs.unlinkSync(stateFile);
      this.cleanupSockets(state);

      return { success: true, stoppedPids };
    } catch (e: unknown) {
      return { success: false, error: errorMessage(e) };
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
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as McpState;
      return this.buildServiceStatus(state, stateFile);
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
      if (!response.ok) {
        return { running: false };
      }

      const data = await response.json() as { status?: string; timestamp?: string };
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
          const agentsData = await agentsResponse.json() as { agents: { running: number; total: number } };
          result.agents = {
            running: agentsData.agents.running,
            total: agentsData.agents.total
          };
        }
      } catch {
        // Ignore
      }

      return result;
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
